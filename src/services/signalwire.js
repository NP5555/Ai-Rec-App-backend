const axios = require('axios');
const logger = require('../utils/logger');

// Import SignalWire SDK
const { RestClient } = require('@signalwire/compatibility-api');

class SignalWireService {
    constructor() {
        this.voiceApi = null;
        this.restClient = null;
        this.spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
        this.projectId = process.env.SIGNALWIRE_PROJECT_ID;
        this.token = process.env.SIGNALWIRE_TOKEN;
        
        this.initialize();
    }

    initialize() {
        try {
            if (!this.spaceUrl || !this.projectId || !this.token) {
                logger.warn('SignalWire credentials not fully configured. Some features may be limited.');
                return;
            }

            // Initialize SignalWire REST client
            this.restClient = new RestClient(this.projectId, this.token, {
                signalwireSpaceUrl: this.spaceUrl
            });

            // Initialize Voice API for IVR operations
            this.voiceApi = {
                spaceUrl: this.spaceUrl,
                projectId: this.projectId,
                token: this.token
            };

            logger.info('SignalWire service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize SignalWire service:', error);
        }
    }

    /**
     * Create an outbound call
     * @param {Object} params - Call parameters
     * @param {string} params.from - Caller ID
     * @param {string} params.to - Destination number
     * @param {string} params.tenantId - Tenant identifier
     * @param {Object} params.options - Additional options
     * @returns {Promise<Object>} Call result
     */
    async createOutboundCall(params) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const { from, to, tenantId, options = {} } = params;
            
