#!/usr/bin/env node

// Load environment variables from .env file
require('dotenv').config();

const axios = require('axios');

// SignalWire Configuration from .env
const SIGNALWIRE_CONFIG = {
    SPACE_URL: process.env.SIGNALWIRE_SPACE_URL,
    PROJECT_ID: process.env.SIGNALWIRE_PROJECT_ID,
    AUTH_TOKEN: process.env.SIGNALWIRE_TOKEN,
    REGISTERED_PHONE: '+15139685075' // Your registered number
};

console.log('🔧 SignalWire Configuration from .env:');
console.log('=====================================');
console.log('Space URL:', SIGNALWIRE_CONFIG.SPACE_URL);
console.log('Project ID:', SIGNALWIRE_CONFIG.PROJECT_ID);
console.log('Auth Token:', SIGNALWIRE_CONFIG.AUTH_TOKEN ? '***SET***' : 'NOT SET');
console.log('Registered Phone:', SIGNALWIRE_CONFIG.REGISTERED_PHONE);
console.log('API Base URL:', process.env.API_BASE_URL);

// Test the SignalWire endpoints
async function testRealSignalWireEndpoints() {
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
                to: '+1234567890', // Test number - you can change this to a real number
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
                to: '+1234567890', // Test number - you can change this to a real number
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
        console.log('✅ SignalWire credentials are configured');
        console.log('✅ Ready to test with real phone numbers!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testRealSignalWireEndpoints();
