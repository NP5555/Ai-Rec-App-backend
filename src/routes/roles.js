const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../database/connection');
const { authenticateToken, requirePermission, requireSuperAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Get all roles for tenant
 *     description: Retrieve a paginated list of roles for the current tenant
 *     tags: [Roles]
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
 *         description: Number of roles per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for role name or description
 *       - in: query
 *         name: isSystemRole
 *         schema:
 *           type: boolean
 *         description: Filter by system role status
 *     responses:
 *       200:
 *         description: Roles retrieved successfully
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
 *                     roles:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Role'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 *             example:
 *               success: true
 *               data:
 *                 roles:
 *                   - id: "role-123"
 *                     name: "Admin"
 *                     description: "Administrator role with full access"
 *                     permissions: ["users:read", "users:write", "roles:read"]
 *                     isSystemRole: false
 *                     userCount: 5
 *                 pagination:
 *                   page: 1
 *                   limit: 10
 *                   total: 8
 *                   totalPages: 1
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
router.get('/', requirePermission('roles:read'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search, isSystemRole } = req.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('roles')
            .select(`
                id, name, description, permissions, is_system_role,
                created_at, updated_at,
                user_roles!left(user_id)
            `)
            .eq('tenant_id', req.user.tenantId);

        // Apply filters
        if (search) {
            query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
        }

        if (isSystemRole !== undefined) {
            query = query.eq('is_system_role', isSystemRole === 'true');
        }

        // Get total count first
        const { count: total, error: countError } = await supabase
            .from('roles')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', req.user.tenantId);

        if (countError) {
            logger.error('Error getting role count:', countError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get role count'
            });
        }

        // Apply pagination and ordering
        query = query.range(offset, offset + limit - 1);
        query = query.order('is_system_role', { ascending: false });
        query = query.order('created_at', { ascending: true });

        const { data: roles, error: rolesError } = await query;

        if (rolesError) {
            logger.error('Error fetching roles:', rolesError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch roles'
            });
        }

        // Transform the data to match expected format
        const transformedRoles = roles.map(role => ({
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            isSystemRole: role.is_system_role,
            createdAt: role.created_at,
            updatedAt: role.updated_at,
            userCount: role.user_roles ? role.user_roles.length : 0
        }));

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                roles: transformedRoles,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages
                }
            }
        });

    } catch (error) {
        logger.error('Get roles error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching roles'
        });
    }
});

// @route   GET /api/roles/:id
// @desc    Get role by ID
// @access  Private (requires roles:read permission)
router.get('/:id', requirePermission('roles:read'), async (req, res) => {
    try {
        const { id } = req.params;

        const { data: role, error: roleError } = await supabase
            .from('roles')
            .select(`
                id, name, description, permissions, is_system_role,
                created_at, updated_at,
                user_roles!left(user_id)
            `)
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (roleError) {
            logger.error('Error fetching role by ID:', roleError);
            if (roleError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Role not found',
                    message: 'The requested role does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch role by ID'
            });
        }

        if (!role) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        // Transform the data to match expected format
        const transformedRole = {
            id: role.id,
            name: role.name,
            description: role.description,
            permissions: role.permissions,
            isSystemRole: role.is_system_role,
            createdAt: role.created_at,
            updatedAt: role.updated_at,
            users: role.user_roles ? role.user_roles.map(ur => ({
                id: ur.user_id,
                email: ur.users.email,
                firstName: ur.users.first_name,
                lastName: ur.users.last_name
            })) : []
        };

        res.json({
            success: true,
            data: {
                role: transformedRole
            }
        });

    } catch (error) {
        logger.error('Get role error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching the role'
        });
    }
});

