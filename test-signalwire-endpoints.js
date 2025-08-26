#!/usr/bin/env node

const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
let authToken = '';

async function login(email, password) {
    try {
        const response = await axios.post(`${BASE_URL}/api/auth/login`, {
            email,
            password
        });
        
        if (response.data.success) {
            authToken = response.data.data.token;
            console.log('✅ Login successful');
            console.log(`User: ${response.data.data.user.firstName} ${response.data.data.user.lastName}`);
            console.log(`Permissions: ${response.data.data.user.permissions.join(', ')}`);
            return true;
        }
    } catch (error) {
        console.error('❌ Login failed:', error.response?.data || error.message);
        return false;
    }
}

async function testSignalWireEndpoints() {
    if (!authToken) {
        console.error('❌ No auth token available. Please login first.');
        return;
    }

    const headers = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
    };

    const tenantId = 'b5e76732-8327-4d88-a761-d57b67780d52';

    console.log('\n🔍 Testing SignalWire Endpoints...');
    console.log('=====================================');

    // Test 1: Get phone numbers
    console.log('\n1️⃣ Testing GET /api/signalwire/phone-numbers');
    try {
        const response = await axios.get(`${BASE_URL}/api/signalwire/phone-numbers?tenantId=${tenantId}`, { headers });
        console.log('✅ Phone numbers endpoint working');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ Phone numbers endpoint failed:', error.response?.data?.error || error.message);
    }

    // Test 2: Send SMS
    console.log('\n2️⃣ Testing POST /api/signalwire/sms');
    try {
        const response = await axios.post(`${BASE_URL}/api/signalwire/sms`, {
            from: '+1987654321',
            to: '+1234567890',
            body: 'Test SMS from SignalWire API',
            tenantId: tenantId
        }, { headers });
        console.log('✅ SMS endpoint working');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ SMS endpoint failed:', error.response?.data?.error || error.message);
    }

    // Test 3: Create outbound call
    console.log('\n3️⃣ Testing POST /api/signalwire/call/outbound');
    try {
        const response = await axios.post(`${BASE_URL}/api/signalwire/call/outbound`, {
            from: '+1987654321',
            to: '+1234567890',
            tenantId: tenantId
        }, { headers });
        console.log('✅ Outbound call endpoint working');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ Outbound call endpoint failed:', error.response?.data?.error || error.message);
    }

    // Test 4: Get call logs
    console.log('\n4️⃣ Testing GET /api/signalwire/call-logs');
    try {
        const response = await axios.get(`${BASE_URL}/api/signalwire/call-logs?tenantId=${tenantId}`, { headers });
        console.log('✅ Call logs endpoint working');
        console.log('Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ Call logs endpoint failed:', error.response?.data?.error || error.message);
    }
}

async function main() {
    console.log('🚀 SignalWire Endpoints Test Script');
    console.log('=====================================');

    // Try to login as admin first
    console.log('\n🔐 Attempting to login as admin...');
    const adminLoginSuccess = await login('admin@default.local', 'admin123');
    
    if (!adminLoginSuccess) {
        console.log('\n🔐 Attempting to login as regular user...');
        await login('testuser@example.com', 'password123');
    }

    if (authToken) {
        await testSignalWireEndpoints();
    } else {
        console.error('❌ Could not authenticate with any user');
    }
}

main().catch(console.error);
