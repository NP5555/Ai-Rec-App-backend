const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../database/connection');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication and super admin check to all routes
router.use(authenticateToken);
router.use(requireSuperAdmin);

// @route   GET /api/tenants
// @desc    Get all tenants (super admin only)
// @access  Private (super admin only)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        let params = [];
        let paramCount = 0;

        if (search) {
            paramCount++;
            whereClause += ` AND (name ILIKE $${paramCount} OR domain ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        if (status) {
            paramCount++;
            whereClause += ` AND status = $${paramCount}`;
            params.push(status);
        }

        // Get tenants with user count
        const tenantsResult = await query(`
      SELECT 
        t.id, t.name, t.domain, t.status, t.settings, t.created_at, t.updated_at,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT e.id) as extension_count
      FROM tenants t
      LEFT JOIN users u ON t.id = u.tenant_id
      LEFT JOIN extensions e ON t.id = e.tenant_id
      ${whereClause}
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...params, limit, offset]);

        // Get total count
        const countResult = await query(`
      SELECT COUNT(*) as total
      FROM tenants t
      ${whereClause}
    `, params);

        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                tenants: tenantsResult.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages
                }
            }
        });

    } catch (error) {
        logger.error('Get tenants error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching tenants'
        });
    }
});

// @route   GET /api/tenants/:id
// @desc    Get tenant by ID
// @access  Private (super admin only)
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const tenantResult = await query(`
      SELECT 
        t.id, t.name, t.domain, t.status, t.settings, t.created_at, t.updated_at,
        COUNT(DISTINCT u.id) as user_count,
        COUNT(DISTINCT e.id) as extension_count,
        COUNT(DISTINCT d.id) as department_count
      FROM tenants t
      LEFT JOIN users u ON t.id = u.tenant_id
      LEFT JOIN extensions e ON t.id = e.tenant_id
      LEFT JOIN departments d ON t.id = d.tenant_id
      WHERE t.id = $1
      GROUP BY t.id
    `, [id]);

        if (tenantResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                message: 'The requested tenant does not exist'
            });
        }

        res.json({
            success: true,
            data: {
                tenant: tenantResult.rows[0]
            }
        });

    } catch (error) {
        logger.error('Get tenant error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching the tenant'
        });
    }
});

// @route   POST /api/tenants
// @desc    Create a new tenant
// @access  Private (super admin only)
router.post('/', [
    body('name', 'Tenant name is required').notEmpty().isLength({ min: 2, max: 255 }),
    body('domain', 'Domain is required').notEmpty().isLength({ min: 2, max: 255 }),
    body('settings').optional().isObject()
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }

        const { name, domain, settings = {} } = req.body;

        // Check if domain already exists
        const existingTenant = await query(
            'SELECT id FROM tenants WHERE domain = $1',
            [domain]
        );

        if (existingTenant.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Domain already exists',
                message: 'A tenant with this domain already exists'
            });
        }

        // Create tenant
        const tenantResult = await query(`
      INSERT INTO tenants (id, name, domain, status, settings)
      VALUES (gen_random_uuid(), $1, $2, 'active', $3)
      RETURNING id, name, domain, status, settings, created_at
    `, [name, domain, JSON.stringify(settings)]);

        const newTenant = tenantResult.rows[0];

        res.status(201).json({
            success: true,
            message: 'Tenant created successfully',
            data: {
                tenant: newTenant
            }
        });

        logger.info('Tenant created successfully', {
            tenantId: newTenant.id,
            tenantName: newTenant.name,
            createdBy: req.user.id
        });

    } catch (error) {
        logger.error('Create tenant error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while creating the tenant'
        });
    }
});

