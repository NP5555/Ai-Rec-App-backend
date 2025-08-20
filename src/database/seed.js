const { query } = require('./connection');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const seedData = async () => {
    try {
        logger.info('Starting database seeding...');

        // Create default tenant
        const tenantResult = await query(
            'INSERT INTO tenants (id, name, domain, status) VALUES ($1, $2, $3, $4) ON CONFLICT (domain) DO NOTHING RETURNING id',
            [uuidv4(), 'Default Organization', 'default.local', 'active']
        );

        let tenantId;
        if (tenantResult.rows.length > 0) {
            tenantId = tenantResult.rows[0].id;
        } else {
            const existingTenant = await query('SELECT id FROM tenants WHERE domain = $1', ['default.local']);
            tenantId = existingTenant.rows[0].id;
        }

        // Create system roles
        const roles = [
            {
                name: 'super_admin',
                description: 'Super Administrator with full system access',
                permissions: [
                    'users:create', 'users:read', 'users:update', 'users:delete',
                    'roles:create', 'roles:read', 'roles:update', 'roles:delete',
                    'tenants:create', 'tenants:read', 'tenants:update', 'tenants:delete',
                    'extensions:create', 'extensions:read', 'extensions:update', 'extensions:delete',
                    'departments:create', 'departments:read', 'departments:update', 'departments:delete',
                    'ivr:create', 'ivr:read', 'ivr:update', 'ivr:delete',
                    'system:admin'
                ],
                is_system_role: true
            },
            {
                name: 'admin',
                description: 'Tenant Administrator with tenant-level access',
                permissions: [
                    'users:create', 'users:read', 'users:update', 'users:delete',
                    'roles:create', 'roles:read', 'roles:update', 'roles:delete',
                    'extensions:create', 'extensions:read', 'extensions:update', 'extensions:delete',
                    'departments:create', 'departments:read', 'departments:update', 'departments:delete',
                    'ivr:create', 'ivr:read', 'ivr:update', 'ivr:delete'
                ],
                is_system_role: true
            },
            {
                name: 'manager',
                description: 'Department Manager with department-level access',
                permissions: [
                    'users:read', 'users:update',
                    'extensions:read', 'extensions:update',
                    'departments:read', 'departments:update',
                    'ivr:read'
                ],
                is_system_role: true
            },
            {
                name: 'user',
                description: 'Regular user with basic access',
                permissions: [
                    'users:read',
                    'extensions:read',
                    'departments:read'
                ],
                is_system_role: true
            }
        ];

        const createdRoles = {};

        for (const role of roles) {
            const roleResult = await query(
                'INSERT INTO roles (id, tenant_id, name, description, permissions, is_system_role) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, name) DO UPDATE SET permissions = $5 RETURNING id',
                [uuidv4(), tenantId, role.name, role.description, JSON.stringify(role.permissions), role.is_system_role]
            );
            createdRoles[role.name] = roleResult.rows[0].id;
        }

        // Create super admin user
        const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
        const passwordHash = await bcrypt.hash(superAdminPassword, 12);

        const superAdminResult = await query(
            'INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id',
            [uuidv4(), tenantId, 'admin@default.local', passwordHash, 'Super', 'Admin', 'active']
        );

        if (superAdminResult.rows.length > 0) {
            const superAdminId = superAdminResult.rows[0].id;

            // Assign super_admin role to super admin user
            await query(
                'INSERT INTO user_roles (id, user_id, role_id, assigned_by) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, role_id) DO NOTHING',
                [uuidv4(), superAdminId, createdRoles.super_admin, superAdminId]
            );

            logger.info('Super admin user created successfully');
            logger.info(`Email: admin@default.local`);
            logger.info(`Password: ${superAdminPassword}`);
        }

        // Create sample departments
        const departments = [
            {
                name: 'Sales',
                description: 'Sales department',
                extension_prefix: '1',
                members: [],
                settings: {
                    greeting: 'Thank you for calling Sales. How can we help you today?',
                    business_hours: {
                        monday: { start: '09:00', end: '17:00' },
                        tuesday: { start: '09:00', end: '17:00' },
                        wednesday: { start: '09:00', end: '17:00' },
                        thursday: { start: '09:00', end: '17:00' },
                        friday: { start: '09:00', end: '17:00' }
                    }
                }
            },
            {
                name: 'Support',
                description: 'Customer support department',
                extension_prefix: '2',
                members: [],
                settings: {
                    greeting: 'Welcome to Customer Support. We\'re here to help!',
                    business_hours: {
                        monday: { start: '08:00', end: '18:00' },
                        tuesday: { start: '08:00', end: '18:00' },
                        wednesday: { start: '08:00', end: '18:00' },
                        thursday: { start: '08:00', end: '18:00' },
                        friday: { start: '08:00', end: '18:00' },
                        saturday: { start: '09:00', end: '15:00' }
                    }
                }
            },
            {
                name: 'Billing',
                description: 'Billing and payments department',
                extension_prefix: '3',
                members: [],
                settings: {
                    greeting: 'Thank you for calling Billing. How can we assist you?',
                    business_hours: {
                        monday: { start: '09:00', end: '17:00' },
                        tuesday: { start: '09:00', end: '17:00' },
                        wednesday: { start: '09:00', end: '17:00' },
                        thursday: { start: '09:00', end: '17:00' },
                        friday: { start: '09:00', end: '17:00' }
                    }
                }
            }
        ];

        const createdDepartments = {};

        for (const dept of departments) {
            const deptResult = await query(
                'INSERT INTO departments (id, tenant_id, name, description, extension_prefix, members, settings) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, name) DO UPDATE SET settings = $7 RETURNING id',
                [uuidv4(), tenantId, dept.name, dept.description, dept.extension_prefix, JSON.stringify(dept.members), JSON.stringify(dept.settings)]
            );
            createdDepartments[dept.name] = deptResult.rows[0].id;
        }

        // Create sample extensions
        const extensions = [
            {
                extension_number: '100',
                name: 'Reception',
                description: 'Main reception desk',
                department_id: null,
                dial_plan: {
                    type: 'simultaneous',
                    destinations: [
                        { type: 'sip', address: 'sip:reception@pbx.local' },
                        { type: 'pstn', number: '+1234567890' }
                    ],
                    timeout: 30,
                    fallback: 'voicemail'
                }
            },
            {
                extension_number: '101',
                name: 'Sales Manager',
                description: 'Sales department manager',
                department_id: createdDepartments.Sales,
                dial_plan: {
                    type: 'sequential',
                    destinations: [
                        { type: 'sip', address: 'sip:sales-manager@pbx.local' },
                        { type: 'pstn', number: '+1234567891' }
                    ],
                    timeout: 20,
                    fallback: 'voicemail'
                }
            },
            {
                extension_number: '201',
                name: 'Support Lead',
                description: 'Support team lead',
                department_id: createdDepartments.Support,
                dial_plan: {
                    type: 'simultaneous',
                    destinations: [
                        { type: 'sip', address: 'sip:support-lead@pbx.local' },
                        { type: 'pstn', number: '+1234567892' }
                    ],
                    timeout: 25,
                    fallback: 'voicemail'
                }
            },
            {
                extension_number: '301',
                name: 'Billing Specialist',
                description: 'Billing department specialist',
                department_id: createdDepartments.Billing,
                dial_plan: {
                    type: 'sequential',
                    destinations: [
                        { type: 'sip', address: 'sip:billing@pbx.local' },
                        { type: 'pstn', number: '+1234567893' }
                    ],
                    timeout: 20,
                    fallback: 'voicemail'
                }
            }
        ];

        for (const ext of extensions) {
            await query(
                'INSERT INTO extensions (id, tenant_id, extension_number, name, description, department_id, dial_plan) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (tenant_id, extension_number) DO NOTHING',
                [uuidv4(), tenantId, ext.extension_number, ext.name, ext.description, ext.department_id, JSON.stringify(ext.dial_plan)]
            );
        }

        // Create default IVR flow
        const defaultIVRFlow = {
            name: 'Default IVR',
            description: 'Default IVR flow for incoming calls',
            flow_config: {
                greeting: 'Welcome to our company. Please press 1 for Sales, 2 for Support, 3 for Billing, or dial an extension.',
                timeout: 10,
                max_digits: 4,
                retries: 3,
                options: {
                    '1': { action: 'dept', params: { department: 'Sales' } },
                    '2': { action: 'dept', params: { department: 'Support' } },
                    '3': { action: 'dept', params: { department: 'Billing' } },
                    'default': { action: 'ai', params: { prompt: 'I can help you connect to the right department. What can I assist you with?' } }
                },
                fallback: { action: 'voicemail', params: { message: 'Please leave a message and we\'ll get back to you.' } }
            }
        };

        await query(
            'INSERT INTO ivr_flows (id, tenant_id, name, description, flow_config, is_active, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING',
            [uuidv4(), tenantId, defaultIVRFlow.name, defaultIVRFlow.description, JSON.stringify(defaultIVRFlow.flow_config), true, superAdminResult.rows[0]?.id || null]
        );

        logger.info('Database seeding completed successfully!');
        logger.info('Default tenant, roles, departments, extensions, and IVR flow created.');

    } catch (error) {
        logger.error('Seeding failed:', error);
        throw error;
    }
};

// Run seeding if this file is executed directly
if (require.main === module) {
    seedData()
        .then(() => {
            logger.info('Database seeding completed');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('Database seeding failed:', error);
            process.exit(1);
        });
}

module.exports = { seedData }; 