const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult, query } = require('express-validator');
const { query: dbQuery } = require('../database/connection');
const { authenticateToken, requirePermission, requireAnyPermission } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// @route   GET /api/users
// @desc    Get all users for tenant
// @access  Private (requires users:read permission)
router.get('/', requirePermission('users:read'), async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status, role } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = 'WHERE u.tenant_id = $1';
        let params = [req.user.tenantId];
        let paramCount = 1;

        if (search) {
            paramCount++;
            whereClause += ` AND (u.email ILIKE $${paramCount} OR u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        if (status) {
            paramCount++;
            whereClause += ` AND u.status = $${paramCount}`;
            params.push(status);
        }

        if (role) {
            paramCount++;
            whereClause += ` AND r.name = $${paramCount}`;
            params.push(role);
        }

        // Get users with roles
        const usersResult = await dbQuery(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.phone, u.status, 
        u.last_login, u.created_at, u.updated_at,
        json_agg(
          json_build_object(
            'id', r.id,
            'name', r.name,
            'description', r.description
          )
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      ${whereClause}
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
    `, [...params, limit, offset]);

        // Get total count
        const countResult = await dbQuery(`
      SELECT COUNT(DISTINCT u.id) as total
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      ${whereClause}
    `, params);

        const total = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
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
        logger.error('Get users error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching users'
        });
    }
});

