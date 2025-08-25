const jwt = require('jsonwebtoken');
const { supabase } = require('../database/connection');
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

        // Get user with tenant information
        const { data: userResult, error: userError } = await supabase
            .from('users')
            .select(`
                id, tenant_id, email, first_name, last_name, phone, status,
                last_login, created_at, updated_at,
                tenants!inner(name, domain)
            `)
            .eq('id', decoded.userId)
            .eq('status', 'active')
            .single();

        if (userError || !userResult) {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'User not found or inactive'
            });
        }

        const user = userResult;

        // Get user roles separately
        const { data: rolesResult, error: rolesError } = await supabase
            .from('user_roles')
            .select(`
                roles!inner(id, name, description, permissions, is_system_role)
            `)
            .eq('user_id', user.id);

        if (rolesError) {
            logger.error('Error fetching user roles:', rolesError);
            return res.status(500).json({
                error: 'Server error',
                message: 'Failed to fetch user roles'
            });
        }

        const roles = rolesResult.map(ur => ur.roles);

        // Flatten permissions from all roles
        const allPermissions = new Set();
        roles.forEach(role => {
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
                name: user.tenants.name,
                domain: user.tenants.domain
            },
            roles: roles,
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