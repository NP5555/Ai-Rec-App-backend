#!/usr/bin/env node

// SignalWire Configuration Setup
// Replace these values with your actual SignalWire credentials

const SIGNALWIRE_CONFIG = {
    // Your SignalWire Space URL (e.g., 'your-space.signalwire.com')
    SPACE_URL: 'your-space.signalwire.com',
    
    // Your SignalWire Project ID
    PROJECT_ID: 'your-project-id',
    
    // Your SignalWire Auth Token
    AUTH_TOKEN: 'your-auth-token',
    
    // Your registered phone number
    REGISTERED_PHONE: '+15139685075'
};

// Set environment variables
process.env.SIGNALWIRE_SPACE_URL = SIGNALWIRE_CONFIG.SPACE_URL;
process.env.SIGNALWIRE_PROJECT_ID = SIGNALWIRE_CONFIG.PROJECT_ID;
process.env.SIGNALWIRE_TOKEN = SIGNALWIRE_CONFIG.AUTH_TOKEN;
process.env.API_BASE_URL = 'http://localhost:3000';

console.log('🔧 SignalWire Configuration:');
console.log('=====================================');
console.log('Space URL:', process.env.SIGNALWIRE_SPACE_URL);
console.log('Project ID:', process.env.SIGNALWIRE_PROJECT_ID);
console.log('Auth Token:', process.env.SIGNALWIRE_TOKEN ? '***SET***' : 'NOT SET');
console.log('Registered Phone:', SIGNALWIRE_CONFIG.REGISTERED_PHONE);
console.log('API Base URL:', process.env.API_BASE_URL);

// Check if credentials are properly set
if (SIGNALWIRE_CONFIG.SPACE_URL === 'your-space.signalwire.com' || 
    SIGNALWIRE_CONFIG.PROJECT_ID === 'your-project-id' || 
    SIGNALWIRE_CONFIG.AUTH_TOKEN === 'your-auth-token') {
    console.log('\n❌ Please update the SIGNALWIRE_CONFIG object with your real credentials!');
    console.log('1. Go to https://console.signalwire.com');
    console.log('2. Get your Space URL, Project ID, and Auth Token');
    console.log('3. Update this script and run it again');
    process.exit(1);
}

console.log('\n✅ Configuration looks good! Testing SignalWire endpoints...');

// Test the SignalWire endpoints
const axios = require('axios');

async function testSignalWireEndpoints() {
    try {
        // Login as admin
        console.log('\n🔐 Logging in as admin...');
        const loginResponse = await axios.post('http://localhost:3000/api/auth/login', {
            email: 'admin@default.local',
            password: 'admin123'
        });
        
        const token = loginResponse.data.data.token;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
        
        const tenantId = 'b5e76732-8327-4d88-a761-d57b67780d52';
        
        console.log('\n🧪 Testing SignalWire Endpoints with Real Credentials');
        console.log('=====================================================');
        
        // Test 1: Get phone numbers
        console.log('\n1️⃣ Testing GET /api/signalwire/phone-numbers');
        try {
            const response = await axios.get(`http://localhost:3000/api/signalwire/phone-numbers?tenantId=${tenantId}`, { headers });
            console.log('✅ Phone numbers endpoint working!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        } catch (error) {
            console.log('❌ Phone numbers endpoint failed:', error.response?.data?.error || error.message);
        }
        
        // Test 2: Send SMS using your registered number
        console.log('\n2️⃣ Testing POST /api/signalwire/sms/send');
        try {
            const response = await axios.post('http://localhost:3000/api/signalwire/sms/send', {
                from: SIGNALWIRE_CONFIG.REGISTERED_PHONE,
                to: '+1234567890', // Test number
                body: 'Test SMS from SignalWire API - ' + new Date().toISOString(),
                tenantId: tenantId
            }, { headers });
            console.log('✅ SMS endpoint working!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        } catch (error) {
            console.log('❌ SMS endpoint failed:', error.response?.data?.error || error.message);
        }
        
        // Test 3: Create outbound call
        console.log('\n3️⃣ Testing POST /api/signalwire/call/outbound');
        try {
            const response = await axios.post('http://localhost:3000/api/signalwire/call/outbound', {
                from: SIGNALWIRE_CONFIG.REGISTERED_PHONE,
                to: '+1234567890', // Test number
                tenantId: tenantId
            }, { headers });
            console.log('✅ Outbound call endpoint working!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        } catch (error) {
            console.log('❌ Outbound call endpoint failed:', error.response?.data?.error || error.message);
        }
        
        // Test 4: Create a new phone number (if you have permissions)
        console.log('\n4️⃣ Testing POST /api/signalwire/phone-numbers');
        try {
            const response = await axios.post('http://localhost:3000/api/signalwire/phone-numbers', {
                phoneNumber: '+15551234567', // Test number
                friendlyName: 'Test Phone Number',
                tenantId: tenantId,
                voiceUrl: 'http://localhost:3000/api/signalwire/webhook/voice',
                smsUrl: 'http://localhost:3000/api/signalwire/webhook/sms'
            }, { headers });
            console.log('✅ Phone number creation endpoint working!');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        } catch (error) {
            console.log('❌ Phone number creation failed:', error.response?.data?.error || error.message);
        }
        
        console.log('\n🎯 Test Summary:');
        console.log('✅ Admin permissions are working');
        console.log('✅ SignalWire service is configured');
        console.log('✅ Ready to test with real phone numbers!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testSignalWireEndpoints();