// @route   PUT /api/tenants/:id
// @desc    Update tenant
// @access  Private (super admin only)
router.put('/:id', [
    body('name').optional().notEmpty().isLength({ min: 2, max: 255 }),
    body('domain').optional().notEmpty().isLength({ min: 2, max: 255 }),
    body('settings').optional().isObject()
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }

        const { id } = req.params;
        const { name, domain, status, settings } = req.body;

        // Check if tenant exists
        const existingTenant = await query(
            'SELECT id, name, domain FROM tenants WHERE id = $1',
            [id]
        );

        if (existingTenant.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                message: 'The requested tenant does not exist'
            });
        }

        // Check if domain is being changed and if it's already taken
        if (domain && domain !== existingTenant.rows[0].domain) {
            const domainCheck = await query(
                'SELECT id FROM tenants WHERE domain = $1 AND id != $2',
                [domain, id]
            );

            if (domainCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: 'Domain already exists',
                    message: 'A tenant with this domain already exists'
                });
            }
        }

        // Build update query
        const updateFields = [];
        const updateParams = [];
        let paramCount = 0;

        if (name) {
            paramCount++;
            updateFields.push(`name = $${paramCount}`);
            updateParams.push(name);
        }

        if (domain) {
            paramCount++;
            updateFields.push(`domain = $${paramCount}`);
            updateParams.push(domain);
        }

        if (status) {
            paramCount++;
            updateFields.push(`status = $${paramCount}`);
            updateParams.push(status);
        }

        if (settings) {
            paramCount++;
            updateFields.push(`settings = $${paramCount}`);
            updateParams.push(JSON.stringify(settings));
        }

        // Update tenant
        if (updateFields.length > 0) {
            paramCount++;
            updateParams.push(id);

            await query(`
        UPDATE tenants 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramCount}
      `, updateParams);
        }

        // Get updated tenant
        const updatedTenantResult = await query(`
      SELECT id, name, domain, status, settings, created_at, updated_at
      FROM tenants
      WHERE id = $1
    `, [id]);

        res.json({
            success: true,
            message: 'Tenant updated successfully',
            data: {
                tenant: updatedTenantResult.rows[0]
            }
        });

        logger.info('Tenant updated successfully', {
            tenantId: id,
            tenantName: updatedTenantResult.rows[0].name,
            updatedBy: req.user.id
        });

    } catch (error) {
        logger.error('Update tenant error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while updating the tenant'
        });
    }
});

// @route   DELETE /api/tenants/:id
// @desc    Delete tenant
// @access  Private (super admin only)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if tenant exists
        const existingTenant = await query(
            'SELECT id, name, domain FROM tenants WHERE id = $1',
            [id]
        );

        if (existingTenant.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                message: 'The requested tenant does not exist'
            });
        }

        // Check if tenant has any users
        const userCountResult = await query(
            'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1',
            [id]
        );

        const userCount = parseInt(userCountResult.rows[0].count);
        if (userCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Tenant has users',
                message: `Cannot delete tenant. It has ${userCount} user(s). Please remove all users first.`
            });
        }

        // Delete tenant (cascade will handle related data)
        await query(
            'DELETE FROM tenants WHERE id = $1',
            [id]
        );

        res.json({
            success: true,
            message: 'Tenant deleted successfully'
        });

        logger.info('Tenant deleted successfully', {
            tenantId: id,
            tenantName: existingTenant.rows[0].name,
            deletedBy: req.user.id
        });

    } catch (error) {
        logger.error('Delete tenant error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while deleting the tenant'
        });
    }
});

// @route   GET /api/tenants/:id/stats
// @desc    Get tenant statistics
// @access  Private (super admin only)
router.get('/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;

        // Check if tenant exists
        const tenantCheck = await query(
            'SELECT id, name FROM tenants WHERE id = $1',
            [id]
        );

        if (tenantCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found',
                message: 'The requested tenant does not exist'
            });
        }

        // Get statistics
        const statsResult = await query(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE tenant_id = $1) as total_users,
        (SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND status = 'active') as active_users,
        (SELECT COUNT(*) FROM extensions WHERE tenant_id = $1) as total_extensions,
        (SELECT COUNT(*) FROM extensions WHERE tenant_id = $1 AND status = 'active') as active_extensions,
        (SELECT COUNT(*) FROM departments WHERE tenant_id = $1) as total_departments,
        (SELECT COUNT(*) FROM roles WHERE tenant_id = $1) as total_roles,
        (SELECT COUNT(*) FROM call_sessions WHERE tenant_id = $1) as total_calls,
        (SELECT COUNT(*) FROM call_sessions WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '24 hours') as calls_today,
        (SELECT COUNT(*) FROM call_sessions WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days') as calls_this_week
    `, [id]);

        res.json({
            success: true,
            data: {
                tenant: tenantCheck.rows[0],
                stats: statsResult.rows[0]
            }
        });

    } catch (error) {
        logger.error('Get tenant stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching tenant statistics'
        });
    }
});

module.exports = router; 