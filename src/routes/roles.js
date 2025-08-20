const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../database/connection');
const { authenticateToken, requirePermission, requireSuperAdmin } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// @route   GET /api/roles
// @desc    Get all roles for tenant
// @access  Private (requires roles:read permission)
router.get('/', requirePermission('roles:read'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search, isSystemRole } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE r.tenant_id = $1';
        let params = [req.user.tenantId];
        let paramCount = 1;

        if (search) {
            paramCount++;
            whereClause += ` AND (r.name ILIKE $${paramCount} OR r.description ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        if (isSystemRole !== undefined) {
            paramCount++;
            whereClause += ` AND r.is_system_role = $${paramCount}`;
            params.push(isSystemRole === 'true');
        }

        // Get roles with user count
        const rolesResult = await query(`
      SELECT 
        r.id, r.name, r.description, r.permissions, r.is_system_role,
        r.created_at, r.updated_at,
        COUNT(ur.user_id) as user_count
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      ${whereClause}
      GROUP BY r.id
      ORDER BY r.is_system_role DESC, r.created_at ASC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...params, limit, offset]);

        // Get total count
        const countResult = await query(`
      SELECT COUNT(*) as total
      FROM roles r
      ${whereClause}
    `, params);

        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                roles: rolesResult.rows,
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

        const roleResult = await query(`
      SELECT 
        r.id, r.name, r.description, r.permissions, r.is_system_role,
        r.created_at, r.updated_at,
        json_agg(
          json_build_object(
            'id', u.id,
            'email', u.email,
            'firstName', u.first_name,
            'lastName', u.last_name
          )
        ) as users
      FROM roles r
      LEFT JOIN user_roles ur ON r.id = ur.role_id
      LEFT JOIN users u ON ur.user_id = u.id
      WHERE r.id = $1 AND r.tenant_id = $2
      GROUP BY r.id
    `, [id, req.user.tenantId]);

        if (roleResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        res.json({
            success: true,
            data: {
                role: roleResult.rows[0]
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
        const existingRole = await query(
            'SELECT id FROM roles WHERE name = $1 AND tenant_id = $2',
            [name, req.user.tenantId]
        );

        if (existingRole.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Role already exists',
                message: 'A role with this name already exists in your organization'
            });
        }

        // Create role
        const roleResult = await query(`
      INSERT INTO roles (id, tenant_id, name, description, permissions, is_system_role)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, false)
      RETURNING id, name, description, permissions, is_system_role, created_at
    `, [req.user.tenantId, name, description || null, JSON.stringify(permissions)]);

        const newRole = roleResult.rows[0];

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
        const existingRole = await query(
            'SELECT id, name, is_system_role FROM roles WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingRole.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        const role = existingRole.rows[0];

        // Prevent modification of system roles (except by super admin)
        if (role.is_system_role && !req.user.permissions.includes('system:admin')) {
            return res.status(403).json({
                success: false,
                error: 'Cannot modify system role',
                message: 'System roles cannot be modified by regular administrators'
            });
        }

        // Check if name is being changed and if it's already taken
        if (name && name !== role.name) {
            const nameCheck = await query(
                'SELECT id FROM roles WHERE name = $1 AND tenant_id = $2 AND id != $3',
                [name, req.user.tenantId, id]
            );

            if (nameCheck.rows.length > 0) {
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

            await query(`
        UPDATE roles 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramCount - 1} AND tenant_id = $${paramCount}
      `, updateParams);
        }

        // Get updated role
        const updatedRoleResult = await query(`
      SELECT id, name, description, permissions, is_system_role, created_at, updated_at
      FROM roles
      WHERE id = $1 AND tenant_id = $2
    `, [id, req.user.tenantId]);

        res.json({
            success: true,
            message: 'Role updated successfully',
            data: {
                role: updatedRoleResult.rows[0]
            }
        });

        logger.info('Role updated successfully', {
            roleId: id,
            roleName: updatedRoleResult.rows[0].name,
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
        const existingRole = await query(
            'SELECT id, name, is_system_role FROM roles WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingRole.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        const role = existingRole.rows[0];

        // Prevent deletion of system roles (except by super admin)
        if (role.is_system_role && !req.user.permissions.includes('system:admin')) {
            return res.status(403).json({
                success: false,
                error: 'Cannot delete system role',
                message: 'System roles cannot be deleted by regular administrators'
            });
        }

        // Check if role is assigned to any users
        const userCountResult = await query(
            'SELECT COUNT(*) as count FROM user_roles WHERE role_id = $1',
            [id]
        );

        const userCount = parseInt(userCountResult.rows[0].count);
        if (userCount > 0) {
            return res.status(400).json({
                success: false,
                error: 'Role in use',
                message: `Cannot delete role. It is assigned to ${userCount} user(s). Please reassign or remove users first.`
            });
        }

        // Delete role
        await query(
            'DELETE FROM roles WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        res.json({
            success: true,
            message: 'Role deleted successfully'
        });

        logger.info('Role deleted successfully', {
            roleId: id,
            roleName: role.name,
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
        const roleCheck = await query(
            'SELECT id, name FROM roles WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (roleCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found',
                message: 'The requested role does not exist'
            });
        }

        // Get users assigned to this role
        const usersResult = await query(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.phone, u.status,
        u.last_login, u.created_at,
        ur.assigned_at, ur.assigned_by,
        assigned_by_user.email as assigned_by_email
      FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      LEFT JOIN users assigned_by_user ON ur.assigned_by = assigned_by_user.id
      WHERE ur.role_id = $1 AND u.tenant_id = $2
      ORDER BY ur.assigned_at DESC
      LIMIT $3 OFFSET $4
    `, [id, req.user.tenantId, limit, offset]);

        // Get total count
        const countResult = await query(`
      SELECT COUNT(*) as total
      FROM user_roles ur
      JOIN users u ON ur.user_id = u.id
      WHERE ur.role_id = $1 AND u.tenant_id = $2
    `, [id, req.user.tenantId]);

        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                role: roleCheck.rows[0],
                users: usersResult.rows,
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