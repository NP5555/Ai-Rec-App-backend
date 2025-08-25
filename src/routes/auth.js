const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../database/connection');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', [
    body('email', 'Please include a valid email').isEmail(),
    body('password', 'Password is required').exists()
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

        const { email, password } = req.body;

        // Check if user exists
        const { data: userResult, error: userError } = await supabase
            .from('users')
            .select(`
                id, tenant_id, email, password_hash, first_name, last_name, 
                phone, status, last_login,
                tenants!inner(name, domain)
            `)
            .eq('email', email)
            .single();

        if (userError || !userResult) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        const user = userResult;

        // Check if user is active
        if (user.status !== 'active') {
            return res.status(401).json({
                success: false,
                error: 'Account inactive',
                message: 'Your account has been deactivated. Please contact your administrator.'
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        // Get user roles and permissions
        const { data: rolesResult, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
                roles!inner(id, name, description, permissions, is_system_role)
            `)
            .eq('user_id', user.id);

        if (rolesError) {
            logger.error('Error fetching user roles:', rolesError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to fetch user roles'
            });
        }

        const roles = rolesResult.map(ur => ur.roles);
        const allPermissions = new Set();
        roles.forEach(role => {
            if (role.permissions) {
                role.permissions.forEach(permission => allPermissions.add(permission));
            }
        });

        // Update last login
        const { error: updateError } = await supabase
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', user.id);

        if (updateError) {
            logger.warn('Failed to update last login:', updateError);
        }

        // Create JWT token
        const payload = {
            userId: user.id,
            tenantId: user.tenant_id,
            email: user.email
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        // Remove password from response
        delete user.password_hash;

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    phone: user.phone,
                    status: user.status,
                    tenant: {
                        name: user.tenants.name,
                        domain: user.tenants.domain
                    },
                    roles: roles,
                    permissions: Array.from(allPermissions)
                }
            }
        });

        logger.info('User logged in successfully', { userId: user.id, email: user.email });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred during login'
        });
    }
});

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Private (requires admin permission)
router.post('/register', [
    authenticateToken,
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

        const { email, password, firstName, lastName, phone, roleIds } = req.body;

        // Check if user already exists in the same tenant
        const { data: existingUser, error: existingError } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .eq('tenant_id', req.user.tenantId)
            .single();

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
        const { data: newUser, error: userError } = await supabase
            .from('users')
            .insert({
                tenant_id: req.user.tenantId,
                email: email,
                password_hash: passwordHash,
                first_name: firstName,
                last_name: lastName,
                phone: phone || null,
                status: 'active'
            })
            .select('id, email, first_name, last_name, phone, status, created_at')
            .single();

        if (userError) {
            logger.error('Error creating user:', userError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to create user'
            });
        }

        // Assign roles
        const userRoleInserts = roleIds.map(roleId => ({
            user_id: newUser.id,
            role_id: roleId,
            assigned_by: req.user.id
        }));

        const { error: rolesError } = await supabase
            .from('user_roles')
            .insert(userRoleInserts);

        if (rolesError) {
            logger.error('Error assigning roles:', rolesError);
            // Rollback user creation if role assignment fails
            await supabase
                .from('users')
                .delete()
                .eq('id', newUser.id);
            
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to assign roles to user'
            });
        }

        // Get assigned roles
        const { data: rolesResult, error: rolesFetchError } = await supabase
            .from('user_roles')
            .select(`
                roles!inner(id, name, description, permissions, is_system_role)
            `)
            .eq('user_id', newUser.id);

        if (rolesFetchError) {
            logger.error('Error fetching assigned roles:', rolesFetchError);
        }

        const roles = rolesResult ? rolesResult.map(ur => ur.roles) : [];

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    firstName: newUser.first_name,
                    lastName: newUser.last_name,
                    phone: newUser.phone,
                    status: newUser.status,
                    roles: roles
                }
            }
        });

        logger.info('User registered successfully', {
            userId: newUser.id,
            email: newUser.email,
            createdBy: req.user.id
        });

    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred during registration'
        });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user profile
// @access  Private
router.get('/me', authenticateToken, async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: req.user
            }
        });
    } catch (error) {
        logger.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while fetching profile'
        });
    }
});

// @route   POST /api/auth/refresh
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh', authenticateToken, async (req, res) => {
    try {
        // Create new JWT token
        const payload = {
            userId: req.user.id,
            tenantId: req.user.tenantId,
            email: req.user.email
        };

        const token = jwt.sign(
            payload,
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
        );

        res.json({
            success: true,
            message: 'Token refreshed successfully',
            data: {
                token
            }
        });

    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while refreshing token'
        });
    }
});

// @route   POST /api/auth/logout
// @desc    Logout user (client-side token removal)
// @access  Private
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        // In a more advanced implementation, you might want to blacklist the token
        // For now, we'll just return success and let the client remove the token

        logger.info('User logged out', { userId: req.user.id, email: req.user.email });

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred during logout'
        });
    }
});

module.exports = router; 