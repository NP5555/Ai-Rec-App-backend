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
const signalwireRoutes = require('./routes/signalwire');

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

// Static file serving removed - no frontend needed

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
    });
    next();
});

/**
 * @swagger
 * /favicon.ico:
 *   get:
 *     summary: Get favicon
 *     description: Returns the application favicon
 *     responses:
 *       200:
 *         description: Favicon returned successfully
 *         content:
 *           image/svg+xml:
 *             schema:
 *               type: string
 */
app.get('/favicon.ico', (req, res) => {
    const svgFavicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🤖</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svgFavicon);
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Check the health status of the backend service
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "OK"
 *                 timestamp:
 *                   type: string
 *                   format: "date-time"
 *                   example: "2024-01-01T00:00:00.000Z"
 *                 uptime:
 *                   type: number
 *                   description: Service uptime in seconds
 *                   example: 3600
 *                 environment:
 *                   type: string
 *                   example: "development"
 */
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
        title: 'AI Receptionist Backend API',
        version: '1.0.0',
        description: 'Complete API documentation for the AI Receptionist backend system. This API provides endpoints for managing clients, users, IVR systems, and SignalWire integrations.',
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
            name: 'Users',
            description: 'User management operations'
        },
        {
            name: 'Clients',
            description: 'Client management operations'
        },
        {
            name: 'Authentication',
            description: 'User authentication and authorization'
        },
        {
            name: 'IVR',
            description: 'Interactive Voice Response system management'
        },
        {
            name: 'SignalWire',
            description: 'SignalWire communication integration'
        },
        {
            name: 'Extensions',
            description: 'Phone extension management'
        },
        {
            name: 'Tenants',
            description: 'Multi-tenant management'
        },
        {
            name: 'Roles',
            description: 'Role-based access control'
        }
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'JWT token for authentication'
            }
        },
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        example: false
                    },
                    message: {
                        type: 'string',
                        example: 'Error message'
                    },
                    error: {
                        type: 'string',
                        example: 'Detailed error information'
                    }
                }
            },
            Success: {
                type: 'object',
                properties: {
                    success: {
                        type: 'boolean',
                        example: true
                    },
                    message: {
                        type: 'string',
                        example: 'Operation successful'
                    },
                    data: {
                        type: 'object',
                        description: 'Response data'
                    }
                }
            }
        }
    },
    security: [{ bearerAuth: [] }]
};

const swaggerOptions = {
    definition: swaggerDefinition,
    apis: ['./src/routes/**/*.js', './src/server.js', './swagger-documentation.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Define your table name here
const CLIENTS_TABLE = 'clients';

/**
 * @swagger
 * /api/test-connection:
 *   get:
 *     summary: Test Supabase connection
 *     description: Test the connection to the Supabase database
 *     tags: [Database]
 *     responses:
 *       200:
 *         description: Connection successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Successfully connected to Supabase"
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "connected"
 *       500:
 *         description: Connection failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to connect to Supabase"
 *                 error:
 *                   type: string
 */
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

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users
 *     description: Retrieve all users from the users table
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: number
 *                   description: Number of users returned
 *                   example: 5
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       tenant_id:
 *                         type: string
 *                       email:
 *                         type: string
 *                       first_name:
 *                         type: string
 *                       last_name:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       status:
 *                         type: string
 *                       last_login:
 *                         type: string
 *                         format: "date-time"
 *                       created_at:
 *                         type: string
 *                         format: "date-time"
 *                       updated_at:
 *                         type: string
 *                         format: "date-time"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
app.get('/api/users', async (req, res) => {
  try {
    // Query the users table directly
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw error;
    }
    
    res.json({
      success: true,
      count: data ? data.length : 0,
      data: data || []
    });
  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
 });

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     description: Retrieve a specific user by their ID from the users table
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     tenant_id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     first_name:
 *                       type: string
 *                     last_name:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     status:
 *                       type: string
 *                     last_login:
 *                       type: string
 *                       format: "date-time"
 *                     created_at:
 *                       type: string
 *                       format: "date-time"
 *                     updated_at:
 *                       type: string
 *                       format: "date-time"
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('users')
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

/**
 * @swagger
 * /api/clients:
 *   post:
 *     summary: Create a new client
 *     description: Create a new client in the system
 *     tags: [Clients]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - did_e164
 *             properties:
 *               name:
 *                 type: string
 *                 description: Client name
 *                 example: "Acme Corporation"
 *               did_e164:
 *                 type: string
 *                 description: Phone number in E164 format
 *                 example: "+12345678900"
 *               status:
 *                 type: string
 *                 enum: [active, inactive, pending]
 *                 default: active
 *                 example: "active"
 *               after_hours_policy:
 *                 type: string
 *                 enum: [send_to_vm, follow_normal_flow, play_closed_message]
 *                 default: send_to_vm
 *                 example: "send_to_vm"
 *               business_hours:
 *                 type: object
 *                 description: Business hours configuration
 *                 example: {"monday":{"open":"09:00","close":"17:00"}}
 *               timezone:
 *                 type: string
 *                 example: "America/New_York"
 *               greeting:
 *                 type: string
 *                 example: "Welcome to our business!"
 *     responses:
 *       201:
 *         description: Client created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Client created successfully"
 *                 data:
 *                   type: object
 *       400:
 *         description: Bad request - missing required fields
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *       409:
 *         description: Conflict - client already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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

/**
 * @swagger
 * /api/client-users:
 *   post:
 *     summary: Create a new client user
 *     description: Create a new client user in the system
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - client_id
 *             properties:
 *               client_id:
 *                 type: string
 *                 description: ID of the client this user belongs to
 *                 example: "client-123"
 *               first_name:
 *                 type: string
 *                 description: User's first name
 *                 example: "John"
 *               last_name:
 *                 type: string
 *                 description: User's last name
 *                 example: "Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *                 example: "john.doe@example.com"
 *               phone:
 *                 type: string
 *                 description: User's phone number
 *                 example: "+12345678900"
 *               app_role_id:
 *                 type: string
 *                 description: User's application role ID
 *                 example: "role-456"
 *               departments:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: List of departments the user belongs to
 *                 example: ["sales", "support"]
 *               is_active:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the user is active
 *                 example: true
 *     responses:
 *       201:
 *         description: Client user created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Client user created successfully"
 *                 data:
 *                   type: object
 *       400:
 *         description: Bad request - missing required fields or validation error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *       409:
 *         description: Conflict - user already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 */
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
      .from('client_users')
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
app.use('/api/signalwire', signalwireRoutes);

// Frontend routes removed - no frontend needed

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
      console.log(`API Documentation available at http://localhost:${PORT}/api-docs`);
        
    } catch (error) {
        console.log("Error connecting to database:", error);
    }
});

module.exports = app; 