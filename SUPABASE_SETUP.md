# Supabase Setup Guide for AI Receptionist Backend

This guide will help you set up Supabase as the database for the AI Receptionist backend.

## Prerequisites

- Supabase account (free at https://supabase.com)
- Node.js 18+ installed
- Git (optional, for version control)

## Step 1: Create Supabase Project

1. **Sign up/Login to Supabase**:
   - Go to https://supabase.com
   - Sign up or log in to your account

2. **Create New Project**:
   - Click "New Project"
   - Choose your organization
   - Enter project name (e.g., "ai-receptionist")
   - Enter database password (save this!)
   - Choose region closest to your users
   - Click "Create new project"

3. **Wait for Setup**:
   - Supabase will provision your database
   - This usually takes 1-2 minutes

## Step 2: Get Database Connection String

1. **Navigate to Database Settings**:
   - In your Supabase dashboard, go to Settings > Database

2. **Copy Connection String**:
   - Scroll down to "Connection string"
   - Select "URI" format
   - Copy the connection string
   - It looks like: `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

3. **Replace Placeholders**:
   - Replace `[YOUR-PASSWORD]` with your database password
   - Replace `[PROJECT-REF]` with your project reference

## Step 3: Configure Environment Variables

1. **Copy Environment Template**:
   ```bash
   cd backend
   cp env.example .env
   ```

2. **Edit .env File**:
   ```bash
   # Replace the database URL with your Supabase connection string
   SUPABASE_DB_URL=postgresql://postgres:your_actual_password@db.your_project_ref.supabase.co:5432/postgres
   
   # Also set for compatibility
   DATABASE_URL=postgresql://postgres:your_actual_password@db.your_project_ref.supabase.co:5432/postgres
   
   # Set a strong JWT secret
   JWT_SECRET=your-super-secret-jwt-key-here
   
   # Other settings...
   PORT=3000
   NODE_ENV=development
   ```

## Step 4: Run Database Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Migrations**:
   ```bash
   npm run migrate
   ```
   This will create all the necessary tables in your Supabase database.

3. **Seed Initial Data**:
   ```bash
   npm run seed
   ```
   This will create:
   - Default tenant
   - System roles (super_admin, admin, manager, user)
   - Super admin user (admin@default.local / admin123)
   - Sample departments and extensions

## Step 5: Configure Row Level Security (RLS)

Supabase automatically enables RLS, but you need to configure policies for your tables.

1. **Go to Authentication > Policies** in your Supabase dashboard

2. **Enable RLS for each table** (if not already enabled):
   - tenants
   - users
   - roles
   - user_roles
   - extensions
   - departments
   - call_sessions
   - ivr_flows

3. **Create RLS Policies** (optional - the migration script handles this):
   ```sql
   -- Example policy for users table
   CREATE POLICY "Users can view their own tenant's users" ON users
   FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true));
   ```

## Step 6: Test the Setup

1. **Start the Server**:
   ```bash
   npm run dev
   ```

2. **Test Health Endpoint**:
   ```bash
   curl http://localhost:3000/health
   ```

3. **Test Authentication**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{
       "email": "admin@default.local",
       "password": "admin123"
     }'
   ```

## Step 7: Supabase Dashboard Features

### Database Browser
- View and edit data directly in Supabase dashboard
- Navigate to Table Editor to see your tables
- Use SQL Editor for custom queries

### Authentication
- Supabase provides built-in auth (optional)
- You can use Supabase Auth alongside your JWT system
- Configure email templates and auth settings

### Real-time Features
- Enable real-time subscriptions for live updates
- Useful for call status updates and notifications

### Storage
- Use Supabase Storage for voicemail files
- Configure storage buckets and policies

## Environment Variables Reference

```bash
# Required
SUPABASE_DB_URL=postgresql://postgres:password@db.ref.supabase.co:5432/postgres
DATABASE_URL=postgresql://postgres:password@db.ref.supabase.co:5432/postgres

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=24h

# Server Configuration
PORT=3000
NODE_ENV=development

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Super Admin Configuration
SUPER_ADMIN_PASSWORD=admin123

# Optional: Supabase API (for additional features)
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Troubleshooting

### Connection Issues
- **SSL Error**: Ensure `ssl: { rejectUnauthorized: false }` is set
- **Authentication Error**: Verify password in connection string
- **Host Error**: Check project reference in URL

### Migration Issues
- **Permission Error**: Ensure your database user has CREATE privileges
- **Table Exists**: Drop existing tables if re-running migrations
- **RLS Error**: Disable RLS temporarily for initial setup

### Common Commands
```bash
# Reset database (careful!)
npm run migrate:reset

# Check connection
node -e "require('./src/database/connection').testConnection().then(console.log)"

# View logs
tail -f logs/combined.log
```

## Production Deployment

### Environment Variables
```bash
NODE_ENV=production
SUPABASE_DB_URL=your-production-supabase-url
JWT_SECRET=your-production-jwt-secret
```

### Security Considerations
- Use strong JWT secrets
- Enable RLS policies
- Configure CORS properly
- Use environment-specific database URLs
- Enable Supabase logging and monitoring

### Monitoring
- Use Supabase dashboard for database monitoring
- Set up alerts for connection issues
- Monitor query performance
- Track authentication events

## Next Steps

1. **Set up your frontend** to connect to the backend API
2. **Configure SignalWire** webhooks to point to your IVR endpoints
3. **Set up monitoring** and logging for production
4. **Customize roles and permissions** for your specific needs
5. **Configure email notifications** for user management

## Support

- **Supabase Documentation**: https://supabase.com/docs
- **Supabase Community**: https://github.com/supabase/supabase/discussions
- **Backend Issues**: Check logs in `logs/` directory
- **Database Issues**: Use Supabase dashboard SQL editor 