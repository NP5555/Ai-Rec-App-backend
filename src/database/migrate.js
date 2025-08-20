const { query } = require('./connection');
const logger = require('../utils/logger');

const migrations = [
    // Create tenants table
    `
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      domain VARCHAR(255) UNIQUE,
      status VARCHAR(50) DEFAULT 'active',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `,

    // Create roles table
    `
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      permissions JSONB DEFAULT '[]',
      is_system_role BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(tenant_id, name)
    );
  `,

    // Create users table
    `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      phone VARCHAR(20),
      status VARCHAR(50) DEFAULT 'active',
      last_login TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(tenant_id, email)
    );
  `,

    // Create user_roles junction table
    `
    CREATE TABLE IF NOT EXISTS user_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
      assigned_by UUID REFERENCES users(id),
      assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(user_id, role_id)
    );
  `,

    // Create extensions table
    `
    CREATE TABLE IF NOT EXISTS extensions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      extension_number VARCHAR(20) NOT NULL,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      department_id UUID,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      dial_plan JSONB DEFAULT '{}',
      status VARCHAR(50) DEFAULT 'active',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(tenant_id, extension_number)
    );
  `,

    // Create departments table
    `
    CREATE TABLE IF NOT EXISTS departments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      extension_prefix VARCHAR(10),
      members JSONB DEFAULT '[]',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(tenant_id, name)
    );
  `,

    // Create call_sessions table (enhanced for IVR)
    `
    CREATE TABLE IF NOT EXISTS call_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      call_id VARCHAR(255) NOT NULL,
      from_number VARCHAR(20),
      to_number VARCHAR(20),
      did VARCHAR(20),
      started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      ended_at TIMESTAMP WITH TIME ZONE,
      status VARCHAR(50) DEFAULT 'active',
      outcome VARCHAR(100),
      duration_seconds INTEGER,
      path JSONB DEFAULT '[]',
      tags JSONB DEFAULT '[]',
      cdr JSONB DEFAULT '{}',
      total_steps INTEGER DEFAULT 0,
      ai_steps INTEGER DEFAULT 0,
      api_calls INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(tenant_id, call_id)
    );
  `,

    // Create ivr_flows table
    `
    CREATE TABLE IF NOT EXISTS ivr_flows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      flow_config JSONB NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `,

    // Create indexes for better performance
    `
    CREATE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
    CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
    CREATE INDEX IF NOT EXISTS idx_extensions_tenant ON extensions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_extensions_number ON extensions(extension_number);
    CREATE INDEX IF NOT EXISTS idx_departments_tenant ON departments(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_tenant ON call_sessions(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_call_id ON call_sessions(call_id);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_status ON call_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_created_at ON call_sessions(created_at);
    CREATE INDEX IF NOT EXISTS idx_ivr_flows_tenant ON ivr_flows(tenant_id);
  `,

    // Create function to update updated_at timestamp
    `
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
    END;
    $$ language 'plpgsql';
  `,

    // Create triggers for updated_at
    `
    DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
    CREATE TRIGGER update_tenants_updated_at
        BEFORE UPDATE ON tenants
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
    CREATE TRIGGER update_roles_updated_at
        BEFORE UPDATE ON roles
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_users_updated_at ON users;
    CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_extensions_updated_at ON extensions;
    CREATE TRIGGER update_extensions_updated_at
        BEFORE UPDATE ON extensions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_departments_updated_at ON departments;
    CREATE TRIGGER update_departments_updated_at
        BEFORE UPDATE ON departments
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_call_sessions_updated_at ON call_sessions;
    CREATE TRIGGER update_call_sessions_updated_at
        BEFORE UPDATE ON call_sessions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS update_ivr_flows_updated_at ON ivr_flows;
    CREATE TRIGGER update_ivr_flows_updated_at
        BEFORE UPDATE ON ivr_flows
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
  `
];

const runMigrations = async () => {
    try {
        logger.info('Starting database migrations...');

        for (let i = 0; i < migrations.length; i++) {
            const migration = migrations[i];
            logger.info(`Running migration ${i + 1}/${migrations.length}`);
            await query(migration);
        }

        logger.info('All migrations completed successfully!');
    } catch (error) {
        logger.error('Migration failed:', error);
        throw error;
    }
};

// Run migrations if this file is executed directly
if (require.main === module) {
    runMigrations()
        .then(() => {
            logger.info('Database setup completed');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('Database setup failed:', error);
            process.exit(1);
        });
}

module.exports = { runMigrations }; 