const jwt = require('jsonwebtoken');
const { query } = require('../database/connection');
const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({
                error: 'Access token required',
                message: 'Please provide a valid authentication token'
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

        // Get user with roles and permissions
        const userResult = await query(`
      SELECT 
        u.id, u.tenant_id, u.email, u.first_name, u.last_name, u.phone, u.status,
        u.last_login, u.created_at, u.updated_at,
        t.name as tenant_name, t.domain as tenant_domain,
        json_agg(
          json_build_object(
            'id', r.id,
            'name', r.name,
            'description', r.description,
            'permissions', r.permissions,
            'is_system_role', r.is_system_role
          )
        ) as roles
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      WHERE u.id = $1 AND u.status = 'active'
      GROUP BY u.id, t.name, t.domain
    `, [decoded.userId]);

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'User not found or inactive'
            });
        }

        const user = userResult.rows[0];

        // Flatten permissions from all roles
        const allPermissions = new Set();
        user.roles.forEach(role => {
            if (role.permissions) {
                role.permissions.forEach(permission => allPermissions.add(permission));
            }
        });

        // Add user context to request
        req.user = {
            id: user.id,
            tenantId: user.tenant_id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            phone: user.phone,
            status: user.status,
            tenant: {
                name: user.tenant_name,
                domain: user.tenant_domain
            },
            roles: user.roles,
            permissions: Array.from(allPermissions)
        };

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'The provided token is invalid'
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'The provided token has expired'
            });
        }

        logger.error('Authentication error:', error);
        return res.status(500).json({
            error: 'Authentication failed',
            message: 'An error occurred during authentication'
        });
    }
};

const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please authenticate to access this resource'
            });
        }

        if (!req.user.permissions.includes(permission)) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `Permission '${permission}' is required to access this resource`
            });
        }

        next();
    };
};

const requireAnyPermission = (permissions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please authenticate to access this resource'
            });
        }

        const hasPermission = permissions.some(permission =>
            req.user.permissions.includes(permission)
        );

        if (!hasPermission) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `One of the following permissions is required: ${permissions.join(', ')}`
            });
        }

        next();
    };
};

const requireAllPermissions = (permissions) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Authentication required',
                message: 'Please authenticate to access this resource'
            });
        }

        const hasAllPermissions = permissions.every(permission =>
            req.user.permissions.includes(permission)
        );

        if (!hasAllPermissions) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                message: `All of the following permissions are required: ${permissions.join(', ')}`
            });
        }

        next();
    };
};

const requireSuperAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            message: 'Please authenticate to access this resource'
        });
    }

    const isSuperAdmin = req.user.permissions.includes('system:admin');

    if (!isSuperAdmin) {
        return res.status(403).json({
            error: 'Super admin required',
            message: 'Super administrator access is required for this operation'
        });
    }

    next();
};

module.exports = {
    authenticateToken,
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    requireSuperAdmin
}; 