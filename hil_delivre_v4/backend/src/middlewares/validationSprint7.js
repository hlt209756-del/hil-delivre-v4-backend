/**
 * @file validationSprint7.js
 * @description Schémas de validation Joi pour les endpoints admin (Sprint 7).
 */

'use strict';

const Joi = require('joi');

// ============================================================================
// SCHÉMAS — GESTION UTILISATEURS
// ============================================================================

const suspendUserSchema = Joi.object({
  reason: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'La raison doit contenir au moins 10 caractères',
      'any.required': 'La raison de suspension est obligatoire'
    })
});

const deleteUserSchema = Joi.object({
  reason: Joi.string()
    .min(10)
    .max(500)
    .required()
    .messages({
      'string.min': 'La raison doit contenir au moins 10 caractères',
      'any.required': 'La raison de suppression est obligatoire'
    })
});

// ============================================================================
// SCHÉMAS — RÉCONCILIATION
// ============================================================================

const generateReconciliationSchema = Joi.object({
  deliverer_id: Joi.string()
    .uuid()
    .required()
    .messages({
      'string.guid': 'deliverer_id doit être un UUID valide',
      'any.required': 'deliverer_id est obligatoire'
    }),
  period_start: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': 'period_start doit être une date ISO valide',
      'any.required': 'period_start est obligatoire'
    }),
  period_end: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': 'period_end doit être une date ISO valide',
      'any.required': 'period_end est obligatoire'
    })
}).custom((value, helpers) => {
  if (new Date(value.period_end) <= new Date(value.period_start)) {
    return helpers.error('any.custom', { message: 'period_end doit être après period_start' });
  }
  return value;
});

const disputeSchema = Joi.object({
  reason: Joi.string()
    .min(10)
    .max(1000)
    .required()
    .messages({
      'string.min': 'La raison doit contenir au moins 10 caractères',
      'any.required': 'La raison de contestation est obligatoire'
    })
});

// ============================================================================
// SCHÉMAS — PAYOUTS
// ============================================================================

const generatePayoutSchema = Joi.object({
  merchant_id: Joi.string()
    .uuid()
    .required()
    .messages({
      'string.guid': 'merchant_id doit être un UUID valide',
      'any.required': 'merchant_id est obligatoire'
    }),
  period_start: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': 'period_start doit être une date ISO valide',
      'any.required': 'period_start est obligatoire'
    }),
  period_end: Joi.string()
    .isoDate()
    .required()
    .messages({
      'string.isoDate': 'period_end doit être une date ISO valide',
      'any.required': 'period_end est obligatoire'
    })
}).custom((value, helpers) => {
  if (new Date(value.period_end) <= new Date(value.period_start)) {
    return helpers.error('any.custom', { message: 'period_end doit être après period_start' });
  }
  return value;
});

const approvePayoutSchema = Joi.object({
  payment_reference: Joi.string()
    .min(3)
    .max(100)
    .required()
    .messages({
      'string.min': 'La référence de paiement doit contenir au moins 3 caractères',
      'any.required': 'La référence de paiement est obligatoire'
    })
});

// ============================================================================
// SCHÉMAS — STATS
// ============================================================================

const statsQuerySchema = Joi.object({
  start_date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({
      'string.pattern.base': 'start_date doit être au format YYYY-MM-DD'
    }),
  end_date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({
      'string.pattern.base': 'end_date doit être au format YYYY-MM-DD'
    })
}).custom((value, helpers) => {
  if (value.start_date && value.end_date) {
    if (new Date(value.end_date) < new Date(value.start_date)) {
      return helpers.error('any.custom', { message: 'end_date doit être après start_date' });
    }
    // Max 365 jours
    const diff = (new Date(value.end_date) - new Date(value.start_date)) / (1000 * 60 * 60 * 24);
    if (diff > 365) {
      return helpers.error('any.custom', { message: 'La période ne peut pas dépasser 365 jours' });
    }
  }
  return value;
});

const calculateStatsSchema = Joi.object({
  date: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .messages({
      'string.pattern.base': 'date doit être au format YYYY-MM-DD'
    })
});

module.exports = {
  suspendUserSchema,
  deleteUserSchema,
  generateReconciliationSchema,
  disputeSchema,
  generatePayoutSchema,
  approvePayoutSchema,
  statsQuerySchema,
  calculateStatsSchema
};
