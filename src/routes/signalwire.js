const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../database/connection');
const signalwireService = require('../services/signalwire');
const logger = require('../utils/logger');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// @route   POST /api/signalwire/call/outbound
// @desc    Create an outbound call
// @access  Private (auth required)
router.post('/call/outbound', [
    authenticateToken,
    body('from').notEmpty().withMessage('from number is required'),
    body('to').notEmpty().withMessage('to number is required'),
    body('tenantId').notEmpty().withMessage('tenantId is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }

        const { from, to, tenantId, options = {} } = req.body;

        // Verify user has permission to make outbound calls
        const user = req.user;
        if (!user.permissions.includes('calls:create')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to create outbound calls'
            });
        }

        logger.info('Creating outbound call', { from, to, tenantId, userId: user.id });

        // Create call session in database
        const callId = `${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const { error: sessionError } = await supabase
            .from('call_sessions')
            .insert({
                id: supabase.helpers.createId(),
                tenant_id: tenantId,
                call_id: callId,
                from_number: from,
                to_number: to,
                direction: 'outbound',
                started_at: new Date().toISOString(),
                status: 'initiating',
                path: JSON.stringify([{
                    nodeId: 'outbound_init',
                    action: 'call_initiated',
                    at: new Date().toISOString(),
                    data: { from, to, userId: user.id }
                }])
            });

        if (sessionError) {
            logger.error('Error creating call session:', sessionError);
            return res.status(500).json({
                success: false,
                error: 'Database error',
                message: 'Failed to create call session'
            });
        }

        // Create call through SignalWire
        const callResult = await signalwireService.createOutboundCall({
            from,
            to,
            tenantId,
            options: {
                ...options,
                callId,
                userId: user.id
            }
        });

        if (!callResult.success) {
            // Update session status to failed
            await supabase
                .from('call_sessions')
                .update({ 
                    status: 'failed',
                    ended_at: new Date().toISOString()
                })
                .eq('call_id', callId);

            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: callResult.error
            });
        }

        // Update session with SignalWire call SID
        await supabase
            .from('call_sessions')
            .update({ 
                signalwire_sid: callResult.callSid,
                status: 'active'
            })
            .eq('call_id', callId);

        res.json({
            success: true,
            callId,
            signalwireSid: callResult.callSid,
            status: callResult.status,
            message: 'Outbound call initiated successfully'
        });

    } catch (error) {
        logger.error('Outbound call creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while creating the outbound call'
        });
    }
});

// @route   POST /api/signalwire/sms/send
// @desc    Send SMS message
// @access  Private (auth required)
router.post('/sms/send', [
    authenticateToken,
    body('from').notEmpty().withMessage('from number is required'),
    body('to').notEmpty().withMessage('to number is required'),
    body('body').notEmpty().withMessage('message body is required'),
    body('tenantId').notEmpty().withMessage('tenantId is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }

        const { from, to, body: messageBody, tenantId } = req.body;

        // Verify user has permission to send SMS
        const user = req.user;
        if (!user.permissions.includes('sms:create')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to send SMS messages'
            });
        }

        logger.info('Sending SMS', { from, to, tenantId, userId: user.id });

        // Send SMS through SignalWire
        const smsResult = await signalwireService.sendSMS({
            from,
            to,
            body: messageBody,
            tenantId
        });

        if (!smsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: smsResult.error
            });
        }

        // Log SMS in database
        const { error: logError } = await supabase
            .from('sms_logs')
            .insert({
                id: supabase.helpers.createId(),
                tenant_id: tenantId,
                from_number: from,
                to_number: to,
                message_body: messageBody,
                signalwire_sid: smsResult.messageSid,
                status: smsResult.status,
                sent_by: user.id,
                sent_at: new Date().toISOString()
            });

        if (logError) {
            logger.error('Error logging SMS:', logError);
        }

        res.json({
            success: true,
            messageSid: smsResult.messageSid,
            status: smsResult.status,
            message: 'SMS sent successfully'
        });

    } catch (error) {
        logger.error('SMS sending error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while sending the SMS'
        });
    }
});

// @route   GET /api/signalwire/phone-numbers
// @desc    Get phone numbers for a tenant
// @access  Private (auth required)
router.get('/phone-numbers', [
    authenticateToken
], async (req, res) => {
    try {
        const { tenantId } = req.query;
        const user = req.user;

        // Verify user has permission to view phone numbers
        if (!user.permissions.includes('phone_numbers:read')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to view phone numbers'
            });
        }

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Missing parameter',
                message: 'tenantId is required'
            });
        }

        logger.info('Getting phone numbers', { tenantId, userId: user.id });

        const phoneNumbersResult = await signalwireService.getPhoneNumbers(tenantId);

        if (!phoneNumbersResult.success) {
            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: phoneNumbersResult.error
            });
        }

        res.json({
            success: true,
            phoneNumbers: phoneNumbersResult.phoneNumbers
        });

    } catch (error) {
        logger.error('Phone numbers retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while retrieving phone numbers'
        });
    }
});

// @route   POST /api/signalwire/phone-numbers
// @desc    Create a new phone number
// @access  Private (auth required)
router.post('/phone-numbers', [
    authenticateToken,
    body('phoneNumber').notEmpty().withMessage('phone number is required'),
    body('friendlyName').notEmpty().withMessage('friendly name is required'),
    body('tenantId').notEmpty().withMessage('tenantId is required'),
    body('voiceUrl').optional().isURL().withMessage('voice URL must be a valid URL'),
    body('smsUrl').optional().isURL().withMessage('SMS URL must be a valid URL')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }

        const { phoneNumber, friendlyName, tenantId, voiceUrl, smsUrl } = req.body;

        // Verify user has permission to create phone numbers
        const user = req.user;
        if (!user.permissions.includes('phone_numbers:create')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to create phone numbers'
            });
        }

        logger.info('Creating phone number', { phoneNumber, friendlyName, tenantId, userId: user.id });

        // Set default webhook URLs if not provided
        const defaultVoiceUrl = voiceUrl || `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/mcp/ivr/entry`;
        const defaultSmsUrl = smsUrl || `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/signalwire/sms/webhook`;

        const phoneNumberResult = await signalwireService.createPhoneNumber({
            phoneNumber,
            friendlyName,
            tenantId,
            voiceUrl: defaultVoiceUrl,
            smsUrl: defaultSmsUrl
        });

        if (!phoneNumberResult.success) {
            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: phoneNumberResult.error
            });
        }

        // Store phone number in database
        const { error: dbError } = await supabase
            .from('phone_numbers')
            .insert({
                id: supabase.helpers.createId(),
                tenant_id: tenantId,
                phone_number: phoneNumber,
                friendly_name: friendlyName,
                signalwire_sid: phoneNumberResult.phoneNumberSid,
                voice_webhook_url: defaultVoiceUrl,
                sms_webhook_url: defaultSmsUrl,
                status: 'active',
                created_by: user.id,
                created_at: new Date().toISOString()
            });

        if (dbError) {
            logger.error('Error storing phone number in database:', dbError);
            // Note: Phone number was created in SignalWire but not in our DB
            // In production, you might want to handle this differently
        }

        res.json({
            success: true,
            phoneNumberSid: phoneNumberResult.phoneNumberSid,
            phoneNumber: phoneNumberResult.phoneNumber,
            friendlyName: phoneNumberResult.friendlyName,
            message: 'Phone number created successfully'
        });

    } catch (error) {
        logger.error('Phone number creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while creating the phone number'
        });
    }
});

// @route   GET /api/signalwire/analytics
// @desc    Get call analytics for a tenant
// @access  Private (auth required)
router.get('/analytics', [
    authenticateToken
], async (req, res) => {
    try {
        const { tenantId, startDate, endDate } = req.query;
        const user = req.user;

        // Verify user has permission to view analytics
        if (!user.permissions.includes('analytics:read')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to view analytics'
            });
        }

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                error: 'Missing parameter',
                message: 'tenantId is required'
            });
        }

        logger.info('Getting analytics', { tenantId, startDate, endDate, userId: user.id });

        const analyticsResult = await signalwireService.getCallAnalytics(tenantId, {
            startDate,
            endDate
        });

        if (!analyticsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: analyticsResult.error
            });
        }

        res.json({
            success: true,
            analytics: analyticsResult.analytics,
            period: analyticsResult.period
        });

    } catch (error) {
        logger.error('Analytics retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while retrieving analytics'
        });
    }
});

// @route   GET /api/signalwire/call/:callSid
// @desc    Get call details
// @access  Private (auth required)
router.get('/call/:callSid', [
    authenticateToken
], async (req, res) => {
    try {
        const { callSid } = req.params;
        const user = req.user;

        // Verify user has permission to view call details
        if (!user.permissions.includes('calls:read')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to view call details'
            });
        }

        logger.info('Getting call details', { callSid, userId: user.id });

        const callResult = await signalwireService.getCallDetails(callSid);

        if (!callResult.success) {
            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: callResult.error
            });
        }

        res.json({
            success: true,
            call: callResult
        });

    } catch (error) {
        logger.error('Call details retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while retrieving call details'
        });
    }
});

// @route   GET /api/signalwire/recordings/:callSid
// @desc    Get call recordings
// @access  Private (auth required)
router.get('/recordings/:callSid', [
    authenticateToken
], async (req, res) => {
    try {
        const { callSid } = req.params;
        const user = req.user;

        // Verify user has permission to view recordings
        if (!user.permissions.includes('recordings:read')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to view recordings'
            });
        }

        logger.info('Getting call recordings', { callSid, userId: user.id });

        const recordingsResult = await signalwireService.getCallRecordings(callSid);

        if (!recordingsResult.success) {
            return res.status(500).json({
                success: false,
                error: 'SignalWire error',
                message: recordingsResult.error
            });
        }

        res.json({
            success: true,
            recordings: recordingsResult.recordings
        });

    } catch (error) {
        logger.error('Recordings retrieval error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while retrieving recordings'
        });
    }
});

// @route   GET /api/signalwire/health
// @desc    Get SignalWire service health status
// @access  Private (auth required)
router.get('/health', [
    authenticateToken
], async (req, res) => {
    try {
        const user = req.user;

        // Verify user has permission to view system health
        if (!user.permissions.includes('system:read')) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions',
                message: 'You do not have permission to view system health'
            });
        }

        const healthStatus = signalwireService.getHealthStatus();

        res.json({
            success: true,
            health: healthStatus
        });

    } catch (error) {
        logger.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred while checking service health'
        });
    }
});

// @route   POST /api/signalwire/webhook/sms
// @desc    Handle SMS webhook from SignalWire
// @access  Public (SignalWire webhook)
router.post('/webhook/sms', [
    body('From').notEmpty().withMessage('From number is required'),
    body('To').notEmpty().withMessage('To number is required'),
    body('Body').notEmpty().withMessage('Message body is required'),
    body('MessageSid').notEmpty().withMessage('Message SID is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn('SMS webhook validation failed:', errors.array());
            return res.status(400).json({
                success: false,
                error: 'Validation error',
                details: errors.array()
            });
        }

        const { From, To, Body, MessageSid, ...otherParams } = req.body;

        logger.info('SMS webhook received', { 
            from: From, 
            to: To, 
            messageSid: MessageSid,
            body: Body 
        });

        // Extract tenant ID from phone number or custom parameters
        let tenantId = otherParams.tenantId;
        
        // If no tenant ID in custom params, try to find it by phone number
        if (!tenantId) {
            const { data: phoneNumberResult } = await supabase
                .from('phone_numbers')
                .select('tenant_id')
                .eq('phone_number', To)
                .eq('status', 'active')
                .single();

            if (phoneNumberResult) {
                tenantId = phoneNumberResult.tenant_id;
            }
        }

        if (!tenantId) {
            logger.warn('No tenant ID found for SMS webhook', { to: To });
            return res.status(400).json({
                success: false,
                error: 'No tenant ID found',
                message: 'Unable to determine tenant for this phone number'
            });
        }

        // Log incoming SMS
        const { error: logError } = await supabase
            .from('sms_logs')
            .insert({
                id: supabase.helpers.createId(),
                tenant_id: tenantId,
                from_number: From,
                to_number: To,
                message_body: Body,
                signalwire_sid: MessageSid,
                status: 'received',
                direction: 'inbound',
                received_at: new Date().toISOString(),
                webhook_data: JSON.stringify(req.body)
            });

        if (logError) {
            logger.error('Error logging incoming SMS:', logError);
        }

        // Here you could implement SMS auto-reply logic
        // For now, just acknowledge receipt
        res.json({
            success: true,
            message: 'SMS webhook received and processed'
        });

    } catch (error) {
        logger.error('SMS webhook error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred processing the SMS webhook'
        });
    }
});

module.exports = router;
