const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../database/connection');
const logger = require('../utils/logger');

const router = express.Router();

// @route   POST /api/mcp/ivr/entry
// @desc    Handle inbound call entry from SignalWire
// @access  Public (SignalWire webhook)
router.post('/entry', [
    body('tenantId').notEmpty().withMessage('tenantId is required'),
    body('did').notEmpty().withMessage('did is required'),
    body('from').notEmpty().withMessage('from is required'),
    body('to').notEmpty().withMessage('to is required'),
    body('ts').optional().isISO8601().withMessage('ts must be a valid ISO date')
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

        const { tenantId, did, from, to, ts } = req.body;
        const callId = `${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        logger.info('IVR Entry received', { tenantId, did, from, to, callId });

        // Create call session
        const { error: sessionError } = await supabase
            .from('call_sessions')
            .insert({
                id: supabase.helpers.createId(),
                tenant_id: tenantId,
                call_id: callId,
                from_number: from,
                to_number: to,
                did: did,
                started_at: ts || new Date().toISOString(),
                status: 'active',
                path: JSON.stringify([{
                    nodeId: 'entry',
                    action: 'call_received',
                    at: new Date().toISOString(),
                    data: { did, from, to }
                }])
            });

        if (sessionError) {
            logger.error('Error creating call session:', sessionError);
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: 'Failed to create call session'
            });
        }

        // Get IVR flow configuration
        const { data: flowResult, error: flowError } = await supabase
            .from('ivr_flows')
            .select('flow_config')
            .eq('tenant_id', tenantId)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (flowError || !flowResult) {
            // Default IVR flow if none configured
            const defaultFlow = {
                greeting: 'Welcome. Please press 1 for Sales, 2 for Support, 3 for Billing, or dial an extension.',
                timeout: 10,
                max_digits: 4,
                retries: 3,
                options: {
                    '1': { action: 'dept', params: { department: 'Sales' } },
                    '2': { action: 'dept', params: { department: 'Support' } },
                    '3': { action: 'dept', params: { department: 'Billing' } },
                    'default': { action: 'ai', params: { prompt: 'I can help you connect to the right department. What can I assist you with?' } }
                },
                fallback: { action: 'voicemail', params: { message: 'Please leave a message and we\'ll get back to you.' } }
            };

            return res.json({
                success: true,
                callId,
                action: 'gather',
                params: {
                    greeting: defaultFlow.greeting,
                    timeout: defaultFlow.timeout,
                    max_digits: defaultFlow.max_digits,
                    retries: defaultFlow.retries,
                    options: defaultFlow.options
                }
            });
        }

        const flowConfig = flowResult.flow_config;

        // Log the entry step
        const { error: updateError } = await supabase
            .from('call_sessions')
            .update({
                path: supabase.sql`jsonb_array_append(path, ${JSON.stringify({
                    nodeId: 'ivr_entry',
                    action: 'ivr_greeting',
                    at: new Date().toISOString(),
                    data: { flow: flowConfig.name }
                })}::jsonb)`
            })
            .eq('call_id', callId);

        if (updateError) {
            logger.error('Error updating call session path:', updateError);
        }

        res.json({
            success: true,
            callId,
            action: 'gather',
            params: {
                greeting: flowConfig.greeting || 'Welcome. How may I help you?',
                timeout: flowConfig.timeout || 10,
                max_digits: flowConfig.max_digits || 4,
                retries: flowConfig.retries || 3,
                options: flowConfig.options || {}
            }
        });

    } catch (error) {
        logger.error('IVR Entry error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred during IVR entry'
        });
    }
});

// @route   POST /api/mcp/ivr/event
// @desc    Handle IVR events from SignalWire
// @access  Public (SignalWire webhook)
router.post('/event', [
    body('tenantId').notEmpty().withMessage('tenantId is required'),
    body('callId').notEmpty().withMessage('callId is required'),
    body('event').notEmpty().withMessage('event is required'),
    body('data').optional().isObject().withMessage('data must be an object')
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

        const { tenantId, callId, event, data } = req.body;

        logger.info('IVR Event received', { tenantId, callId, event, data });

        // Log the event
        const { error: updateError } = await supabase
            .from('call_sessions')
            .update({
                path: supabase.sql`jsonb_array_append(path, ${JSON.stringify({
                    nodeId: 'ivr_event',
                    action: event,
                    at: new Date().toISOString(),
                    data: data || {}
                })}::jsonb)`
            })
            .eq('call_id', callId);

        if (updateError) {
            logger.error('Error updating call session path:', updateError);
        }

        let action = 'hangup';
        let params = { reason: 'call_ended' };

        switch (event) {
            case 'dtmf_menu':
                // Handle DTMF menu selection
                const digit = data?.digit;
                if (digit) {
                    const { data: flowResult, error: flowError } = await supabase
                        .from('ivr_flows')
                        .select('flow_config')
                        .eq('tenant_id', tenantId)
                        .eq('is_active', true)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (flowError || !flowResult) {
                        action = 'ai';
                        params = { prompt: 'I didn\'t recognize that option. How can I help you?' };
                    } else {
                        const flowConfig = flowResult.flow_config;
                        const option = flowConfig.options[digit];

                        if (option) {
                            action = option.action;
                            params = option.params;
                        } else {
                            // Handle extension dialing
                            const { data: extensionResult, error: extensionError } = await supabase
                                .from('extensions')
                                .select('extension_number, name, dial_plan')
                                .eq('tenant_id', tenantId)
                                .eq('extension_number', digit)
                                .eq('status', 'active')
                                .single();

                            if (extensionError || !extensionResult) {
                                action = 'ai';
                                params = { prompt: 'I didn\'t recognize that option. How can I help you?' };
                            } else {
                                const extension = extensionResult;
                                action = 'extension';
                                params = {
                                    extension: extension.extension_number,
                                    name: extension.name,
                                    dialPlan: extension.dial_plan
                                };
                            }
                        }
                    }
                }
                break;

            case 'extension_dial':
                // Handle extension dialing
                const extensionNumber = data?.extension;
                if (extensionNumber) {
                    const { data: extensionResult, error: extensionError } = await supabase
                        .from('extensions')
                        .select('extension_number, name, dial_plan')
                        .eq('tenant_id', tenantId)
                        .eq('extension_number', extensionNumber)
                        .eq('status', 'active')
                        .single();

                    if (extensionError || !extensionResult) {
                        action = 'ai';
                        params = { prompt: 'Extension not found. How can I help you?' };
                    } else {
                        const extension = extensionResult;
                        action = 'extension';
                        params = {
                            extension: extension.extension_number,
                            name: extension.name,
                            dialPlan: extension.dial_plan
                        };
                    }
                }
                break;

            case 'ai_handoff':
                // Handle AI handoff
                action = 'ai';
                params = {
                    prompt: data?.prompt || 'How can I assist you today?',
                    model: data?.model || 'default'
                };
                break;

            case 'dept_dial':
                // Handle department dialing
                const departmentName = data?.department;
                if (departmentName) {
                    const { data: deptResult, error: deptError } = await supabase
                        .from('departments')
                        .select('name, settings, extensions')
                        .eq('tenant_id', tenantId)
                        .eq('name', departmentName)
                        .single();

                    if (deptError || !deptResult) {
                        action = 'voicemail';
                        params = { message: 'Department not available. Please leave a message.' };
                    } else {
                        const department = deptResult;
                        action = 'dept';
                        params = {
                            department: department.name,
                            greeting: department.settings?.greeting || `Connecting you to ${department.name}`,
                            extensions: department.extensions || []
                        };
                    }
                }
                break;

            case 'answered':
                // Call was answered
                action = 'answered';
                params = {
                    duration: data?.duration || 0,
                    answeredBy: data?.answeredBy || 'unknown'
                };
                break;

            case 'no_answer':
                // No answer - try fallback
                action = 'voicemail';
                params = { message: 'No one is available to take your call. Please leave a message.' };
                break;

            case 'busy':
                // Line busy - try fallback
                action = 'voicemail';
                params = { message: 'The line is busy. Please leave a message.' };
                break;

            case 'failed':
                // Call failed - try fallback
                action = 'voicemail';
                params = { message: 'Unable to complete your call. Please leave a message.' };
                break;

            case 'timeout':
                // Timeout - try fallback
                action = 'voicemail';
                params = { message: 'No response received. Please leave a message.' };
                break;

            default:
                // Unknown event - end call
                action = 'hangup';
                params = { reason: 'unknown_event' };
        }

        res.json({
            success: true,
            callId,
            action,
            params
        });

    } catch (error) {
        logger.error('IVR Event error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred processing the IVR event'
        });
    }
});

// @route   POST /api/mcp/ivr/log
// @desc    Log call completion data
// @access  Public (SignalWire webhook)
router.post('/log', [
    body('tenantId').notEmpty().withMessage('tenantId is required'),
    body('callId').notEmpty().withMessage('callId is required'),
    body('cdr').optional().isObject().withMessage('cdr must be an object')
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

        const { tenantId, callId, cdr } = req.body;

        logger.info('IVR Log received', { tenantId, callId, cdr });

        // Get call session
        const { data: callResult, error: callError } = await supabase
            .from('call_sessions')
            .select('*')
            .eq('call_id', callId)
            .eq('tenant_id', tenantId)
            .single();

        if (callError || !callResult) {
            return res.status(404).json({
                success: false,
                error: 'Call not found',
                message: 'Call session not found'
            });
        }

        const callSession = callResult;
        const path = JSON.parse(callSession.path || '[]');

        // Determine outcome based on path
        let outcome = 'unknown';
        let tags = [];

        // Analyze path to determine outcome
        const lastEvent = path[path.length - 1];
        if (lastEvent) {
            switch (lastEvent.action) {
                case 'answered':
                    outcome = 'answered';
                    break;
                case 'voicemail':
                    outcome = 'voicemail';
                    tags.push('voicemail');
                    break;
                case 'extension':
                    outcome = 'extension_answered';
                    tags.push('extension');
                    break;
                case 'dept':
                    outcome = 'dept_answered';
                    tags.push('department');
                    break;
                case 'ai':
                    outcome = 'ai_handled';
                    tags.push('ai');
                    break;
                case 'hangup':
                    outcome = 'caller_hung_up';
                    break;
                default:
                    outcome = 'unknown';
            }
        }

        // Calculate metrics
        const totalSteps = path.length;
        const aiSteps = path.filter(step => step.action.includes('ai')).length;
        const apiCalls = path.filter(step => step.action.includes('api')).length;

        // Calculate duration
        const startTime = new Date(callSession.started_at);
        const endTime = new Date();
        const durationSeconds = Math.round((endTime - startTime) / 1000);

        // Update call session
        const { error: updateError } = await supabase
            .from('call_sessions')
            .update({
                status: 'completed',
                ended_at: endTime.toISOString(),
                outcome: outcome,
                duration_seconds: durationSeconds,
                tags: JSON.stringify(tags),
                cdr: JSON.stringify(cdr || {}),
                total_steps: totalSteps,
                ai_steps: aiSteps,
                api_calls: apiCalls,
                path: JSON.stringify(path)
            })
            .eq('call_id', callId);

        if (updateError) {
            logger.error('Error updating call session:', updateError);
        }

        res.json({
            success: true,
            message: 'Call logged successfully',
            data: {
                callId,
                outcome,
                duration: durationSeconds,
                tags,
                totalSteps,
                aiSteps,
                apiCalls
            }
        });

    } catch (error) {
        logger.error('IVR Log error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred logging the call'
        });
    }
});

module.exports = router; 