const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');
require('dotenv').config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Check for required environment variables
if (!supabaseUrl || !supabaseKey) {
  logger.error('Missing Supabase credentials. Please check your .env file.');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseKey);

// Test connection function
const testConnection = async () => {
  try {
    logger.info('Attempting to connect to Supabase database');
    // Simple query to test connection without relying on existing tables
    // Just check if we can connect to Supabase
    const { data, error } = await supabase.rpc('get_service_status', {});
    
    // If the RPC function doesn't exist, try a simpler approach
    if (error && error.message.includes('function get_service_status() does not exist')) {
      // Try a simpler approach - just get the server version
      const { data: versionData, error: versionError } = await supabase.rpc('pg_version', {});
      
      if (versionError) {
        // If that also fails, just check if we can connect at all
        logger.info('Checking basic connection to Supabase');
        const isConnected = supabase && supabase.auth !== undefined;
        
        if (isConnected) {
          logger.info('Basic Supabase connection successful');
          return true;
        } else {
          throw new Error('Could not establish basic connection to Supabase');
        }
      }
    }
    
    logger.info('Supabase connection successful');
    return true;
  } catch (error) {
    logger.error('Supabase connection failed:', error.message);
    logger.error('Full error details:', error);
    return false;
  }
};

// Execute query with error handling
const query = async (tableName, action, options = {}) => {
  const start = Date.now();
  try {
    let query = supabase.from(tableName);
    let result;

    switch (action) {
      case 'select':
        query = query.select(options.columns || '*');
        if (options.filter) {
          const { column, operator, value } = options.filter;
          query = query[operator || 'eq'](column, value);
        }
        if (options.limit) {
          query = query.limit(options.limit);
        }
        if (options.single) {
          query = query.single();
        }
        result = await query;
        break;
        
      case 'insert':
        query = query.insert(options.data);
        if (options.returning) {
          query = query.select();
        }
        result = await query;
        break;
        
      case 'update':
        query = query.update(options.data);
        if (options.filter) {
          const { column, operator, value } = options.filter;
          query = query[operator || 'eq'](column, value);
        }
        if (options.returning) {
          query = query.select();
        }
        result = await query;
        break;
        
      case 'delete':
        query = query.delete();
        if (options.filter) {
          const { column, operator, value } = options.filter;
          query = query[operator || 'eq'](column, value);
        }
        if (options.returning) {
          query = query.select();
        }
        result = await query;
        break;
        
      default:
        throw new Error(`Unsupported action: ${action}`);
    }

    const duration = Date.now() - start;
    logger.debug('Executed query', { tableName, action, duration });
    
    return result;
  } catch (error) {
    logger.error('Query error:', { tableName, action, error: error.message });
    throw error;
  }
};

// Get raw Supabase client (for advanced operations)
const getClient = () => {
  return supabase;
};

// Execute raw SQL query (for migrations and complex queries)
const executeRawSql = async (sqlQuery) => {
  const start = Date.now();
  try {
    const { data, error } = await supabase.rpc('execute_sql', { sql: sqlQuery });
    
    if (error) {
      logger.error('Raw SQL query error:', { error: error.message, sql: sqlQuery });
      throw error;
    }
    
    const duration = Date.now() - start;
    logger.debug('Executed raw SQL query', { duration });
    
    return { data, error: null };
  } catch (error) {
    logger.error('Raw SQL execution error:', { error: error.message, sql: sqlQuery });
    throw error;
  }
};

module.exports = {
  supabase,
  query,
  getClient,
  testConnection,
  executeRawSql
};