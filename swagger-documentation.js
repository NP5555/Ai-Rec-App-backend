/**
 * Comprehensive Swagger/OpenAPI Documentation for AI Receptionist Backend
 * This file contains all the API endpoint documentation for frontend developers
 */

const swaggerDefinition = {
    openapi: '3.0.3',
    info: {
        title: 'AI Receptionist Backend API',
        version: '1.0.0',
        description: `
# AI Receptionist Backend API Documentation

This API provides comprehensive functionality for managing an AI-powered receptionist system with the following features:

## Core Features
- **User Management**: Multi-tenant user system with role-based access control
- **IVR System**: Interactive Voice Response with AI integration
- **SignalWire Integration**: Voice and SMS communication capabilities
- **Extension Management**: Phone extension routing and management
- **Tenant Management**: Multi-tenant architecture support

## Authentication
All protected endpoints require a valid JWT token in the Authorization header:
\`Authorization: Bearer <your-jwt-token>\`

## Rate Limiting
API requests are limited to 100 requests per 15 minutes per IP address.

## Base URL
- Development: \`http://localhost:3000\`
- Production: \`/\` (relative to your domain)

## Response Format
All API responses follow a consistent format:
\`\`\`json
{
  "success": true/false,
  "message": "Response message",
  "data": { ... },
  "error": "Error details (if any)"
}
\`\`\`
        `,
        contact: {
            name: 'AI Receptionist Team',
            email: 'support@aireceptionist.com'
        },
        license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT'
        }
    },
    servers: [
        { 
            url: 'http://localhost:3000',
            description: 'Development server'
        },
        { 
            url: '/',
            description: 'Production server'
        }
    ],
    tags: [
        {
            name: 'System',
            description: 'System health and status endpoints'
        },
        {
            name: 'Database',
            description: 'Database connection and testing endpoints'
        },
        {
            name: 'Authentication',
            description: 'User authentication and authorization'
        },
        {
            name: 'Users',
            description: 'User management operations'
        },
        {
            name: 'Roles',
            description: 'Role-based access control management'
        },
        {
            name: 'Tenants',
            description: 'Multi-tenant management (Super Admin only)'
        },
        {
            name: 'IVR',
            description: 'Interactive Voice Response system management'
        },
        {
            name: 'Extensions',
            description: 'Phone extension management'
        },
        {
            name: 'SignalWire',
            description: 'SignalWire communication integration'
        }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            }
        },
        schemas: {
            // Common Response Schemas
            Error: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Error message' },
                    error: { type: 'string', example: 'Detailed error information' },
                    details: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                field: { type: 'string' },
                                message: { type: 'string' }
                            }
                        }
                    }
                }
            },
            Success: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Operation successful' },
                    data: { type: 'object', description: 'Response data' }
                }
            },
            Pagination: {
                type: 'object',
                properties: {
                    page: { type: 'integer', example: 1 },
                    limit: { type: 'integer', example: 10 },
                    total: { type: 'integer', example: 100 },
                    totalPages: { type: 'integer', example: 10 }
                }
            },
            
            // User Schemas
            User: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'user-123' },
                    email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
                    firstName: { type: 'string', example: 'John' },
                    lastName: { type: 'string', example: 'Doe' },
                    phone: { type: 'string', example: '+12345678900' },
                    status: { type: 'string', enum: ['active', 'inactive', 'suspended'], example: 'active' },
                    tenantId: { type: 'string', format: 'uuid', example: 'tenant-123' },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' }
                }
            },
            UserCreate: {
                type: 'object',
                required: ['email', 'password', 'firstName', 'lastName', 'tenantId'],
                properties: {
                    email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
                    password: { type: 'string', minLength: 8, example: 'securePassword123' },
                    firstName: { type: 'string', example: 'John' },
                    lastName: { type: 'string', example: 'Doe' },
                    phone: { type: 'string', example: '+12345678900' },
                    tenantId: { type: 'string', example: 'tenant-123' },
                    appRoleId: { type: 'string', example: 'role-456' }
                }
            },
            UserUpdate: {
                type: 'object',
                properties: {
                    firstName: { type: 'string', example: 'John' },
                    lastName: { type: 'string', example: 'Doe' },
                    phone: { type: 'string', example: '+12345678900' },
                    status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
                    appRoleId: { type: 'string', example: 'role-456' }
                }
            },
            
            // Role Schemas
            Role: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'role-123' },
                    name: { type: 'string', example: 'Admin' },
                    description: { type: 'string', example: 'Administrator role with full access' },
                    permissions: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['users:read', 'users:write', 'roles:read']
                    },
                    tenantId: { type: 'string', format: 'uuid', example: 'tenant-123' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            RoleCreate: {
                type: 'object',
                required: ['name', 'permissions'],
                properties: {
                    name: { type: 'string', example: 'Manager' },
                    description: { type: 'string', example: 'Manager role with limited access' },
                    permissions: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['users:read', 'extensions:read']
                    }
                }
            },
            
            // Tenant Schemas
            Tenant: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'tenant-123' },
                    name: { type: 'string', example: 'Acme Corporation' },
                    domain: { type: 'string', example: 'acme.com' },
                    status: { type: 'string', enum: ['active', 'inactive'], example: 'active' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            TenantCreate: {
                type: 'object',
                required: ['name', 'domain'],
                properties: {
                    name: { type: 'string', example: 'Acme Corporation' },
                    domain: { type: 'string', example: 'acme.com' },
                    status: { type: 'string', enum: ['active', 'inactive'], default: 'active' }
                }
            },
            
            // Extension Schemas
            Extension: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'ext-123' },
                    extensionNumber: { type: 'string', example: '1001' },
                    name: { type: 'string', example: 'Sales Department' },
                    description: { type: 'string', example: 'Main sales extension' },
                    type: { type: 'string', enum: ['user', 'department', 'ivr'], example: 'department' },
                    userId: { type: 'string', format: 'uuid', example: 'user-123' },
                    tenantId: { type: 'string', format: 'uuid', example: 'tenant-123' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            ExtensionCreate: {
                type: 'object',
                required: ['extensionNumber', 'name'],
                properties: {
                    extensionNumber: { type: 'string', example: '1001' },
                    name: { type: 'string', example: 'Sales Department' },
                    description: { type: 'string', example: 'Main sales extension' },
                    type: { type: 'string', enum: ['user', 'department', 'ivr'], default: 'department' },
                    userId: { type: 'string', example: 'user-123' }
                }
            },
            
            // IVR Schemas
            IVREntry: {
                type: 'object',
                required: ['tenantId', 'did', 'from', 'to'],
                properties: {
                    tenantId: { type: 'string', example: 'tenant-123' },
                    did: { type: 'string', example: '+12345678900' },
                    from: { type: 'string', example: '+19876543210' },
                    to: { type: 'string', example: '+12345678900' },
                    ts: { type: 'string', format: 'date-time' }
                }
            },
            IVRResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    callId: { type: 'string', example: 'tenant-123_1234567890_abc123' },
                    action: { type: 'string', enum: ['gather', 'transfer', 'voicemail', 'ai'], example: 'gather' },
                    params: { type: 'object' }
                }
            },
            
            // SignalWire Schemas
            OutboundCall: {
                type: 'object',
                required: ['from', 'to', 'tenantId'],
                properties: {
                    from: { type: 'string', example: '+12345678900' },
                    to: { type: 'string', example: '+19876543210' },
                    tenantId: { type: 'string', example: 'tenant-123' },
                    options: { type: 'object' }
                }
            },
            SMSMessage: {
                type: 'object',
                required: ['from', 'to', 'body', 'tenantId'],
                properties: {
                    from: { type: 'string', example: '+12345678900' },
                    to: { type: 'string', example: '+19876543210' },
                    body: { type: 'string', example: 'Hello from AI Receptionist!' },
                    tenantId: { type: 'string', example: 'tenant-123' }
                }
            },
            PhoneNumber: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'phone-123' },
                    phoneNumber: { type: 'string', example: '+12345678900' },
                    friendlyName: { type: 'string', example: 'Main Office' },
                    signalwireSid: { type: 'string', example: 'PN1234567890abcdef' },
                    status: { type: 'string', enum: ['active', 'inactive', 'pending'], example: 'active' },
                    tenantId: { type: 'string', format: 'uuid', example: 'tenant-123' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            },
            PhoneNumberCreate: {
                type: 'object',
                required: ['phoneNumber', 'tenantId'],
                properties: {
                    phoneNumber: { type: 'string', example: '+12345678900' },
                    friendlyName: { type: 'string', example: 'Main Office' },
                    tenantId: { type: 'string', example: 'tenant-123' }
                }
            },
            
            // Authentication Schemas
            LoginRequest: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                    email: { type: 'string', format: 'email', example: 'john.doe@example.com' },
                    password: { type: 'string', example: 'password123' }
                }
            },
            LoginResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Login successful' },
                    data: {
                        type: 'object',
                        properties: {
                            token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                            user: { $ref: '#/components/schemas/User' },
                            permissions: {
                                type: 'array',
                                items: { type: 'string' },
                                example: ['users:read', 'users:write']
                            }
                        }
                    }
                }
            },
            
            // Call Session Schemas
            CallSession: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid', example: 'session-123' },
                    callSid: { type: 'string', example: 'CA1234567890abcdef' },
                    fromNumber: { type: 'string', example: '+12345678900' },
                    toNumber: { type: 'string', example: '+19876543210' },
                    status: { type: 'string', enum: ['initiated', 'ringing', 'answered', 'completed', 'failed'], example: 'active' },
                    duration: { type: 'integer', example: 120 },
                    tenantId: { type: 'string', format: 'uuid', example: 'tenant-123' },
                    createdAt: { type: 'string', format: 'date-time' }
                }
            }
        }
    },
    security: [{ bearerAuth: [] }]
};

module.exports = swaggerDefinition;
