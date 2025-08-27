const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../database/connection');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @swagger
 * /api/extensions:
 *   get:
 *     summary: Get all extensions for tenant
 *     description: Retrieve a paginated list of phone extensions for the current tenant
 *     tags: [Extensions]
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
 *         description: Number of extensions per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for extension number or name
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter by extension status
 *       - in: query
 *         name: department
 *         schema:
 *           type: string
 *         description: Filter by department name
 *     responses:
 *       200:
 *         description: Extensions retrieved successfully
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
 *                     extensions:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Extension'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 extensions:
 *                   - id: "ext-123"
 *                     extensionNumber: "1001"
 *                     name: "Sales Department"
 *                     status: "active"
 *                     departmentName: "Sales"
 *                 pagination:
 *                   page: 1
 *                   limit: 10
 *                   total: 15
 *                   totalPages: 2
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Forbidden - insufficient permissions
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
router.get('/', requirePermission('extensions:read'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status, department } = req.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('extensions')
            .select(`
                id, extension_number, name, description, dial_plan, status,
                created_at, updated_at,
                departments!left(id, name),
                users!left(id, email, first_name, last_name)
            `)
            .eq('tenant_id', req.user.tenantId);

        // Apply filters
        if (search) {
            query = query.or(`extension_number.ilike.%${search}%,name.ilike.%${search}%`);
        }

        if (status) {
            query = query.eq('status', status);
        }

        if (department) {
            query = query.eq('departments.name', department);
        }

        // Get total count first
        const { count: total, error: countError } = await supabase
            .from('extensions')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', req.user.tenantId);

        if (countError) {
            logger.error('Error getting extension count:', countError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get extension count'
            });
        }

        // Apply pagination and ordering
        query = query.range(offset, offset + limit - 1);
        query = query.order('extension_number', { ascending: true });

        const { data: extensions, error: extensionsError } = await query;

        if (extensionsError) {
            logger.error('Error fetching extensions:', extensionsError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch extensions'
            });
        }

        // Transform the data to match expected format
        const transformedExtensions = extensions.map(extension => ({
            id: extension.id,
            extensionNumber: extension.extension_number,
            name: extension.name,
            description: extension.description,
            dialPlan: extension.dial_plan,
            status: extension.status,
            createdAt: extension.created_at,
            updatedAt: extension.updated_at,
            departmentId: extension.departments ? extension.departments.id : null,
            departmentName: extension.departments ? extension.departments.name : null,
            userId: extension.users ? extension.users.id : null,
            userEmail: extension.users ? extension.users.email : null,
            firstName: extension.users ? extension.users.first_name : null,
            lastName: extension.users ? extension.users.last_name : null
        }));

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                extensions: transformedExtensions,
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

        const { data: extension, error: extensionError } = await supabase
            .from('extensions')
            .select(`
                id, extension_number, name, description, dial_plan, status,
                created_at, updated_at,
                departments!left(id, name),
                users!left(id, email, first_name, last_name)
            `)
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (extensionError) {
            if (extensionError.code === 'PGRST116') { // Record not found
                return res.status(404).json({
                    success: false,
                    error: 'Extension not found',
                    message: 'The requested extension does not exist'
                });
            }
            logger.error('Error fetching extension by ID:', extensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch extension by ID'
            });
        }

        if (!extension) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'The requested extension does not exist'
            });
        }

        res.json({
            success: true,
            data: {
                extension: {
                    id: extension.id,
                    extensionNumber: extension.extension_number,
                    name: extension.name,
                    description: extension.description,
                    dialPlan: extension.dial_plan,
                    status: extension.status,
                    createdAt: extension.created_at,
                    updatedAt: extension.updated_at,
                    departmentId: extension.departments ? extension.departments.id : null,
                    departmentName: extension.departments ? extension.departments.name : null,
                    userId: extension.users ? extension.users.id : null,
                    userEmail: extension.users ? extension.users.email : null,
                    firstName: extension.users ? extension.users.first_name : null,
                    lastName: extension.users ? extension.users.last_name : null
                }
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
        const { data: existingExtension, error: existingExtensionError } = await supabase
            .from('extensions')
            .select('id')
            .eq('extension_number', extensionNumber)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingExtensionError) {
            logger.error('Error checking for existing extension:', existingExtensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing extension'
            });
        }

        if (existingExtension) {
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
        const { data: newExtension, error: newExtensionError } = await supabase
            .from('extensions')
            .insert([{
                id: supabase.helpers.createId(),
                tenant_id: req.user.tenantId,
                extension_number: extensionNumber,
                name: name,
                description: description || null,
                user_id: userId || null,
                department_id: departmentId || null,
                dial_plan: JSON.stringify(dialPlan),
                status: status
            }])
            .select()
            .single();

        if (newExtensionError) {
            logger.error('Error creating extension:', newExtensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to create extension'
            });
        }

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
        const { data: existingExtension, error: existingExtensionError } = await supabase
            .from('extensions')
            .select('id, extension_number')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingExtensionError) {
            if (existingExtensionError.code === 'PGRST116') { // Record not found
                return res.status(404).json({
                    success: false,
                    error: 'Extension not found',
                    message: 'The requested extension does not exist'
                });
            }
            logger.error('Error checking for existing extension:', existingExtensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing extension'
            });
        }

        if (!existingExtension) {
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

            const { error: updateError } = await supabase
                .from('extensions')
                .update({
                    [updateFields.join(', ')]: updateParams
                })
                .eq('id', id)
                .eq('tenant_id', req.user.tenantId);

            if (updateError) {
                logger.error('Error updating extension:', updateError);
                return res.status(500).json({
                    success: false,
                    error: 'Server error',
                    message: 'Failed to update extension'
                });
            }
        }

        // Get updated extension
        const { data: updatedExtension, error: updatedExtensionError } = await supabase
            .from('extensions')
            .select(`
                id, extension_number, name, description, dial_plan, status,
                created_at, updated_at,
                departments!left(id, name),
                users!left(id, email, first_name, last_name)
            `)
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (updatedExtensionError) {
            logger.error('Error fetching updated extension:', updatedExtensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch updated extension'
            });
        }

        if (!updatedExtension) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'The requested extension does not exist'
            });
        }

        res.json({
            success: true,
            message: 'Extension updated successfully',
            data: {
                extension: {
                    id: updatedExtension.id,
                    extensionNumber: updatedExtension.extension_number,
                    name: updatedExtension.name,
                    description: updatedExtension.description,
                    dialPlan: updatedExtension.dial_plan,
                    status: updatedExtension.status,
                    createdAt: updatedExtension.created_at,
                    updatedAt: updatedExtension.updated_at,
                    departmentId: updatedExtension.departments ? updatedExtension.departments.id : null,
                    departmentName: updatedExtension.departments ? updatedExtension.departments.name : null,
                    userId: updatedExtension.users ? updatedExtension.users.id : null,
                    userEmail: updatedExtension.users ? updatedExtension.users.email : null,
                    firstName: updatedExtension.users ? updatedExtension.users.first_name : null,
                    lastName: updatedExtension.users ? updatedExtension.users.last_name : null
                }
            }
        });

        logger.info('Extension updated successfully', {
            extensionId: id,
            extensionNumber: existingExtension.extension_number,
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
        const { data: existingExtension, error: existingExtensionError } = await supabase
            .from('extensions')
            .select('id, extension_number')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingExtensionError) {
            if (existingExtensionError.code === 'PGRST116') { // Record not found
                return res.status(404).json({
                    success: false,
                    error: 'Extension not found',
                    message: 'The requested extension does not exist'
                });
            }
            logger.error('Error checking for existing extension:', existingExtensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing extension'
            });
        }

        if (!existingExtension) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'The requested extension does not exist'
            });
        }

        // Delete extension
        const { error: deleteError } = await supabase
            .from('extensions')
            .delete()
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId);

        if (deleteError) {
            logger.error('Error deleting extension:', deleteError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to delete extension'
            });
        }

        res.json({
            success: true,
            message: 'Extension deleted successfully'
        });

        logger.info('Extension deleted successfully', {
            extensionId: id,
            extensionNumber: existingExtension.extension_number,
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

        const { data: extension, error: extensionError } = await supabase
            .from('extensions')
            .select(`
                id, extension_number, name, description, dial_plan, status,
                departments!left(id, name),
                users!left(id, email, first_name, last_name)
            `)
            .eq('extension_number', number)
            .eq('tenant_id', req.user.tenantId)
            .eq('status', 'active')
            .single();

        if (extensionError) {
            if (extensionError.code === 'PGRST116') { // Record not found
                return res.status(404).json({
                    success: false,
                    error: 'Extension not found',
                    message: 'Extension not found or inactive'
                });
            }
            logger.error('Error searching extension by number:', extensionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to search extension by number'
            });
        }

        if (!extension) {
            return res.status(404).json({
                success: false,
                error: 'Extension not found',
                message: 'Extension not found or inactive'
            });
        }

        res.json({
            success: true,
            data: {
                extension: {
                    id: extension.id,
                    extensionNumber: extension.extension_number,
                    name: extension.name,
                    description: extension.description,
                    dialPlan: extension.dial_plan,
                    status: extension.status,
                    departmentId: extension.departments ? extension.departments.id : null,
                    departmentName: extension.departments ? extension.departments.name : null,
                    userId: extension.users ? extension.users.id : null,
                    userEmail: extension.users ? extension.users.email : null,
                    firstName: extension.users ? extension.users.first_name : null,
                    lastName: extension.users ? extension.users.last_name : null
                }
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