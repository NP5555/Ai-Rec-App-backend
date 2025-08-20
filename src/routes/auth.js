const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../database/connection');
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
        const userResult = await query(`
      SELECT 
        u.id, u.tenant_id, u.email, u.password_hash, u.first_name, u.last_name, 
        u.phone, u.status, u.last_login,
        t.name as tenant_name, t.domain as tenant_domain
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      WHERE u.email = $1
    `, [email]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        const user = userResult.rows[0];

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
        const rolesResult = await query(`
      SELECT 
        r.id, r.name, r.description, r.permissions, r.is_system_role
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `, [user.id]);

        const roles = rolesResult.rows;
        const allPermissions = new Set();
        roles.forEach(role => {
            if (role.permissions) {
                role.permissions.forEach(permission => allPermissions.add(permission));
            }
        });

        // Update last login
        await query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );

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
                        name: user.tenant_name,
                        domain: user.tenant_domain
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
        const existingUser = await query(
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
        const userResult = await query(`
      INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, phone, status)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active')
      RETURNING id, email, first_name, last_name, phone, status, created_at
    `, [req.user.tenantId, email, passwordHash, firstName, lastName, phone || null]);

        const newUser = userResult.rows[0];

        // Assign roles
        for (const roleId of roleIds) {
            await query(`
        INSERT INTO user_roles (id, user_id, role_id, assigned_by)
        VALUES (gen_random_uuid(), $1, $2, $3)
      `, [newUser.id, roleId, req.user.id]);
        }

        // Get assigned roles
        const rolesResult = await query(`
      SELECT r.id, r.name, r.description, r.permissions, r.is_system_role
      FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = $1
    `, [newUser.id]);

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
                    roles: rolesResult.rows
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