// @route   POST /api/roles
// @desc    Create a new role
// @access  Private (requires roles:create permission)
router.post('/', [
    requirePermission('roles:create'),
    body('name', 'Role name is required').notEmpty().isLength({ min: 2, max: 100 }),
    body('description').optional().isLength({ max: 500 }),
    body('permissions', 'Permissions must be an array').isArray()
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

        const { name, description, permissions } = req.body;

        // Check if role name already exists in the same tenant
        const { data: existingRole, error: existingRoleError } = await supabase
            .from('roles')
            .select('id')
            .eq('name', name)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingRoleError) {
            logger.error('Error checking existing role:', existingRoleError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check existing role'
            });
        }

        if (existingRole) {
            return res.status(409).json({
                success: false,
                error: 'Role already exists',
                message: 'A role with this name already exists in your organization'
            });
        }

        // Create role
        const { data: newRole, error: newRoleError } = await supabase
            .from('roles')
            .insert({
                id: supabase.genId(),
                tenant_id: req.user.tenantId,
                name: name,
                description: description || null,
                permissions: JSON.stringify(permissions),
                is_system_role: false
            })
            .select()
            .single();

        if (newRoleError) {
            logger.error('Error creating role:', newRoleError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to create role'
            });
        }

        res.status(201).json({
            success: true,
            message: 'Role created successfully',
            data: {
                role: newRole
            }
        });

        logger.info('Role created successfully', {
            roleId: newRole.id,
            roleName: newRole.name,
            createdBy: req.user.id
        });

    } catch (error) {
        logger.error('Create role error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while creating the role'
        });
    }
});

// @route   PUT /api/roles/:id
// @desc    Update role
// @access  Private (requires roles:update permission)
router.put('/:id', [
    requirePermission('roles:update'),
    body('name').optional().notEmpty().isLength({ min: 2, max: 100 }),
    body('description').optional().isLength({ max: 500 }),
    body('permissions').optional().isArray()
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
        const { name, description, permissions } = req.body;

        // Check if role exists and belongs to tenant
        const { data: existingRole, error: existingRoleError } = await supabase
            .from('roles')
            .select('id, name, is_system_role')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingRoleError) {
            logger.error('Error checking existing role for update:', existingRoleError);
            if (existingRoleError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Role not found',
                    message: 'The requested role does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check existing role for update'
            });
        }

        if (!existingRole) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        // Prevent modification of system roles (except by super admin)
        if (existingRole.is_system_role && !req.user.permissions.includes('system:admin')) {
            return res.status(403).json({
                success: false,
                error: 'Cannot modify system role',
                message: 'System roles cannot be modified by regular administrators'
            });
        }

        // Check if name is being changed and if it's already taken
        if (name && name !== existingRole.name) {
            const { data: nameCheck, error: nameCheckError } = await supabase
                .from('roles')
                .select('id')
                .eq('name', name)
                .eq('tenant_id', req.user.tenantId)
                .eq('id', id)
                .single();

            if (nameCheckError) {
                logger.error('Error checking name uniqueness for update:', nameCheckError);
                return res.status(500).json({
                    success: false,
                    error: 'Server error',
                    message: 'Failed to check name uniqueness for update'
                });
            }

            if (nameCheck) {
                return res.status(409).json({
                    success: false,
                    error: 'Role name already exists',
                    message: 'A role with this name already exists in your organization'
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

        if (permissions) {
            paramCount++;
            updateFields.push(`permissions = $${paramCount}`);
            updateParams.push(JSON.stringify(permissions));
        }

        // Update role
        if (updateFields.length > 0) {
            paramCount++;
            updateParams.push(id);
            paramCount++;
            updateParams.push(req.user.tenantId);

            const { error: updateError } = await supabase
                .from('roles')
                .update({
                    [updateFields.join(', ')]: updateParams
                })
                .eq('id', id)
                .eq('tenant_id', req.user.tenantId);

            if (updateError) {
                logger.error('Error updating role:', updateError);
                return res.status(500).json({
                    success: false,
                    error: 'Server error',
                    message: 'Failed to update role'
                });
            }
        }

        // Get updated role
        const { data: updatedRole, error: updatedRoleError } = await supabase
            .from('roles')
            .select('id, name, description, permissions, is_system_role, created_at, updated_at')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (updatedRoleError) {
            logger.error('Error fetching updated role:', updatedRoleError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch updated role'
            });
        }

        res.json({
            success: true,
            message: 'Role updated successfully',
            data: {
                role: updatedRole
            }
        });

        logger.info('Role updated successfully', {
            roleId: id,
            roleName: updatedRole.name,
            updatedBy: req.user.id
        });

    } catch (error) {
        logger.error('Update role error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while updating the role'
        });
    }
});

