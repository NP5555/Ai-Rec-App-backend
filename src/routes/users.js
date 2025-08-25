const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult, query } = require('express-validator');
const { supabase } = require('../database/connection');
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

        let query = supabase
            .from('users')
            .select(`
                id, email, first_name, last_name, phone, status, 
                last_login, created_at, updated_at,
                user_roles!inner(
                    roles!inner(id, name, description)
                )
            `)
            .eq('tenant_id', req.user.tenantId);

        // Apply filters
        if (search) {
            query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
        }

        if (status) {
            query = query.eq('status', status);
        }

        if (role) {
            query = query.eq('user_roles.roles.name', role);
        }

        // Get total count first
        const { count: total, error: countError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', req.user.tenantId);

        if (countError) {
            logger.error('Error getting user count:', countError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to get user count'
            });
        }

        // Apply pagination
        query = query.range(offset, offset + limit - 1);
        query = query.order('created_at', { ascending: false });

        const { data: users, error: usersError } = await query;

        if (usersError) {
            logger.error('Error fetching users:', usersError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch users'
            });
        }

        // Transform the data to match expected format
        const transformedUsers = users.map(user => ({
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            phone: user.phone,
            status: user.status,
            lastLogin: user.last_login,
            createdAt: user.created_at,
            updatedAt: user.updated_at,
            roles: user.user_roles.map(ur => ur.roles)
        }));

        const totalPages = Math.ceil(total / limit);

        res.json({
            success: true,
            data: {
                users: transformedUsers,
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

        const { data: user, error: userError } = await supabase
            .from('users')
            .select(`
                id, email, first_name, last_name, phone, status, 
                last_login, created_at, updated_at,
                user_roles!inner(
                    roles!inner(id, name, description, permissions, is_system_role)
                )
            `)
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (userError) {
            logger.error('Error fetching user by ID:', userError);
            if (userError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'The requested user does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch user by ID'
            });
        }

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'The requested user does not exist'
            });
        }

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    phone: user.phone,
                    status: user.status,
                    lastLogin: user.last_login,
                    createdAt: user.created_at,
                    updatedAt: user.updated_at,
                    roles: user.user_roles.map(ur => ur.roles)
                }
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
        const { data: existingUser, error: existingUserError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingUserError) {
            logger.error('Error checking for existing user:', existingUserError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing user'
            });
        }

        if (existingUser) {
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
        const { data: newUser, error: newUserError } = await supabase
            .from('users')
            .insert({
                id: supabase.helpers.createId(),
                tenant_id: req.user.tenantId,
                email: email,
                password_hash: passwordHash,
                first_name: firstName,
                last_name: lastName,
                phone: phone || null,
                status: status
            })
            .select()
            .single();

        if (newUserError) {
            logger.error('Error creating user:', newUserError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to create user'
            });
        }

        // Assign roles
        for (const roleId of roleIds) {
            await supabase
                .from('user_roles')
                .insert({
                    id: supabase.helpers.createId(),
                    user_id: newUser.id,
                    role_id: roleId,
                    assigned_by: req.user.id
                });
        }

        // Get assigned roles
        const { data: rolesResult, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
                roles!inner(id, name, description, permissions, is_system_role)
            `)
            .eq('user_id', newUser.id);

        if (rolesError) {
            logger.error('Error fetching assigned roles:', rolesError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch assigned roles'
            });
        }

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
                    roles: rolesResult.map(ur => ur.roles)
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
        const { data: existingUser, error: existingUserError } = await supabase
            .from('users')
            .select('id, tenant_id')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingUserError) {
            logger.error('Error checking for existing user:', existingUserError);
            if (existingUserError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'The requested user does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing user'
            });
        }

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                message: 'The requested user does not exist'
            });
        }

        // Check if email is being changed and if it's already taken
        if (email) {
            const { data: emailCheck, error: emailCheckError } = await supabase
                .from('users')
                .select('id')
                .eq('email', email)
                .eq('tenant_id', req.user.tenantId)
                .neq('id', id)
                .single();

            if (emailCheckError) {
                logger.error('Error checking for existing email:', emailCheckError);
                return res.status(500).json({
                    success: false,
                    error: 'Server error',
                    message: 'Failed to check for existing email'
                });
            }

            if (emailCheck) {
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

            await supabase
                .from('users')
                .update({
                    [updateFields.join(', ')]: updateParams
                })
                .eq('id', id)
                .eq('tenant_id', req.user.tenantId);
        }

        // Update roles if provided
        if (roleIds && Array.isArray(roleIds)) {
            // Remove existing roles
            await supabase
                .from('user_roles')
                .delete()
                .eq('user_id', id);

            // Assign new roles
            for (const roleId of roleIds) {
                await supabase
                    .from('user_roles')
                    .insert({
                        id: supabase.helpers.createId(),
                        user_id: id,
                        role_id: roleId,
                        assigned_by: req.user.id
                    });
            }
        }

        // Get updated user with roles
        const { data: updatedUserResult, error: updatedUserError } = await supabase
            .from('users')
            .select(`
                id, email, first_name, last_name, phone, status, 
                last_login, created_at, updated_at,
                user_roles!inner(
                    roles!inner(id, name, description)
                )
            `)
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (updatedUserError) {
            logger.error('Error fetching updated user:', updatedUserError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch updated user'
            });
        }

        res.json({
            success: true,
            message: 'User updated successfully',
            data: {
                user: {
                    id: updatedUserResult.id,
                    email: updatedUserResult.email,
                    firstName: updatedUserResult.first_name,
                    lastName: updatedUserResult.last_name,
                    phone: updatedUserResult.phone,
                    status: updatedUserResult.status,
                    lastLogin: updatedUserResult.last_login,
                    createdAt: updatedUserResult.created_at,
                    updatedAt: updatedUserResult.updated_at,
                    roles: updatedUserResult.user_roles.map(ur => ur.roles)
                }
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
        const { data: existingUser, error: existingUserError } = await supabase
            .from('users')
            .select('id, email')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingUserError) {
            logger.error('Error checking for existing user:', existingUserError);
            if (existingUserError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'The requested user does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing user'
            });
        }

        if (!existingUser) {
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
        await supabase
            .from('users')
            .delete()
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

        logger.info('User deleted successfully', {
            userId: id,
            userEmail: existingUser.email,
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
        const { data: existingUser, error: existingUserError } = await supabase
            .from('users')
            .select('id')
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId)
            .single();

        if (existingUserError) {
            logger.error('Error checking for existing user:', existingUserError);
            if (existingUserError.code === 'PGRST116') { // Not found
                return res.status(404).json({
                    success: false,
                    error: 'User not found',
                    message: 'The requested user does not exist'
                });
            }
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to check for existing user'
            });
        }

        if (!existingUser) {
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
        await supabase
            .from('users')
            .update({ password_hash: passwordHash })
            .eq('id', id)
            .eq('tenant_id', req.user.tenantId);

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