// @route   GET /api/users/:id
// @desc    Get user by ID
// @access  Private (requires users:read permission)
router.get('/:id', requirePermission('users:read'), async (req, res) => {
    try {
        const { id } = req.params;

        const userResult = await dbQuery(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.phone, u.status, 
        u.last_login, u.created_at, u.updated_at,
        json_agg(
          json_build_object(
            'id', r.id,
            'name', r.name,
            'description', r.description,
            'permissions', r.permissions
          )
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1 AND u.tenant_id = $2
      GROUP BY u.id
    `, [id, req.user.tenantId]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'The requested user does not exist'
            });
        }

        res.json({
            success: true,
            data: {
                user: userResult.rows[0]
            }
        });

    } catch (error) {
        logger.error('Get user error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching the user'
        });
    }
});

// @route   POST /api/users
// @desc    Create a new user
// @access  Private (requires users:create permission)
router.post('/', [
    requirePermission('users:create'),
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
    body('firstName', 'First name is required').notEmpty(),
    body('lastName', 'Last name is required').notEmpty(),
    body('roleIds', 'At least one role must be assigned').isArray({ min: 1 })
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

        const { email, password, firstName, lastName, phone, roleIds, status = 'active' } = req.body;

        // Check if user already exists in the same tenant
        const existingUser = await dbQuery(
            'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
            [email, req.user.tenantId]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'User already exists',
                message: 'A user with this email already exists in your organization'
            });
        }

        // Hash password
        const salt = await bcrypt.genSalt(12);
        const passwordHash = await bcrypt.hash(password, salt);

        // Create user
        const userResult = await dbQuery(`
      INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, phone, status)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
      RETURNING id, email, first_name, last_name, phone, status, created_at
    `, [req.user.tenantId, email, passwordHash, firstName, lastName, phone || null, status]);

        const newUser = userResult.rows[0];

        // Assign roles
        for (const roleId of roleIds) {
            await dbQuery(`
        INSERT INTO user_roles (id, user_id, role_id, assigned_by)
        VALUES (gen_random_uuid(), $1, $2, $3)
      `, [newUser.id, roleId, req.user.id]);
        }

        // Get assigned roles
        const rolesResult = await dbQuery(`
      SELECT r.id, r.name, r.description, r.permissions, r.is_system_role
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `, [newUser.id]);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    firstName: newUser.first_name,
                    lastName: newUser.last_name,
                    phone: newUser.phone,
                    status: newUser.status,
                    roles: rolesResult.rows
                }
            }
        });

        logger.info('User created successfully', {
            userId: newUser.id,
            email: newUser.email,
            createdBy: req.user.id
        });

    } catch (error) {
        logger.error('Create user error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while creating the user'
        });
    }
});

// @route   PUT /api/users/:id
// @desc    Update user
// @access  Private (requires users:update permission)
router.put('/:id', [
    requirePermission('users:update'),
    body('email').optional().isEmail().withMessage('Please include a valid email'),
    body('firstName').optional().notEmpty().withMessage('First name cannot be empty'),
    body('lastName').optional().notEmpty().withMessage('Last name cannot be empty')
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
        const { email, firstName, lastName, phone, status, roleIds } = req.body;

        // Check if user exists and belongs to tenant
        const existingUser = await dbQuery(
            'SELECT id FROM users WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingUser.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'The requested user does not exist'
            });
        }

        // Check if email is being changed and if it's already taken
        if (email) {
            const emailCheck = await dbQuery(
                'SELECT id FROM users WHERE email = $1 AND tenant_id = $2 AND id != $3',
                [email, req.user.tenantId, id]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: 'Email already exists',
                    message: 'A user with this email already exists in your organization'
                });
            }
        }

        // Build update query
        const updateFields = [];
        const updateParams = [];
        let paramCount = 0;

        if (email) {
            paramCount++;
            updateFields.push(`email = $${paramCount}`);
            updateParams.push(email);
        }

        if (firstName) {
            paramCount++;
            updateFields.push(`first_name = $${paramCount}`);
            updateParams.push(firstName);
        }

        if (lastName) {
            paramCount++;
            updateFields.push(`last_name = $${paramCount}`);
            updateParams.push(lastName);
        }

        if (phone !== undefined) {
            paramCount++;
            updateFields.push(`phone = $${paramCount}`);
            updateParams.push(phone);
        }

        if (status) {
            paramCount++;
            updateFields.push(`status = $${paramCount}`);
            updateParams.push(status);
        }

        // Update user
        if (updateFields.length > 0) {
            paramCount++;
            updateParams.push(id);
            paramCount++;
            updateParams.push(req.user.tenantId);

            await dbQuery(`
        UPDATE users 
        SET ${updateFields.join(', ')}, updated_at = NOW()
        WHERE id = $${paramCount - 1} AND tenant_id = $${paramCount}
      `, updateParams);
        }

        // Update roles if provided
        if (roleIds && Array.isArray(roleIds)) {
            // Remove existing roles
            await dbQuery(
                'DELETE FROM user_roles WHERE user_id = $1',
                [id]
            );

            // Assign new roles
            for (const roleId of roleIds) {
                await dbQuery(`
          INSERT INTO user_roles (id, user_id, role_id, assigned_by)
          VALUES (gen_random_uuid(), $1, $2, $3)
        `, [id, roleId, req.user.id]);
            }
        }

        // Get updated user with roles
        const updatedUserResult = await dbQuery(`
      SELECT 
        u.id, u.email, u.first_name, u.last_name, u.phone, u.status, 
        u.last_login, u.created_at, u.updated_at,
        json_agg(
          json_build_object(
            'id', r.id,
            'name', r.name,
            'description', r.description
          )
        ) as roles
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1 AND u.tenant_id = $2
      GROUP BY u.id
    `, [id, req.user.tenantId]);

        res.json({
            success: true,
            message: 'User updated successfully',
            data: {
                user: updatedUserResult.rows[0]
            }
        });

        logger.info('User updated successfully', {
            userId: id,
            updatedBy: req.user.id
        });

    } catch (error) {
        logger.error('Update user error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while updating the user'
        });
    }
});

// @route   DELETE /api/users/:id
// @desc    Delete user
// @access  Private (requires users:delete permission)
router.delete('/:id', requirePermission('users:delete'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if user exists and belongs to tenant
        const existingUser = await dbQuery(
            'SELECT id, email FROM users WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingUser.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'The requested user does not exist'
            });
        }

        // Prevent self-deletion
        if (id === req.user.id) {
            return res.status(400).json({
                success: false,
                error: 'Cannot delete self',
                message: 'You cannot delete your own account'
            });
        }

        // Delete user (cascade will handle user_roles)
        await dbQuery(
            'DELETE FROM users WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

        logger.info('User deleted successfully', {
            userId: id,
            userEmail: existingUser.rows[0].email,
            deletedBy: req.user.id
        });

    } catch (error) {
        logger.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while deleting the user'
        });
    }
});

// @route   POST /api/users/:id/reset-password
// @desc    Reset user password
// @access  Private (requires users:update permission)
router.post('/:id/reset-password', [
    requirePermission('users:update'),
    body('newPassword', 'New password must be at least 6 characters').isLength({ min: 6 })
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
        const { newPassword } = req.body;

        // Check if user exists and belongs to tenant
        const existingUser = await dbQuery(
            'SELECT id FROM users WHERE id = $1 AND tenant_id = $2',
            [id, req.user.tenantId]
        );

        if (existingUser.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'The requested user does not exist'
            });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(12);
        const passwordHash = await bcrypt.hash(newPassword, salt);

        // Update password
        await dbQuery(
            'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [passwordHash, id]
        );

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

        logger.info('User password reset successfully', {
            userId: id,
            resetBy: req.user.id
        });

    } catch (error) {
        logger.error('Reset password error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while resetting the password'
        });
    }
});

module.exports = router; 