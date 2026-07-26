/**
 * @file validationSprint6.js
 * @description Schémas de validation Joi pour les endpoints du Sprint 6 (Notifications & OTP).
 */

'use strict';

const Joi = require('joi');

// ============================================================================
// CONSTANTES
// ============================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOTIFICATION_TYPES = [
  'order_created', 'order_accepted', 'order_ready', 'order_picked_up',
  'order_in_delivery', 'order_delivered', 'order_cancelled',
  'delivery_proposed', 'delivery_accepted', 'delivery_rejected',
  'payment_received', 'payment_failed',
  'kyc_approved', 'kyc_rejected',
  'system_alert', 'promotion'
];

const OTP_PURPOSES = [
  'phone_verification', 'login_2fa', 'password_reset', 'delivery_confirmation'
];

const PLATFORMS = ['ios', 'android', 'web'];

// ============================================================================
// SCHÉMAS — NOTIFICATIONS
// ============================================================================

/**
 * Validation pour la récupération des notifications (query params).
 */
const getNotificationsSchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20),
  unread_only: Joi.string().valid('true', 'false').default('false')
}).options({ stripUnknown: true });

/**
 * Validation pour marquer des notifications comme lues.
 */
const markReadSchema = Joi.object({
  notification_ids: Joi.array()
    .items(Joi.string().pattern(UUID_PATTERN))
    .max(100)
    .optional()
    .allow(null)
}).options({ stripUnknown: true });

/**
 * Validation pour la mise à jour des préférences.
 */
const updatePreferencesSchema = Joi.object({
  notification_type: Joi.string()
    .valid(...NOTIFICATION_TYPES)
    .required()
    .messages({ 'any.required': 'notification_type is required' }),
  push_enabled: Joi.boolean().optional(),
  sms_enabled: Joi.boolean().optional(),
  in_app_enabled: Joi.boolean().optional()
}).options({ stripUnknown: true });

// ============================================================================
// SCHÉMAS — DEVICE TOKENS
// ============================================================================

/**
 * Validation pour l'enregistrement d'un device token.
 */
const registerDeviceSchema = Joi.object({
  token: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({ 'any.required': 'FCM token is required' }),
  platform: Joi.string()
    .valid(...PLATFORMS)
    .required()
    .messages({
      'any.only': `platform must be one of: ${PLATFORMS.join(', ')}`,
      'any.required': 'platform is required'
    }),
  device_name: Joi.string()
    .max(100)
    .optional()
    .allow(null, '')
}).options({ stripUnknown: true });

/**
 * Validation pour la suppression d'un device token.
 */
const unregisterDeviceSchema = Joi.object({
  token: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({ 'any.required': 'FCM token is required' })
}).options({ stripUnknown: true });

// ============================================================================
// SCHÉMAS — OTP
// ============================================================================

/**
 * Validation pour l'envoi d'un OTP.
 */
const sendOTPSchema = Joi.object({
  phone_number: Joi.string()
    .pattern(/^(\+?226)?[0-9]{8,10}$/)
    .required()
    .messages({
      'string.pattern.base': 'Phone number must be a valid Burkina Faso number (+226XXXXXXXX)',
      'any.required': 'phone_number is required'
    }),
  purpose: Joi.string()
    .valid(...OTP_PURPOSES)
    .required()
    .messages({
      'any.only': `purpose must be one of: ${OTP_PURPOSES.join(', ')}`,
      'any.required': 'purpose is required'
    })
}).options({ stripUnknown: true });

/**
 * Validation pour la vérification d'un OTP.
 */
const verifyOTPSchema = Joi.object({
  phone_number: Joi.string()
    .pattern(/^(\+?226)?[0-9]{8,10}$/)
    .required()
    .messages({
      'string.pattern.base': 'Phone number must be a valid Burkina Faso number',
      'any.required': 'phone_number is required'
    }),
  code: Joi.string()
    .length(6)
    .pattern(/^[0-9]+$/)
    .required()
    .messages({
      'string.length': 'OTP code must be exactly 6 digits',
      'string.pattern.base': 'OTP code must contain only digits',
      'any.required': 'code is required'
    }),
  purpose: Joi.string()
    .valid(...OTP_PURPOSES)
    .required()
    .messages({ 'any.required': 'purpose is required' })
}).options({ stripUnknown: true });

// ============================================================================
// SCHÉMAS — ADMIN BROADCAST
// ============================================================================

/**
 * Validation pour le broadcast admin.
 */
const broadcastSchema = Joi.object({
  role: Joi.string()
    .valid('client', 'merchant', 'deliverer')
    .required()
    .messages({ 'any.required': 'role is required' }),
  title: Joi.string()
    .min(1)
    .max(100)
    .required()
    .messages({ 'any.required': 'title is required' }),
  message: Joi.string()
    .min(1)
    .max(500)
    .required()
    .messages({ 'any.required': 'message is required' }),
  type: Joi.string()
    .valid('system_alert', 'promotion')
    .default('system_alert')
}).options({ stripUnknown: true });

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  getNotificationsSchema,
  markReadSchema,
  updatePreferencesSchema,
  registerDeviceSchema,
  unregisterDeviceSchema,
  sendOTPSchema,
  verifyOTPSchema,
  broadcastSchema,
  NOTIFICATION_TYPES,
  OTP_PURPOSES,
  PLATFORMS
};
