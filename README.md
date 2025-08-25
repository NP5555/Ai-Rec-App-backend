# AI Receptionist Backend

A comprehensive Node.js/Express.js backend for the AI Receptionist system with user management, role-based access control, and SignalWire IVR integration.

## Features

- **Multi-tenant Architecture**: Support for multiple organizations
- **Role-Based Access Control**: Dynamic roles with granular permissions
- **User Management**: Complete user CRUD operations
- **SignalWire IVR Integration**: Full IVR routing and call handling
- **Extension Management**: Phone extension and dial plan management
- **JWT Authentication**: Secure token-based authentication
- **PostgreSQL Database**: Robust data storage with RLS
- **Comprehensive Logging**: Winston-based structured logging
- **API Validation**: Express-validator for request validation
- **Rate Limiting**: Built-in rate limiting for API protection

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SignalWire    │    │   Express.js    │    │   PostgreSQL    │
│   IVR System    │◄──►│   Backend API   │◄──►│   Database      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   JWT Auth      │
                       │   RBAC System   │
                       └─────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- Supabase account and project
- npm or yarn

> **📖 For detailed Supabase setup instructions, see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)**
>
> **⚠️ If you're having issues with an empty database, see [DATABASE_SETUP.md](./DATABASE_SETUP.md) for troubleshooting**

### Installation

1. **Clone and install dependencies**:
```bash
cd backend
npm install
```

2. **Set up environment variables**:
```bash
cp env.example .env
# Edit .env with your configuration
```

3. **Set up Supabase database**:
```bash
# Get your Supabase connection string from:
# Supabase Dashboard > Settings > Database > Connection string > URI

# For empty databases, it's recommended to use the manual setup method:
# 1. Go to Supabase SQL Editor
# 2. Run the SQL from src/database/migrations.sql

# Or use the automated approach (requires execute_sql function):
npm run migrate

# After tables are created, seed initial data:
npm run seed
```

4. **Start the server**:
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Authentication

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| POST | `/api/auth/login` | User login | Public |
| POST | `/api/auth/register` | Register new user | Private (admin) |
| GET | `/api/auth/me` | Get current user | Private |
| POST | `/api/auth/refresh` | Refresh JWT token | Private |
| POST | `/api/auth/logout` | User logout | Private |

### Users

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| GET | `/api/users` | Get all users | Private (users:read) |
| GET | `/api/users/:id` | Get user by ID | Private (users:read) |
| POST | `/api/users` | Create user | Private (users:create) |
| PUT | `/api/users/:id` | Update user | Private (users:update) |
| DELETE | `/api/users/:id` | Delete user | Private (users:delete) |
| POST | `/api/users/:id/reset-password` | Reset password | Private (users:update) |

### Roles

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| GET | `/api/roles` | Get all roles | Private (roles:read) |
| GET | `/api/roles/:id` | Get role by ID | Private (roles:read) |
| POST | `/api/roles` | Create role | Private (roles:create) |
| PUT | `/api/roles/:id` | Update role | Private (roles:update) |
| DELETE | `/api/roles/:id` | Delete role | Private (roles:delete) |
| GET | `/api/roles/:id/users` | Get role users | Private (roles:read) |
| GET | `/api/roles/permissions/available` | Get available permissions | Private (roles:read) |

### Extensions

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| GET | `/api/extensions` | Get all extensions | Private (extensions:read) |
| GET | `/api/extensions/:id` | Get extension by ID | Private (extensions:read) |
| POST | `/api/extensions` | Create extension | Private (extensions:create) |
| PUT | `/api/extensions/:id` | Update extension | Private (extensions:update) |
| DELETE | `/api/extensions/:id` | Delete extension | Private (extensions:delete) |
| GET | `/api/extensions/search/:number` | Search extension | Private (extensions:read) |

### Tenants (Super Admin Only)

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| GET | `/api/tenants` | Get all tenants | Super Admin |
| GET | `/api/tenants/:id` | Get tenant by ID | Super Admin |
| POST | `/api/tenants` | Create tenant | Super Admin |
| PUT | `/api/tenants/:id` | Update tenant | Super Admin |
| DELETE | `/api/tenants/:id` | Delete tenant | Super Admin |
| GET | `/api/tenants/:id/stats` | Get tenant stats | Super Admin |

### SignalWire IVR

| Method | Endpoint | Description | Access |
|--------|----------|-------------|---------|
| POST | `/api/mcp/ivr/entry` | Handle inbound call | Public |
| POST | `/api/mcp/ivr/event` | Handle IVR events | Public |
| POST | `/api/mcp/ivr/log` | Log call completion | Public |

## SignalWire IVR Integration

### Call Flow

