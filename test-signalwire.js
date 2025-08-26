#!/usr/bin/env node

/**
 * SignalWire Integration Test Script
 * 
 * This script tests the basic functionality of the SignalWire integration
 * Run with: node test-signalwire.js
 */

require('dotenv').config();
const signalwireService = require('./src/services/signalwire');

async function testSignalWireIntegration() {
    console.log('🚀 Testing SignalWire Integration...\n');

    // Test 1: Check service health
    console.log('1. Testing Service Health...');
    const health = signalwireService.getHealthStatus();
    console.log('Health Status:', JSON.stringify(health, null, 2));
    
    if (health.status === 'healthy') {
        console.log('✅ SignalWire service is healthy\n');
    } else {
        console.log('❌ SignalWire service is unhealthy\n');
        console.log('Please check your environment variables:\n');
        console.log('- SIGNALWIRE_PROJECT_ID:', process.env.SIGNALWIRE_PROJECT_ID ? '✅ Set' : '❌ Missing');
        console.log('- SIGNALWIRE_TOKEN:', process.env.SIGNALWIRE_TOKEN ? '✅ Set' : '❌ Missing');
        console.log('- SIGNALWIRE_SPACE_URL:', process.env.SIGNALWIRE_SPACE_URL ? '✅ Set' : '❌ Missing');
        console.log('- API_BASE_URL:', process.env.API_BASE_URL ? '✅ Set' : '❌ Missing');
        return;
    }

    // Test 2: Test phone number retrieval (if credentials are set)
    if (process.env.SIGNALWIRE_PROJECT_ID && process.env.SIGNALWIRE_TOKEN) {
        console.log('2. Testing Phone Number Retrieval...');
        try {
            const phoneNumbers = await signalwireService.getPhoneNumbers('test-tenant');
            if (phoneNumbers.success) {
                console.log('✅ Phone numbers retrieved successfully');
                console.log(`Found ${phoneNumbers.phoneNumbers.length} phone numbers\n`);
            } else {
                console.log('❌ Failed to retrieve phone numbers:', phoneNumbers.error, '\n');
            }
        } catch (error) {
            console.log('❌ Error retrieving phone numbers:', error.message, '\n');
        }
    }

    // Test 3: Test webhook signature validation
    console.log('3. Testing Webhook Signature Validation...');
    const testSignature = 'test-signature';
    const testUrl = 'https://example.com/webhook';
    const testBody = '{"test": "data"}';
    
    const isValid = signalwireService.validateWebhookSignature(testSignature, testUrl, testBody);
    console.log('Webhook validation result:', isValid ? '✅ Valid' : '❌ Invalid', '\n');

    // Test 4: Test environment configuration
    console.log('4. Testing Environment Configuration...');
    const requiredEnvVars = [
        'SIGNALWIRE_PROJECT_ID',
        'SIGNALWIRE_TOKEN', 
        'SIGNALWIRE_SPACE_URL',
        'API_BASE_URL'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length === 0) {
        console.log('✅ All required environment variables are set\n');
    } else {
        console.log('❌ Missing environment variables:', missingVars.join(', '), '\n');
    }

    // Test 5: Test service initialization
    console.log('5. Testing Service Initialization...');
    if (signalwireService.voiceApi && signalwireService.restClient) {
        console.log('✅ Voice API initialized:', !!signalwireService.voiceApi);
        console.log('✅ REST Client initialized:', !!signalwireService.restClient, '\n');
    } else {
        console.log('❌ Service not fully initialized\n');
    }

    console.log('🎯 Test Summary:');
    console.log('- Service Health:', health.status);
    console.log('- Environment Variables:', missingVars.length === 0 ? 'Complete' : 'Incomplete');
    console.log('- Service Initialization:', (signalwireService.voiceApi && signalwireService.restClient) ? 'Complete' : 'Incomplete');
    
    if (health.status === 'healthy' && missingVars.length === 0) {
        console.log('\n🎉 SignalWire integration is ready to use!');
        console.log('\nNext steps:');
        console.log('1. Run the database migration: src/database/migrations/signalwire_tables.sql');
        console.log('2. Configure phone numbers in SignalWire dashboard');
        console.log('3. Test the API endpoints with your JWT token');
        console.log('4. Check the SIGNALWIRE_SETUP.md for detailed configuration');
    } else {
        console.log('\n⚠️  Please fix the issues above before using SignalWire integration');
    }
}

// Run the test
testSignalWireIntegration().catch(error => {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
});
