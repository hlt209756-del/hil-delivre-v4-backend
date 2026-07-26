/**
 * @file validationSprint4.js
 * @description Schémas de validation Joi pour les endpoints du Sprint 4 (Paiements, FEC).
 * Tous les schémas utilisent stripUnknown: true pour rejeter les champs non déclarés.
 */

'use strict';

const Joi = require('joi');

// ============================================================================
// CONSTANTES DE VALIDATION
// ============================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;
const PAYMENT_METHODS = ['mobile_money', 'cash'];

// ============================================================================
// SCHÉMAS
// ============================================================================

/**
 * Schéma de validation pour l'initiation d'un paiement.
 * POST /api/payments/initiate
 */
const initiatePaymentSchema = Joi.object({
  order_id: Joi.string()
    .pattern(UUID_PATTERN)
    .required()
    .messages({
      'string.pattern.base': 'order_id must be a valid UUID',
      'any.required': 'order_id is required'
    }),

  payment_method: Joi.string()
    .valid(...PAYMENT_METHODS)
    .required()
    .messages({
      'any.only': `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}`,
      'any.required': 'payment_method is required'
    }),

  phone_number: Joi.string()
    .pattern(PHONE_PATTERN)
    .when('payment_method', {
      is: 'mobile_money',
      then: Joi.string().required().messages({
        'any.required': 'phone_number is required for mobile_money payments'
      }),
      otherwise: Joi.string().optional().allow(null, '')
    })
    .messages({
      'string.pattern.base': 'phone_number must be a valid phone number (8-15 digits, optional + prefix)'
    })
}).options({ stripUnknown: true });

/**
 * Schéma de validation pour le webhook PayDunya.
 * POST /api/payments/webhook
 * Note : Le webhook PayDunya envoie un payload variable, on valide les champs essentiels.
 */
const webhookPayDunyaSchema = Joi.object({
  // PayDunya peut envoyer les données dans différentes structures
  data: Joi.object({
    status: Joi.string().optional(),
    token: Joi.string().optional(),
    custom_data: Joi.object({
      order_id: Joi.string().optional(),
      transaction_id: Joi.string().optional(),
      idempotency_key: Joi.string().optional()
    }).optional().unknown(true),
    fail_reason: Joi.string().optional().allow(null, '')
  }).optional().unknown(true),

  // Champs alternatifs au niveau racine (certaines versions de l'API)
  status: Joi.string().optional(),
  token: Joi.string().optional(),
  custom_data: Joi.object().optional().unknown(true),
  response_code: Joi.string().optional(),
  response_text: Joi.string().optional()
}).options({ stripUnknown: false }); // Ne pas strip les champs inconnus du webhook

/**
 * Schéma de validation pour les paramètres orderId.
 * GET /api/payments/:orderId/status
 * GET /api/orders/:orderId/invoice
 */
const orderIdParamSchema = Joi.object({
  orderId: Joi.string()
    .pattern(UUID_PATTERN)
    .required()
    .messages({
      'string.pattern.base': 'orderId must be a valid UUID',
      'any.required': 'orderId is required'
    })
}).options({ stripUnknown: true });

/**
 * Schéma de validation pour la mise à jour de la configuration plateforme.
 * PUT /api/admin/config/:key
 */
const updateConfigSchema = Joi.object({
  value: Joi.number()
    .required()
    .min(0)
    .messages({
      'number.base': 'value must be a number',
      'number.min': 'value must be non-negative',
      'any.required': 'value is required'
    })
}).options({ stripUnknown: true });

/**
 * Schéma de validation pour le paramètre key de configuration.
 */
const configKeyParamSchema = Joi.object({
  key: Joi.string()
    .required()
    .max(100)
    .pattern(/^[a-z_]+$/)
    .messages({
      'string.pattern.base': 'key must contain only lowercase letters and underscores',
      'any.required': 'key is required'
    })
}).options({ stripUnknown: true });

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  initiatePaymentSchema,
  webhookPayDunyaSchema,
  orderIdParamSchema,
  updateConfigSchema,
  configKeyParamSchema,
  PAYMENT_METHODS
};
