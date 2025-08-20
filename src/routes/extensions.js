const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// @route   GET /api/extensions
// @desc    Get all extensions for tenant
// @access  Private (requires extensions:read permission)
router.get('/', requirePermission('extensions:read'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status, department } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE e.tenant_id = $1';
        let params = [req.user.tenantId];
        let paramCount = 1;

        if (search) {
            paramCount++;
            whereClause += ` AND (e.extension_number ILIKE $${paramCount} OR e.name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        if (status) {
            paramCount++;
            whereClause += ` AND e.status = $${paramCount}`;
            params.push(status);
        }

        if (department) {
            paramCount++;
            whereClause += ` AND d.name = $${paramCount}`;
            params.push(department);
        }

        // Get extensions with department info
        const extensionsResult = await query(`
      SELECT 
        e.id, e.extension_number, e.name, e.description, e.dial_plan, e.status,
        e.created_at, e.updated_at,
        d.id as department_id, d.name as department_name,
        u.id as user_id, u.email as user_email, u.first_name, u.last_name
      FROM extensions e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN users u ON e.user_id = u.id
      ${whereClause}
      ORDER BY e.extension_number
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...params, limit, offset]);

        // Get total count
        const countResult = await query(`
      SELECT COUNT(*) as total
      FROM extensions e
      LEFT JOIN departments d ON e.department_id = d.id
      ${whereClause}
    `, params);

        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                extensions: extensionsResult.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages
                }
            }
        });

    } catch (error) {
        logger.error('Get extensions error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching extensions'
        });
    }
});

// @route   GET /api/extensions/:id
// @desc    Get extension by ID
// @access  Private (requires extensions:read permission)
router.get('/:id', requirePermission('extensions:read'), async (req, res) => {
    try {
        const { id } = req.params;

        const extensionResult = await query(`
      SELECT 
        e.id, e.extension_number, e.name, e.description, e.dial_plan, e.status,
        e.created_at, e.updated_at,
        d.id as department_id, d.name as department_name,
        u.id as user_id, u.email as user_email, u.first_name, u.last_name
      FROM extensions e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1 AND e.tenant_id = $2
    `, [id, req.user.tenantId]);

        if (extensionResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'The requested extension does not exist'
            });
        }

        res.json({
            success: true,
            data: {
                extension: extensionResult.rows[0]
            }
        });

    } catch (error) {
        logger.error('Get extension error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching the extension'
        });
    }
});

// @route   POST /api/extensions
// @desc    Create a new extension
// @access  Private (requires extensions:create permission)
router.post('/', [
    requirePermission('extensions:create'),
    body('extensionNumber', 'Extension number is required').notEmpty().isLength({ min: 1, max: 20 }),
    body('name', 'Extension name is required').notEmpty().isLength({ min: 2, max: 255 }),
    body('dialPlan', 'Dial plan is required').isObject()
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

        const { extensionNumber, name, description, userId, departmentId, dialPlan, status = 'active' } = req.body;

        // Check if extension number already exists in the same tenant
        const existingExtension = await query(
            'SELECT id FROM extensions WHERE extension_number = $1 AND tenant_id = $2',
            [extensionNumber, req.user.tenantId]
        );

        if (existingExtension.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Extension already exists',
                message: 'An extension with this number already exists in your organization'
            });
        }

        // Validate dial plan
        if (!dialPlan.type || !['simultaneous', 'sequential'].includes(dialPlan.type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid dial plan',
                message: 'Dial plan type must be either "simultaneous" or "sequential"'
            });
        }

        if (!dialPlan.destinations || !Array.isArray(dialPlan.destinations) || dialPlan.destinations.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid dial plan',
                message: 'Dial plan must have at least one destination'
            });
        }

        // Create extension
        const extensionResult = await query(`
      INSERT INTO extensions (id, tenant_id, extension_number, name, description, user_id, department_id, dial_plan, status)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, extension_number, name, description, dial_plan, status, created_at
    `, [req.user.tenantId, extensionNumber, name, description || null, userId || null, departmentId || null, JSON.stringify(dialPlan), status]);

        const newExtension = extensionResult.rows[0];

        res.status(201).json({
            success: true,
            message: 'Extension created successfully',
            data: {
                extension: newExtension
            }
        });

        logger.info('Extension created successfully', {
            extensionId: newExtension.id,
            extensionNumber: newExtension.extension_number,
            createdBy: req.user.id
        });

    } catch (error) {
        logger.error('Create extension error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while creating the extension'
        });
    }
});

