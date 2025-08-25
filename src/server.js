const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { testConnection, supabase } = require('./database/connection');
// Swagger/OpenAPI
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const roleRoutes = require('./routes/roles');
const tenantRoutes = require('./routes/tenants');
const ivrRoutes = require('./routes/ivr');
const extensionRoutes = require('./routes/extensions');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files from public directory
app.use(express.static('public'));

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Swagger setup
const swaggerDefinition = {
    openapi: '3.0.3',
    info: {
        title: 'AI Receptionist API',
        version: '1.0.0',
        description: 'API documentation for AI Receptionist backend',
    },
    servers: [
        { url: '/'}
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
            }
        }
    },
    security: [{ bearerAuth: [] }]
};

const swaggerOptions = {
    definition: swaggerDefinition,
    apis: ['./src/routes/**/*.js', './src/server.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Define your table name here
const CLIENT_USERS_TABLE = 'client_users';
const CLIENTS_TABLE = 'clients';

// Test endpoint to verify Supabase connection
app.get('/api/test-connection', async (req, res) => {
  try {
    // Check if we can connect to Supabase at all
    const isConnected = supabase && supabase.auth !== undefined;
    
    if (!isConnected) {
      throw new Error('Could not establish basic connection to Supabase');
    }
    
    res.json({
      success: true,
      message: 'Successfully connected to Supabase',
      data: { status: 'connected' }
    });
  } catch (error) {
    logger.error('Supabase connection error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to connect to Supabase',
      error: error.message
    });
  }
});

// GET all users
app.get('/api/users', async (req, res) => {
  try {
    // Check if the table exists first
    const { data: tableExists, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', CLIENT_USERS_TABLE)
      .limit(1);
    
    if (tableError) {
      throw tableError;
    }
    
    if (!tableExists || tableExists.length === 0) {
      return res.json({
        success: true,
        message: `Table ${CLIENT_USERS_TABLE} does not exist yet. Run migrations first.`,
        count: 0,
        data: []
      });
    }
    
    const { data, error } = await supabase
      .from(CLIENT_USERS_TABLE)
      .select('*');
    
    if (error) {
      throw error;
    }
    
    res.json({
      success: true,
      count: data ? data.length : 0,
      data: data || []
    });
  } catch (error) {
    logger.error('Error fetching data:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET user by ID
app.get('/api/users/:id', async (req, res) => {
  try {
    // Check if the table exists first
    const { data: tableExists, error: tableError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', CLIENT_USERS_TABLE)
      .limit(1);
    
    if (tableError) {
      throw tableError;
    }
    
    if (!tableExists || tableExists.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Table ${CLIENT_USERS_TABLE} does not exist yet. Run migrations first.`
      });
    }
    
    const { id } = req.params;
    const { data, error } = await supabase
      .from(CLIENT_USERS_TABLE)
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      throw error;
    }
    
    if (!data) {
      return res.status(404).json({
        success: false,
        message: `No user found with id: ${id}`
      });
    }
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Error fetching user by ID:', error);
    res.status(error.code === 'PGRST116' ? 404 : 500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint to create a new client
app.post('/api/clients', async (req, res) => {
  try {
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body cannot be empty'
      });
    }

    // Check for required fields according to schema
    const requiredFields = ['name', 'did_e164'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Set default values based on schema
    const clientData = {
      ...req.body,
      status: req.body.status || 'active',
      after_hours_policy: req.body.after_hours_policy || 'send_to_vm'
    };
    
    // Insert the client
    const { data, error } = await supabase
      .from(CLIENTS_TABLE)
      .insert(clientData)
      .select();
    
    if (error) {
      throw error;
    }
    
    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data
    });
  } catch (error) {
    logger.error('Error creating client:', error);
    
    // Handle common errors
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A client with this identifier already exists',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Specialized endpoint for adding a client user with proper validation
app.post('/api/client-users', async (req, res) => {
  try {
    // Validate request body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body cannot be empty'
      });
    }

    // Required fields validation - client_id is the only required field based on schema
    const requiredFields = ['client_id'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate foreign keys to prevent constraint violations
    
    // Check if client exists (foreign key validation)
    if (req.body.client_id) {
      const { data: clientExists, error: clientError } = await supabase
        .from(CLIENTS_TABLE)
        .select('id')
        .eq('id', req.body.client_id)
        .single();
      
      if (clientError || !clientExists) {
        return res.status(400).json({
          success: false,
          message: `Client with id ${req.body.client_id} does not exist. Please create the client first.`
        });
      }
    }

    // Ensure departments is an array if provided
    if (req.body.departments && !Array.isArray(req.body.departments)) {
      req.body.departments = [req.body.departments];
    }

    // Set default values based on schema
    const userData = {
      ...req.body,
      is_active: req.body.is_active === undefined ? true : req.body.is_active
    };

    // Insert the client user
    const { data, error } = await supabase
      .from(CLIENT_USERS_TABLE)
      .insert(userData)
      .select();
    
    if (error) {
      throw error;
    }
    
    res.status(201).json({
      success: true,
      message: 'Client user created successfully',
      data
    });
  } catch (error) {
    logger.error('Error creating client user:', error);
    
    // Handle common errors
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'A client user with this identifier already exists',
        error: error.message
      });
    } else if (error.code === '23503') {
      return res.status(400).json({
        success: false,
        message: 'Foreign key constraint violation. Check client_id values.',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/mcp/ivr', ivrRoutes);
app.use('/api/extensions', extensionRoutes);

// Serve HTML forms
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: './public' });
});

app.get('/client', (req, res) => {
  res.sendFile('client-form.html', { root: './public' });
});

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start server and test database connection
app.listen(PORT, async () => {
    logger.info(`Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
    try {
      // Test database connection
      const isConnected = await testConnection();
      if (isConnected) {
          console.log('\x1b[32m%s\x1b[0m', '✓ Successfully connected to Supabase database');
      } else {
          console.log('\x1b[31m%s\x1b[0m', '✗ Failed to connect to Supabase database');
      }
      
      // Log URLs for reference
      // console.log(`Supabase connection initialized with URL: ${process.env.SUPABASE_URL}`);
      console.log(`Frontend available at http://localhost:${PORT}`);
        
    } catch (error) {
        console.log("Error connecting to database:", error);
    }
});

module.exports = app; 