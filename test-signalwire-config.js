#!/usr/bin/env node

// Set up test environment variables for SignalWire
process.env.SIGNALWIRE_SPACE_URL = 'test.signalwire.com';
process.env.SIGNALWIRE_PROJECT_ID = 'test-project-123';
process.env.SIGNALWIRE_TOKEN = 'test-token-456';
process.env.API_BASE_URL = 'http://localhost:3000';

console.log('🔧 Test SignalWire environment variables set:');
console.log('SIGNALWIRE_SPACE_URL:', process.env.SIGNALWIRE_SPACE_URL);
console.log('SIGNALWIRE_PROJECT_ID:', process.env.SIGNALWIRE_PROJECT_ID);
console.log('SIGNALWIRE_TOKEN:', process.env.SIGNALWIRE_TOKEN);
console.log('API_BASE_URL:', process.env.API_BASE_URL);

// Now let's test the SignalWire endpoints
const axios = require('axios');

async function testWithMockConfig() {
    try {
        console.log('\n🧪 Testing SignalWire endpoints with mock config...');
        
        // Login as admin
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
        
        // Test phone numbers endpoint
        console.log('\n1️⃣ Testing phone numbers endpoint...');
        try {
            const response = await axios.get(`http://localhost:3000/api/signalwire/phone-numbers?tenantId=${tenantId}`, { headers });
            console.log('✅ Phone numbers endpoint working:', response.data);
        } catch (error) {
            console.log('❌ Phone numbers endpoint error:', error.response?.data || error.message);
        }
        
        // Test SMS endpoint (correct path: /sms/send)
        console.log('\n2️⃣ Testing SMS endpoint (/sms/send)...');
        try {
            const response = await axios.post('http://localhost:3000/api/signalwire/sms/send', {
                from: '+1987654321',
                to: '+1234567890',
                body: 'Test SMS from SignalWire API',
                tenantId: tenantId
            }, { headers });
            console.log('✅ SMS endpoint working:', response.data);
        } catch (error) {
            console.log('❌ SMS endpoint error:', error.response?.data || error.message);
        }
        
        // Test outbound call endpoint
        console.log('\n3️⃣ Testing outbound call endpoint...');
        try {
            const response = await axios.post('http://localhost:3000/api/signalwire/call/outbound', {
                from: '+1987654321',
                to: '+1234567890',
                tenantId: tenantId
            }, { headers });
            console.log('✅ Outbound call endpoint working:', response.data);
        } catch (error) {
            console.log('❌ Outbound call endpoint error:', error.response?.data || error.message);
        }
        
        // Test SMS webhook (public endpoint)
        console.log('\n4️⃣ Testing SMS webhook endpoint...');
        try {
            const response = await axios.post('http://localhost:3000/api/signalwire/webhook/sms', {
                From: '+1987654321',
                To: '+1234567890',
                Body: 'Test webhook SMS',
                MessageSid: 'test-message-' + Date.now()
            });
            console.log('✅ SMS webhook endpoint working:', response.data);
        } catch (error) {
            console.log('❌ SMS webhook endpoint error:', error.response?.data || error.message);
        }
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testWithMockConfig();
