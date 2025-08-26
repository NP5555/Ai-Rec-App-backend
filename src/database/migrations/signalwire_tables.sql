-- SignalWire Integration Database Migration
-- This script adds the necessary tables and columns for SignalWire functionality

-- 1. Create phone_numbers table
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

-- 2. Create SMS logs table
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

-- 3. Add SignalWire SID column to call_sessions table
ALTER TABLE call_sessions 
ADD COLUMN IF NOT EXISTS signalwire_sid VARCHAR(255);

-- 4. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_phone_numbers_tenant_id ON phone_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_phone_number ON phone_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_signalwire_sid ON phone_numbers(signalwire_sid);
CREATE INDEX IF NOT EXISTS idx_sms_logs_tenant_id ON sms_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_signalwire_sid ON sms_logs(signalwire_sid);
CREATE INDEX IF NOT EXISTS idx_call_sessions_signalwire_sid ON call_sessions(signalwire_sid);

-- 5. Add new permissions for SignalWire functionality
INSERT INTO permissions (name, description) VALUES
('calls:create', 'Create outbound calls'),
('calls:read', 'View call details'),
('sms:create', 'Send SMS messages'),
('phone_numbers:create', 'Create phone numbers'),
('phone_numbers:read', 'View phone numbers'),
('recordings:read', 'View call recordings'),
('analytics:read', 'View call analytics'),
('system:read', 'View system health')
ON CONFLICT (name) DO NOTHING;

-- 6. Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_phone_numbers_updated_at 
    BEFORE UPDATE ON phone_numbers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Add RLS policies for phone_numbers table
ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view phone numbers for their tenant" ON phone_numbers
    FOR SELECT USING (tenant_id IN (
        SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can create phone numbers for their tenant" ON phone_numbers
    FOR INSERT WITH CHECK (tenant_id IN (
        SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can update phone numbers for their tenant" ON phone_numbers
    FOR UPDATE USING (tenant_id IN (
        SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    ));

-- 8. Add RLS policies for sms_logs table
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view SMS logs for their tenant" ON sms_logs
    FOR SELECT USING (tenant_id IN (
        SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    ));

CREATE POLICY "Users can create SMS logs for their tenant" ON sms_logs
    FOR INSERT WITH CHECK (tenant_id IN (
        SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid()
    ));

-- 9. Create view for phone number analytics
CREATE OR REPLACE VIEW phone_number_analytics AS
SELECT 
    pn.tenant_id,
    pn.phone_number,
    pn.friendly_name,
    pn.status as phone_status,
    COUNT(cs.id) as total_calls,
    COUNT(CASE WHEN cs.status = 'completed' THEN 1 END) as answered_calls,
    COUNT(CASE WHEN cs.status = 'no-answer' THEN 1 END) as missed_calls,
    COUNT(CASE WHEN cs.status = 'failed' THEN 1 END) as failed_calls,
    AVG(cs.duration_seconds) as avg_call_duration,
    COUNT(sl.id) as total_sms,
    COUNT(CASE WHEN sl.direction = 'inbound' THEN 1 END) as inbound_sms,
    COUNT(CASE WHEN sl.direction = 'outbound' THEN 1 END) as outbound_sms
FROM phone_numbers pn
LEFT JOIN call_sessions cs ON pn.phone_number = cs.to_number AND pn.tenant_id = cs.tenant_id
LEFT JOIN sms_logs sl ON pn.phone_number = sl.to_number AND pn.tenant_id = sl.tenant_id
GROUP BY pn.id, pn.tenant_id, pn.phone_number, pn.friendly_name, pn.status;

-- 10. Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON phone_numbers TO authenticated;
GRANT SELECT, INSERT ON sms_logs TO authenticated;
GRANT SELECT ON phone_number_analytics TO authenticated;

-- Migration completed successfully
SELECT 'SignalWire tables migration completed successfully' as status;
