#!/usr/bin/env node

const { supabase } = require('./src/database/connection');

async function updateAdminPermissions() {
    try {
        console.log('🔧 Updating admin role permissions...');
        
        // Get the admin role
        const { data: adminRole, error: fetchError } = await supabase
            .from('roles')
            .select('id, name, permissions')
            .eq('name', 'super_admin')
            .single();
            
        if (fetchError) {
            console.error('❌ Error fetching admin role:', fetchError);
            return;
        }
        
        if (!adminRole) {
            console.error('❌ Admin role not found');
            return;
        }
        
        console.log('📋 Current admin permissions:', adminRole.permissions);
        
        // Add SignalWire permissions
        const newPermissions = [
            ...adminRole.permissions,
            'calls:create',
            'sms:create', 
            'phone_numbers:read',
            'phone_numbers:create',
            'call_logs:read'
        ];
        
        console.log('📋 New permissions to add:', [
            'calls:create',
            'sms:create', 
            'phone_numbers:read',
            'phone_numbers:create',
            'call_logs:read'
        ]);
        
        // Update the role
        const { error: updateError } = await supabase
            .from('roles')
            .update({ permissions: newPermissions })
            .eq('id', adminRole.id);
            
        if (updateError) {
            console.error('❌ Error updating admin role:', updateError);
            return;
        }
        
        console.log('✅ Admin role permissions updated successfully!');
        console.log('📋 New permissions:', newPermissions);
        
    } catch (error) {
        console.error('❌ Unexpected error:', error);
    }
}

updateAdminPermissions();