            const callParams = {
                from: from,
                to: to,
                url: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/mcp/ivr/outbound`,
                statusCallback: `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/mcp/ivr/status`,
                statusCallbackMethod: 'POST',
                statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
                customParameters: {
                    tenantId: tenantId,
                    callType: 'outbound',
                    ...options
                }
            };

            logger.info('Creating outbound call', { from, to, tenantId });
            
            // Use SignalWire SDK to create the call
            const call = await this.restClient.calls.create(callParams);
            
            return {
                success: true,
                callSid: call.sid,
                status: call.status,
                direction: call.direction,
                from: call.from,
                to: call.to,
                startTime: call.startTime
            };
        } catch (error) {
            logger.error('Failed to create outbound call:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send SMS message
     * @param {Object} params - SMS parameters
     * @param {string} params.from - Sender number
     * @param {string} params.to - Recipient number
     * @param {string} params.body - Message body
     * @param {string} params.tenantId - Tenant identifier
     * @returns {Promise<Object>} SMS result
     */
    async sendSMS(params) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const { from, to, body, tenantId } = params;
            
            const message = await this.restClient.messages.create({
                from: from,
                to: to,
                body: body,
                customParameters: {
                    tenantId: tenantId
                }
            });

            logger.info('SMS sent successfully', { from, to, messageSid: message.sid });
            
            return {
                success: true,
                messageSid: message.sid,
                status: message.status,
                from: message.from,
                to: message.to,
                body: message.body,
                dateCreated: message.dateCreated
            };
        } catch (error) {
            logger.error('Failed to send SMS:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get call details
     * @param {string} callSid - Call SID
     * @returns {Promise<Object>} Call details
     */
    async getCallDetails(callSid) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const call = await this.restClient.calls(callSid).fetch();
            
            return {
                success: true,
                callSid: call.sid,
                status: call.status,
                direction: call.direction,
                from: call.from,
                to: call.to,
                startTime: call.startTime,
                endTime: call.endTime,
                duration: call.duration,
                price: call.price,
                priceUnit: call.priceUnit
            };
        } catch (error) {
            logger.error('Failed to get call details:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update call status
     * @param {string} callSid - Call SID
     * @param {string} status - New status
     * @returns {Promise<Object>} Update result
     */
    async updateCallStatus(callSid, status) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const call = await this.restClient.calls(callSid).update({ status });
            
            return {
                success: true,
                callSid: call.sid,
                status: call.status
            };
        } catch (error) {
            logger.error('Failed to update call status:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get call recordings
     * @param {string} callSid - Call SID
     * @returns {Promise<Object>} Recordings list
     */
    async getCallRecordings(callSid) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const recordings = await this.restClient.calls(callSid).recordings.list();
            
            return {
                success: true,
                recordings: recordings.map(recording => ({
                    recordingSid: recording.sid,
                    startTime: recording.startTime,
                    endTime: recording.endTime,
                    duration: recording.duration,
                    channels: recording.channels,
                    status: recording.status,
                    price: recording.price,
                    priceUnit: recording.priceUnit,
                    uri: recording.uri
                }))
            };
        } catch (error) {
            logger.error('Failed to get call recordings:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get phone numbers for a tenant
     * @param {string} tenantId - Tenant identifier
     * @returns {Promise<Object>} Phone numbers list
     */
    async getPhoneNumbers(tenantId) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const phoneNumbers = await this.restClient.incomingPhoneNumbers.list();
            
            // Filter by tenant if custom parameter is set
            const filteredNumbers = phoneNumbers.filter(number => 
                number.customParameters?.tenantId === tenantId
            );
            
            return {
                success: true,
                phoneNumbers: filteredNumbers.map(number => ({
                    phoneNumberSid: number.sid,
                    phoneNumber: number.phoneNumber,
                    friendlyName: number.friendlyName,
                    status: number.status,
                    capabilities: number.capabilities,
                    tenantId: number.customParameters?.tenantId
                }))
            };
        } catch (error) {
            logger.error('Failed to get phone numbers:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Create phone number
     * @param {Object} params - Phone number parameters
     * @param {string} params.phoneNumber - Phone number to purchase
     * @param {string} params.friendlyName - Friendly name
     * @param {string} params.tenantId - Tenant identifier
     * @param {Object} params.voiceUrl - Voice webhook URL
     * @param {Object} params.smsUrl - SMS webhook URL
     * @returns {Promise<Object>} Creation result
     */
    async createPhoneNumber(params) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const { phoneNumber, friendlyName, tenantId, voiceUrl, smsUrl } = params;
            
            const newNumber = await this.restClient.incomingPhoneNumbers.create({
                phoneNumber: phoneNumber,
                friendlyName: friendlyName,
                voiceUrl: voiceUrl,
                smsUrl: smsUrl,
                customParameters: {
                    tenantId: tenantId
                }
            });

            logger.info('Phone number created successfully', { 
                phoneNumber, 
                phoneNumberSid: newNumber.sid,
                tenantId 
            });
            
            return {
                success: true,
                phoneNumberSid: newNumber.sid,
                phoneNumber: newNumber.phoneNumber,
                friendlyName: newNumber.friendlyName,
                status: newNumber.status,
                tenantId: newNumber.customParameters?.tenantId
            };
        } catch (error) {
            logger.error('Failed to create phone number:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get call analytics for a tenant
     * @param {string} tenantId - Tenant identifier
     * @param {Object} filters - Date filters
     * @returns {Promise<Object>} Analytics data
     */
    async getCallAnalytics(tenantId, filters = {}) {
        try {
            if (!this.restClient) {
                throw new Error('SignalWire service not initialized');
            }

            const { startDate, endDate } = filters;
            const calls = await this.restClient.calls.list({
                startTime: startDate ? new Date(startDate) : undefined,
                endTime: endDate ? new Date(endDate) : undefined
            });

            // Filter by tenant and calculate analytics
            const tenantCalls = calls.filter(call => 
                call.customParameters?.tenantId === tenantId
            );

            const analytics = {
                totalCalls: tenantCalls.length,
                answeredCalls: tenantCalls.filter(call => call.status === 'completed').length,
                missedCalls: tenantCalls.filter(call => call.status === 'no-answer').length,
                failedCalls: tenantCalls.filter(call => call.status === 'failed').length,
                totalDuration: tenantCalls.reduce((sum, call) => sum + (call.duration || 0), 0),
                averageDuration: tenantCalls.length > 0 ? 
                    tenantCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / tenantCalls.length : 0,
                totalCost: tenantCalls.reduce((sum, call) => sum + (call.price || 0), 0)
            };

            return {
                success: true,
                tenantId,
                analytics,
                period: { startDate, endDate }
            };
        } catch (error) {
            logger.error('Failed to get call analytics:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Validate webhook signature
     * @param {string} signature - Webhook signature
     * @param {string} url - Webhook URL
     * @param {string} body - Request body
     * @returns {boolean} Signature validity
     */
    validateWebhookSignature(signature, url, body) {
        try {
            // This is a simplified validation - in production, implement proper signature validation
            // using the webhook secret from SignalWire
            const webhookSecret = process.env.SIGNALWIRE_WEBHOOK_SECRET;
            
            if (!webhookSecret) {
                logger.warn('Webhook secret not configured, skipping signature validation');
                return true;
            }

            // Implement proper HMAC validation here
            // For now, return true as placeholder
            return true;
        } catch (error) {
            logger.error('Webhook signature validation failed:', error);
            return false;
        }
    }

    /**
     * Check service health
     * @returns {Object} Health status
     */
    getHealthStatus() {
        return {
            service: 'SignalWire',
            status: this.voiceApi && this.restClient ? 'healthy' : 'unhealthy',
            initialized: !!(this.voiceApi && this.restClient),
            spaceUrl: this.spaceUrl ? 'configured' : 'missing',
            projectId: this.projectId ? 'configured' : 'missing',
            token: this.token ? 'configured' : 'missing'
        };
    }
}

// Create singleton instance
const signalwireService = new SignalWireService();

module.exports = signalwireService;