// @route   DELETE /api/roles/:id
// @desc    Delete role
// @access  Private (requires roles:delete permission)
router.delete('/:id', requirePermission('roles:delete'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if role exists and belongs to tenant
        const { data: existingRole, error: existingRoleError } = await supabase
            .from('roles')
            .select('id, name, is_system_role')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingRoleError) {
            logger.error('Error checking existing role for deletion:', existingRoleError);
            if (existingRoleError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Role not found',
                    message: 'The requested role does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check existing role for deletion'
            });
        }

        if (!existingRole) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        // Prevent deletion of system roles (except by super admin)
        if (existingRole.is_system_role && !req.user.permissions.includes('system:admin')) {
            return res.status(403).json({
                success: false,
                error: 'Cannot delete system role',
                message: 'System roles cannot be deleted by regular administrators'
            });
        }

        // Check if role is assigned to any users
        const { count: userCount, error: userCountError } = await supabase
            .from('user_roles')
            .select('*', { count: 'exact' })
            .eq('role_id', id);

        if (userCountError) {
            logger.error('Error getting user count for deletion:', userCountError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get user count for deletion'
            });
        }

        const userCountInt = parseInt(userCount);
        if (userCountInt > 0) {
            return res.status(400).json({
                success: false,
                error: 'Role in use',
                message: `Cannot delete role. It is assigned to ${userCountInt} user(s). Please reassign or remove users first.`
            });
        }

        // Delete role
        const { error: deleteError } = await supabase
            .from('roles')
            .delete()
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId);

        if (deleteError) {
            logger.error('Error deleting role:', deleteError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to delete role'
            });
        }

        res.json({
            success: true,
            message: 'Role deleted successfully'
        });

        logger.info('Role deleted successfully', {
            roleId: id,
            roleName: existingRole.name,
            deletedBy: req.user.id
        });

    } catch (error) {
        logger.error('Delete role error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while deleting the role'
        });
    }
});

// @route   GET /api/roles/:id/users
// @desc    Get users assigned to a role
// @access  Private (requires roles:read permission)
router.get('/:id/users', requirePermission('roles:read'), async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        // Check if role exists and belongs to tenant
        const { data: roleCheck, error: roleCheckError } = await supabase
            .from('roles')
            .select('id, name')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (roleCheckError) {
            logger.error('Error checking role for user assignment:', roleCheckError);
            if (roleCheckError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'Role not found',
                    message: 'The requested role does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check role for user assignment'
            });
        }

        if (!roleCheck) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        // Get users assigned to this role
        const { data: users, error: usersError } = await supabase
            .from('user_roles')
            .select(`
                u.id, u.email, u.first_name, u.last_name, u.phone, u.status,
                u.last_login, u.created_at,
                ur.assigned_at, ur.assigned_by,
                assigned_by_user.email as assigned_by_email
            `)
            .eq('ur.role_id', id)
            .eq('u.tenant_id', req.user.tenantId)
            .range(offset, offset + limit - 1)
            .order('ur.assigned_at', { ascending: false });

        if (usersError) {
            logger.error('Error fetching users for role:', usersError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch users for role'
            });
        }

        // Get total count
        const { count: total, error: countError } = await supabase
            .from('user_roles')
            .select('*', { count: 'exact' })
            .eq('ur.role_id', id)
            .eq('u.tenant_id', req.user.tenantId);

        if (countError) {
            logger.error('Error getting user count for role:', countError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get user count for role'
            });
        }

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                role: roleCheck,
                users: users,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages
                }
            }
        });

    } catch (error) {
        logger.error('Get role users error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching role users'
        });
    }
});

// @route   GET /api/roles/permissions/available
// @desc    Get available permissions
// @access  Private (requires roles:read permission)
router.get('/permissions/available', requirePermission('roles:read'), async (req, res) => {
    try {
        // Define available permissions
        const availablePermissions = {
            users: [
                'users:create',
                'users:read',
                'users:update',
                'users:delete'
            ],
            roles: [
                'roles:create',
                'roles:read',
                'roles:update',
                'roles:delete'
            ],
            tenants: [
                'tenants:create',
                'tenants:read',
                'tenants:update',
                'tenants:delete'
            ],
            extensions: [
                'extensions:create',
                'extensions:read',
                'extensions:update',
                'extensions:delete'
            ],
            departments: [
                'departments:create',
                'departments:read',
                'departments:update',
                'departments:delete'
            ],
            ivr: [
                'ivr:create',
                'ivr:read',
                'ivr:update',
                'ivr:delete'
            ],
            system: [
                'system:admin'
            ]
        };

        res.json({
            success: true,
            data: {
                permissions: availablePermissions
            }
        });

    } catch (error) {
        logger.error('Get available permissions error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching available permissions'
        });
    }
});

module.exports = router; 