// @route   PUT /api/extensions/:id
// @desc    Update extension
// @access  Private (requires extensions:update permission)
router.put('/:id', [
    requirePermission('extensions:update'),
    body('name').optional().notEmpty().isLength({ min: 2, max: 255 }),
    body('dialPlan').optional().isObject()
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
        const { name, description, userId, departmentId, dialPlan, status } = req.body;

        // Check if extension exists and belongs to tenant
        const existingExtension = await query(
            'SELECT id, extension_number FROM extensions WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingExtension.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'The requested extension does not exist'
            });
        }

        // Validate dial plan if provided
        if (dialPlan) {
            if (!dialPlan.type || !['simultaneous', 'sequential'].includes(dialPlan.type)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid dial plan',
                    message: 'Dial plan type must be either "simultaneous" or "sequential"'
                });
            }

            if (!dialPlan.destinations || !Array.isArray(dialPlan.destinations) || dialPlan.destinations.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid dial plan',
                    message: 'Dial plan must have at least one destination'
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

        if (description !== undefined) {
            paramCount++;
            updateFields.push(`description = $${paramCount}`);
            updateParams.push(description);
        }

        if (userId !== undefined) {
            paramCount++;
            updateFields.push(`user_id = $${paramCount}`);
            updateParams.push(userId);
        }

        if (departmentId !== undefined) {
            paramCount++;
            updateFields.push(`department_id = $${paramCount}`);
            updateParams.push(departmentId);
        }

        if (dialPlan) {
            paramCount++;
            updateFields.push(`dial_plan = $${paramCount}`);
            updateParams.push(JSON.stringify(dialPlan));
        }

        if (status) {
            paramCount++;
            updateFields.push(`status = $${paramCount}`);
            updateParams.push(status);
        }

        // Update extension
        if (updateFields.length > 0) {
            paramCount++;
            updateParams.push(id);
            paramCount++;
            updateParams.push(req.user.tenantId);

            await query(`
        UPDATE extensions 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramCount - 1} AND tenant_id = $${paramCount}
      `, updateParams);
        }

        // Get updated extension
        const updatedExtensionResult = await query(`
      SELECT 
        e.id, e.extension_number, e.name, e.description, e.dial_plan, e.status,
        e.created_at, e.updated_at,
        d.id as department_id, d.name as department_name,
        u.id as user_id, u.email as user_email, u.first_name, u.last_name
      FROM extensions e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.id = $1 AND e.tenant_id = $2
    `, [id, req.user.tenantId]);

        res.json({
            success: true,
            message: 'Extension updated successfully',
            data: {
                extension: updatedExtensionResult.rows[0]
            }
        });

        logger.info('Extension updated successfully', {
            extensionId: id,
            extensionNumber: existingExtension.rows[0].extension_number,
            updatedBy: req.user.id
        });

    } catch (error) {
        logger.error('Update extension error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while updating the extension'
        });
    }
});

// @route   DELETE /api/extensions/:id
// @desc    Delete extension
// @access  Private (requires extensions:delete permission)
router.delete('/:id', requirePermission('extensions:delete'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if extension exists and belongs to tenant
        const existingExtension = await query(
            'SELECT id, extension_number FROM extensions WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingExtension.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'The requested extension does not exist'
            });
        }

        // Delete extension
        await query(
            'DELETE FROM extensions WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        res.json({
            success: true,
            message: 'Extension deleted successfully'
        });

        logger.info('Extension deleted successfully', {
            extensionId: id,
            extensionNumber: existingExtension.rows[0].extension_number,
            deletedBy: req.user.id
        });

    } catch (error) {
        logger.error('Delete extension error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while deleting the extension'
        });
    }
});

// @route   GET /api/extensions/search/:number
// @desc    Search extension by number
// @access  Private (requires extensions:read permission)
router.get('/search/:number', requirePermission('extensions:read'), async (req, res) => {
    try {
        const { number } = req.params;

        const extensionResult = await query(`
      SELECT 
        e.id, e.extension_number, e.name, e.description, e.dial_plan, e.status,
        d.id as department_id, d.name as department_name,
        u.id as user_id, u.email as user_email, u.first_name, u.last_name
      FROM extensions e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.extension_number = $1 AND e.tenant_id = $2 AND e.status = 'active'
    `, [number, req.user.tenantId]);

        if (extensionResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'Extension not found or inactive'
            });
        }

        res.json({
            success: true,
            data: {
                extension: extensionResult.rows[0]
            }
        });

    } catch (error) {
        logger.error('Search extension error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while searching for the extension'
        });
    }
});

module.exports = router; 