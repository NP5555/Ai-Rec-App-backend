const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../database/connection');
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
        await query(`
      INSERT INTO call_sessions (id, tenant_id, call_id, from_number, to_number, did, started_at, status, path)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'active', $7)
    `, [tenantId, callId, from, to, did, ts || new Date().toISOString(), JSON.stringify([{
            nodeId: 'entry',
            action: 'call_received',
            at: new Date().toISOString(),
            data: { did, from, to }
        }])]);

        // Get IVR flow configuration
        const flowResult = await query(`
      SELECT flow_config FROM ivr_flows 
      WHERE tenant_id = $1 AND is_active = true 
      ORDER BY created_at DESC LIMIT 1
    `, [tenantId]);

        if (flowResult.rows.length === 0) {
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

        const flowConfig = flowResult.rows[0].flow_config;

        // Log the entry step
        await query(`
      UPDATE call_sessions 
      SET path = jsonb_array_append(path, $1)
      WHERE call_id = $2
    `, [JSON.stringify({
            nodeId: 'ivr_entry',
            action: 'ivr_greeting',
            at: new Date().toISOString(),
            data: { flow: flowConfig.name }
        }), callId]);

        res.json({
            success: true,
            callId,
            action: 'gather',
            params: {
                greeting: flowConfig.greeting,
                timeout: flowConfig.timeout,
                max_digits: flowConfig.max_digits,
                retries: flowConfig.retries,
                options: flowConfig.options
            }
        });

    } catch (error) {
        logger.error('IVR Entry error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error',
            message: 'An error occurred processing the call entry'
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
        await query(`
      UPDATE call_sessions 
      SET path = jsonb_array_append(path, $1)
      WHERE call_id = $2
    `, [JSON.stringify({
            nodeId: 'ivr_event',
            action: event,
            at: new Date().toISOString(),
            data: data || {}
        }), callId]);

        let action = 'hangup';
        let params = { reason: 'call_ended' };

        switch (event) {
            case 'dtmf_menu':
                // Handle DTMF menu selection
                const digit = data?.digit;
                if (digit) {
                    const flowResult = await query(`
            SELECT flow_config FROM ivr_flows 
            WHERE tenant_id = $1 AND is_active = true 
            ORDER BY created_at DESC LIMIT 1
          `, [tenantId]);

                    if (flowResult.rows.length > 0) {
                        const flowConfig = flowResult.rows[0].flow_config;
                        const option = flowConfig.options[digit];

                        if (option) {
                            action = option.action;
                            params = option.params;
                        } else {
                            // Handle extension dialing
                            const extensionResult = await query(`
                SELECT e.*, d.name as department_name 
                FROM extensions e 
                LEFT JOIN departments d ON e.department_id = d.id
                WHERE e.tenant_id = $1 AND e.extension_number = $2 AND e.status = 'active'
              `, [tenantId, digit]);

                            if (extensionResult.rows.length > 0) {
                                const extension = extensionResult.rows[0];
                                action = 'extension';
                                params = {
                                    extension: extension.extension_number,
                                    name: extension.name,
                                    dialPlan: extension.dial_plan
                                };
                            } else {
                                action = 'ai';
                                params = { prompt: 'I didn\'t recognize that option. How can I help you?' };
                            }
                        }
                    }
                }
                break;

            case 'extension_dial':
                // Handle extension dialing
                const extensionNumber = data?.extension;
                if (extensionNumber) {
                    const extensionResult = await query(`
            SELECT e.*, d.name as department_name 
            FROM extensions e 
            LEFT JOIN departments d ON e.department_id = d.id
            WHERE e.tenant_id = $1 AND e.extension_number = $2 AND e.status = 'active'
          `, [tenantId, extensionNumber]);

                    if (extensionResult.rows.length > 0) {
                        const extension = extensionResult.rows[0];
                        action = 'extension';
                        params = {
                            extension: extension.extension_number,
                            name: extension.name,
                            dialPlan: extension.dial_plan
                        };
                    } else {
                        action = 'ai';
                        params = { prompt: 'Extension not found. How can I help you?' };
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
                    const deptResult = await query(`
            SELECT d.*, 
                   json_agg(e.*) as extensions
            FROM departments d
            LEFT JOIN extensions e ON d.id = e.department_id AND e.status = 'active'
            WHERE d.tenant_id = $1 AND d.name = $2
            GROUP BY d.id
          `, [tenantId, departmentName]);

                    if (deptResult.rows.length > 0) {
                        const department = deptResult.rows[0];
                        action = 'dept';
                        params = {
                            department: department.name,
                            greeting: department.settings?.greeting || `Connecting you to ${department.name}`,
                            extensions: department.extensions || []
                        };
                    } else {
                        action = 'voicemail';
                        params = { message: 'Department not available. Please leave a message.' };
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
        const callResult = await query(`
      SELECT * FROM call_sessions WHERE call_id = $1 AND tenant_id = $2
    `, [callId, tenantId]);

        if (callResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Call not found',
                message: 'Call session not found'
            });
        }

        const callSession = callResult.rows[0];
        const path = callSession.path || [];

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
        await query(`
      UPDATE call_sessions 
      SET 
        status = 'completed',
        ended_at = $1,
        outcome = $2,
        duration_seconds = $3,
        tags = $4,
        cdr = $5,
        total_steps = $6,
        ai_steps = $7,
        api_calls = $8,
        path = $9
      WHERE call_id = $10
    `, [
            endTime.toISOString(),
            outcome,
            durationSeconds,
            JSON.stringify(tags),
            JSON.stringify(cdr || {}),
            totalSteps,
            aiSteps,
            apiCalls,
            JSON.stringify(path),
            callId
        ]);

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