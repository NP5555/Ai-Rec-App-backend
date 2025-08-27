const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../database/connection');
const { authenticateToken, requireSuperAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication and super admin check to all routes
router.use(authenticateToken);
router.use(requireSuperAdmin);

/**
 * @swagger
 * /api/tenants:
 *   get:
 *     summary: Get all tenants (super admin only)
 *     description: Retrieve a paginated list of all tenants in the system
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of tenants per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for tenant name or domain
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter by tenant status
 *     responses:
 *       200:
 *         description: Tenants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     tenants:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Tenant'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 tenants:
 *                   - id: "tenant-123"
 *                     name: "Acme Corporation"
 *                     domain: "acme.com"
 *                     status: "active"
 *                     userCount: 25
 *                     extensionCount: 10
 *                 pagination:
 *                   page: 1
 *                   limit: 10
 *                   total: 5
 *                   totalPages: 1
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - super admin access required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status } = req.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('tenants')
            .select(`
                id, name, domain, status, settings, created_at, updated_at,
                users!left(id),
                extensions!left(id)
            `);

        // Apply filters
        if (search) {
            query = query.or(`name.ilike.%${search}%,domain.ilike.%${search}%`);
        }

        if (status) {
            query = query.eq('status', status);
        }

        // Get total count first
        const { count: total, error: countError } = await supabase
            .from('tenants')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            logger.error('Error getting tenant count:', countError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get tenant count'
            });
        }

        // Apply pagination and ordering
        query = query.range(offset, offset + limit - 1);
        query = query.order('created_at', { ascending: false });

        const { data: tenants, error: tenantsError } = await query;

        if (tenantsError) {
            logger.error('Error fetching tenants:', tenantsError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch tenants'
            });
        }

        // Transform the data to match expected format
        const transformedTenants = tenants.map(tenant => ({
            id: tenant.id,
            name: tenant.name,
            domain: tenant.domain,
            status: tenant.status,
            settings: tenant.settings,
            createdAt: tenant.created_at,
            updatedAt: tenant.updated_at,
            userCount: tenant.users ? tenant.users.length : 0,
            extensionCount: tenant.extensions ? tenant.extensions.length : 0
        }));

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                tenants: transformedTenants,
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

        const tenantResult = await supabase
            .from('tenants')
            .select(`
                id, name, domain, status, settings, created_at, updated_at,
                users!left(id),
                extensions!left(id),
                departments!left(id)
            `)
            .eq('id', id)
            .single();

        if (tenantResult.error) {
            if (tenantResult.error.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found',
                    message: 'The requested tenant does not exist'
                });
            }
            logger.error('Error fetching tenant by ID:', tenantResult.error);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch tenant by ID'
            });
        }

        const tenant = tenantResult.data;

        res.json({
            success: true,
            data: {
                tenant: {
                    id: tenant.id,
                    name: tenant.name,
                    domain: tenant.domain,
                    status: tenant.status,
                    settings: tenant.settings,
                    createdAt: tenant.created_at,
                    updatedAt: tenant.updated_at,
                    userCount: tenant.users ? tenant.users.length : 0,
                    extensionCount: tenant.extensions ? tenant.extensions.length : 0,
                    departmentCount: tenant.departments ? tenant.departments.length : 0
                }
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
        const { data: existingTenant, error: domainError } = await supabase
            .from('tenants')
            .select('id')
            .eq('domain', domain)
            .single();

        if (domainError) {
            logger.error('Error checking domain existence:', domainError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check domain existence'
            });
        }

        if (existingTenant) {
            return res.status(409).json({
                success: false,
                error: 'Domain already exists',
                message: 'A tenant with this domain already exists'
            });
        }

        // Create tenant
        const { data: newTenant, error: insertError } = await supabase
            .from('tenants')
            .insert([{
                id: supabase.genId(),
                name: name,
                domain: domain,
                status: 'active',
                settings: JSON.stringify(settings)
            }])
            .select()
            .single();

        if (insertError) {
            logger.error('Error creating tenant:', insertError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to create tenant'
            });
        }

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
        const { data: existingTenant, error: selectError } = await supabase
            .from('tenants')
            .select('id, name, domain')
            .eq('id', id)
            .single();

        if (selectError) {
            if (selectError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found',
                    message: 'The requested tenant does not exist'
                });
            }
            logger.error('Error selecting tenant for update:', selectError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to select tenant for update'
            });
        }

        // Check if domain is being changed and if it's already taken
        if (domain && domain !== existingTenant.domain) {
            const { data: domainCheck, error: domainCheckError } = await supabase
                .from('tenants')
                .select('id')
                .eq('domain', domain)
                .neq('id', id)
                .single();

            if (domainCheckError) {
                logger.error('Error checking domain existence for update:', domainCheckError);
                return res.status(500).json({
                    success: false,
                    error: 'Server error',
                    message: 'Failed to check domain existence for update'
                });
            }

            if (domainCheck) {
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

            const { error: updateError } = await supabase
                .from('tenants')
                .update({
                    [updateFields.join(', ')]: updateParams
                })
                .eq('id', id);

            if (updateError) {
                logger.error('Error updating tenant:', updateError);
                return res.status(500).json({
                    success: false,
                    error: 'Server error',
                    message: 'Failed to update tenant'
                });
            }
        }

        // Get updated tenant
        const { data: updatedTenant, error: selectUpdatedError } = await supabase
            .from('tenants')
            .select('id, name, domain, status, settings, created_at, updated_at')
            .eq('id', id)
            .single();

        if (selectUpdatedError) {
            logger.error('Error selecting updated tenant:', selectUpdatedError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to select updated tenant'
            });
        }

        res.json({
            success: true,
            message: 'Tenant updated successfully',
            data: {
                tenant: updatedTenant
            }
        });

        logger.info('Tenant updated successfully', {
            tenantId: id,
            tenantName: updatedTenant.name,
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
        const { data: existingTenant, error: selectError } = await supabase
            .from('tenants')
            .select('id, name, domain')
            .eq('id', id)
            .single();

        if (selectError) {
            if (selectError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found',
                    message: 'The requested tenant does not exist'
                });
            }
            logger.error('Error selecting tenant for deletion:', selectError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to select tenant for deletion'
            });
        }

        // Check if tenant has any users
        const { count: userCount, error: userCountError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', id);

        if (userCountError) {
            logger.error('Error getting user count for deletion:', userCountError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get user count for deletion'
            });
        }

        if (userCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Tenant has users',
                message: `Cannot delete tenant. It has ${userCount} user(s). Please remove all users first.`
            });
        }

        // Delete tenant (cascade will handle related data)
        const { error: deleteError } = await supabase
            .from('tenants')
            .delete()
            .eq('id', id);

        if (deleteError) {
            logger.error('Error deleting tenant:', deleteError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to delete tenant'
            });
        }

        res.json({
            success: true,
            message: 'Tenant deleted successfully'
        });

        logger.info('Tenant deleted successfully', {
            tenantId: id,
            tenantName: existingTenant.name,
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
        const { data: tenantCheck, error: selectError } = await supabase
            .from('tenants')
            .select('id, name')
            .eq('id', id)
            .single();

        if (selectError) {
            if (selectError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found',
                    message: 'The requested tenant does not exist'
                });
            }
            logger.error('Error selecting tenant for stats:', selectError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to select tenant for stats'
            });
        }

        // Get statistics
        const statsResult = await supabase
            .from('tenants')
            .select(`
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

        if (statsResult.error) {
            logger.error('Error fetching tenant stats:', statsResult.error);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch tenant statistics'
            });
        }

        res.json({
            success: true,
            data: {
                tenant: tenantCheck,
                stats: statsResult.data[0]
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