1. **Inbound Call** → SignalWire receives call
2. **Webhook** → POST `/api/mcp/ivr/entry`
3. **IVR Response** → Return action and parameters
4. **Event Processing** → POST `/api/mcp/ivr/event` for each event
5. **Call Completion** → POST `/api/mcp/ivr/log` with CDR data

### Supported Actions

- `gather` - Collect DTMF input
- `extension` - Route to specific extension
- `dept` - Route to department
- `ai` - Handoff to AI assistant
- `voicemail` - Route to voicemail
- `hangup` - End call

### Example IVR Flow

```json
{
  "action": "gather",
  "params": {
    "greeting": "Welcome. Press 1 for Sales, 2 for Support, or dial an extension.",
    "timeout": 10,
    "max_digits": 4,
    "options": {
      "1": { "action": "dept", "params": { "department": "Sales" } },
      "2": { "action": "dept", "params": { "department": "Support" } }
    }
  }
}
```

## Role-Based Access Control

### Permission System

Permissions follow the format: `resource:action`

**Available Resources:**
- `users` - User management
- `roles` - Role management  
- `tenants` - Tenant management (super admin only)
- `extensions` - Extension management
- `departments` - Department management
- `ivr` - IVR flow management
- `system` - System administration

**Available Actions:**
- `create` - Create new records
- `read` - View records
- `update` - Modify records
- `delete` - Remove records

### Default Roles

1. **Super Admin** - Full system access
2. **Admin** - Tenant-level administration
3. **Manager** - Department-level management
4. **User** - Basic access

## Database Schema

### Core Tables

- `tenants` - Multi-tenant organizations
- `users` - System users
- `roles` - Role definitions
- `user_roles` - User-role assignments
- `extensions` - Phone extensions
- `departments` - Organizational departments
- `call_sessions` - Call tracking and analytics
- `ivr_flows` - IVR flow configurations

### Key Features

- **Row Level Security (RLS)** - Tenant isolation
- **JSONB Fields** - Flexible data storage
- **Audit Trails** - Complete call path tracking
- **Indexes** - Optimized query performance

## Environment Variables

```bash
# Supabase Database
SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=24h

# Server
PORT=3000
NODE_ENV=development

# CORS
ALLOWED_ORIGINS=http://localhost:3000

# Super Admin
SUPER_ADMIN_PASSWORD=admin123
```

## Development

### Scripts

```bash
npm run dev          # Start development server
npm start           # Start production server
npm test            # Run tests
npm run migrate     # Run database migrations
npm run seed        # Seed initial data
```

### Project Structure

```
backend/
├── src/
│   ├── database/           # Database connection and migrations
│   ├── middleware/         # Express middleware
│   ├── routes/            # API route handlers
│   ├── utils/             # Utility functions
│   └── server.js          # Main server file
├── logs/                  # Application logs
├── package.json
├── env.example
└── README.md
```

## Security Features

- **JWT Authentication** - Secure token-based auth
- **Role-Based Access Control** - Granular permissions
- **Input Validation** - Request validation with express-validator
- **Rate Limiting** - API protection against abuse
- **CORS Configuration** - Cross-origin request control
- **Helmet** - Security headers
- **SQL Injection Protection** - Parameterized queries
- **Password Hashing** - bcrypt for password security

## Monitoring & Logging

- **Winston Logger** - Structured logging
- **Request Logging** - All API requests logged
- **Error Tracking** - Comprehensive error handling
- **Call Analytics** - Complete call session tracking
- **Performance Metrics** - Query timing and performance

## Deployment

### Production Setup

1. **Environment Configuration**:
```bash
NODE_ENV=production
JWT_SECRET=your-production-secret
DB_HOST=your-production-db-host
```

2. **Database Setup**:
```bash
npm run migrate
npm run seed
```

3. **Process Management**:
```bash
# Using PM2
npm install -g pm2
pm2 start src/server.js --name "ai-receptionist"

# Using Docker
docker build -t ai-receptionist .
docker run -p 3000:3000 ai-receptionist
```

### Docker Support

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## API Examples

### Authentication

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@default.local",
    "password": "admin123"
  }'

# Use token
curl -X GET http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### API Documentation (Swagger)

After starting the server, open `http://localhost:3000/api-docs` to view interactive API docs generated from the OpenAPI spec at `src/docs/openapi.yaml`. Authenticated routes use Bearer JWT; click "Authorize" and paste your token.

### Create User

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe",
    "roleIds": ["role-id-here"]
  }'
```

### SignalWire Webhook

```bash
curl -X POST http://localhost:3000/api/mcp/ivr/entry \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-id",
    "did": "+1234567890",
    "from": "+0987654321",
    "to": "+1234567890"
  }'
```

## Support

For issues and questions:

1. Check the logs in `logs/` directory
2. Verify database connection and migrations
3. Ensure all environment variables are set
4. Check SignalWire webhook configuration

## License

MIT License - see LICENSE file for details. 