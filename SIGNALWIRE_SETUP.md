# SignalWire Integration Setup Guide

This guide will help you set up and configure SignalWire integration for your AI Receptionist backend.

## Prerequisites

1. **SignalWire Account**: Sign up at [signalwire.com](https://signalwire.com)
2. **Node.js 18+**: Ensure you have Node.js 18 or higher installed
3. **Valid Phone Numbers**: Purchase phone numbers through SignalWire dashboard
4. **Public HTTPS Endpoint**: For webhook delivery (ngrok for development)

## 1. SignalWire Account Setup

### Create SignalWire Account
1. Go to [signalwire.com](https://signalwire.com) and sign up
2. Verify your email and complete account setup
3. Add payment method for phone number purchases

### Get API Credentials
1. Navigate to **Console** → **API Keys**
2. Create a new API key with appropriate permissions
3. Note down:
   - **Project ID**
   - **API Token**
   - **Space URL** (e.g., `https://your-space.signalwire.com`)

## 2. Environment Configuration

Update your `.env` file with SignalWire credentials:

```bash
# SignalWire Configuration
SIGNALWIRE_PROJECT_ID=your_project_id_here
SIGNALWIRE_TOKEN=your_api_token_here
SIGNALWIRE_SPACE_URL=https://your-space.signalwire.com
SIGNALWIRE_WEBHOOK_SECRET=your_webhook_secret_here

# API Base URL for webhooks
API_BASE_URL=https://your-domain.com
```

## 3. Phone Number Configuration

### Purchase Phone Numbers
1. In SignalWire Console, go to **Phone Numbers** → **Buy Numbers**
2. Select your desired area code and number
3. Ensure the number supports **Voice** and **SMS** capabilities

### Configure Webhooks
For each phone number, set the webhook URLs:

**Voice Webhook URL:**
```
https://your-domain.com/api/mcp/ivr/entry
```

**SMS Webhook URL:**
```
https://your-domain.com/api/signalwire/webhook/sms
```

**Webhook Method:** POST

## 4. Database Schema Updates

The SignalWire integration requires additional database tables. Run these SQL commands:

```sql
-- Phone numbers table
CREATE TABLE IF NOT EXISTS phone_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    friendly_name VARCHAR(255),
    signalwire_sid VARCHAR(255) UNIQUE,
    voice_webhook_url TEXT,
    sms_webhook_url TEXT,
    status VARCHAR(50) DEFAULT 'active',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- SMS logs table
CREATE TABLE IF NOT EXISTS sms_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    from_number VARCHAR(20) NOT NULL,
    to_number VARCHAR(20) NOT NULL,
    message_body TEXT NOT NULL,
    signalwire_sid VARCHAR(255),
    status VARCHAR(50),
    direction VARCHAR(20) DEFAULT 'outbound',
    sent_by UUID REFERENCES users(id),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    received_at TIMESTAMP WITH TIME ZONE,
    webhook_data JSONB
);

-- Update call_sessions table to include SignalWire SID
ALTER TABLE call_sessions 
ADD COLUMN IF NOT EXISTS signalwire_sid VARCHAR(255);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_phone_numbers_tenant_id ON phone_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_phone_number ON phone_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_sms_logs_tenant_id ON sms_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_signalwire_sid ON sms_logs(signalwire_sid);
CREATE INDEX IF NOT EXISTS idx_call_sessions_signalwire_sid ON call_sessions(signalwire_sid);
```

## 5. Permission Setup

Add these new permissions to your roles system:

```sql
-- Insert new permissions
INSERT INTO permissions (name, description) VALUES
('calls:create', 'Create outbound calls'),
('calls:read', 'View call details'),
('sms:create', 'Send SMS messages'),
('phone_numbers:create', 'Create phone numbers'),
('phone_numbers:read', 'View phone numbers'),
('recordings:read', 'View call recordings'),
('analytics:read', 'View call analytics'),
('system:read', 'View system health');

-- Update existing roles with new permissions
-- Example for Admin role:
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id 
FROM roles r, permissions p 
WHERE r.name = 'Admin' 
AND p.name IN ('calls:create', 'calls:read', 'sms:create', 'phone_numbers:create', 'phone_numbers:read');
```

## 6. Testing the Integration

### Test Phone Number Creation
```bash
curl -X POST http://localhost:3000/api/signalwire/phone-numbers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+1234567890",
    "friendlyName": "Main Office",
    "tenantId": "your-tenant-id"
  }'
```

### Test Outbound Call
```bash
curl -X POST http://localhost:3000/api/signalwire/call/outbound \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+1234567890",
    "to": "+0987654321",
    "tenantId": "your-tenant-id"
  }'
```

### Test SMS Sending
```bash
curl -X POST http://localhost:3000/api/signalwire/sms/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "+1234567890",
    "to": "+0987654321",
    "body": "Hello from AI Receptionist!",
    "tenantId": "your-tenant-id"
  }'
```

## 7. Webhook Testing with ngrok

For local development, use ngrok to expose your local server:

```bash
# Install ngrok
npm install -g ngrok

# Start your server
npm run dev

# In another terminal, expose your server
ngrok http 3000

# Use the ngrok URL in your SignalWire webhook configuration
# e.g., https://abc123.ngrok.io/api/mcp/ivr/entry
```

## 8. Production Deployment

### SSL Certificate
Ensure your production domain has a valid SSL certificate, as SignalWire requires HTTPS for webhooks.

### Environment Variables
Set production environment variables:
```bash
NODE_ENV=production
API_BASE_URL=https://your-production-domain.com
SIGNALWIRE_PROJECT_ID=your_production_project_id
SIGNALWIRE_TOKEN=your_production_token
SIGNALWIRE_SPACE_URL=https://your-production-space.signalwire.com
SIGNALWIRE_WEBHOOK_SECRET=your_production_webhook_secret
```

### Webhook URLs
Update phone number webhook URLs to use your production domain:
- Voice: `https://your-production-domain.com/api/mcp/ivr/entry`
- SMS: `https://your-production-domain.com/api/signalwire/webhook/sms`

## 9. Monitoring and Troubleshooting

### Check Service Health
```bash
curl -X GET http://localhost:3000/api/signalwire/health \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### View Logs
Check your application logs for SignalWire-related errors:
```bash
tail -f logs/combined.log | grep -i signalwire
```

### Common Issues

1. **Webhook Delivery Failures**
   - Verify webhook URLs are accessible
   - Check SSL certificate validity
   - Ensure proper CORS configuration

2. **Authentication Errors**
   - Verify API credentials are correct
   - Check token permissions
   - Ensure space URL is correct

3. **Phone Number Issues**
   - Verify phone number capabilities
   - Check webhook configuration
   - Ensure proper tenant association

## 10. Advanced Features

### Custom IVR Flows
Create custom IVR flows by updating the `ivr_flows` table:

```sql
INSERT INTO ivr_flows (tenant_id, name, flow_config, is_active) VALUES
('tenant-id', 'Custom Flow', '{
  "greeting": "Welcome to our company!",
  "timeout": 15,
  "max_digits": 5,
  "options": {
    "1": {"action": "dept", "params": {"department": "Sales"}},
    "2": {"action": "dept", "params": {"department": "Support"}},
    "3": {"action": "extension", "params": {"extension": "100"}}
  }
}', true);
```

### Call Recording
Enable call recording by adding recording parameters to your IVR flow configuration.

### SMS Auto-Reply
Implement SMS auto-reply logic in the SMS webhook handler.

## 11. Security Considerations

1. **Webhook Validation**: Implement proper webhook signature validation
2. **Rate Limiting**: Configure appropriate rate limits for webhook endpoints
3. **Access Control**: Ensure proper permission checks for all endpoints
4. **Data Encryption**: Encrypt sensitive data in transit and at rest

## 12. Support and Resources

- **SignalWire Documentation**: [docs.signalwire.com](https://docs.signalwire.com)
- **API Reference**: [signalwire.com/docs](https://signalwire.com/docs)
- **Community Forum**: [community.signalwire.com](https://community.signalwire.com)
- **Support**: Contact SignalWire support for account-specific issues

## Next Steps

After completing this setup:

1. Test all endpoints with your SignalWire credentials
2. Configure phone numbers with proper webhooks
3. Set up monitoring and alerting
4. Implement custom IVR flows for your use case
5. Add SMS auto-reply functionality if needed
6. Set up call analytics and reporting

Your AI Receptionist backend is now fully integrated with SignalWire and ready to handle voice calls and SMS messages!
