'use strict';

/**
 * @fileoverview Schémas de validation Joi pour le Sprint 10 de Hil_Delivre v4.
 * Valide les entrées des endpoints de monitoring, exports et cache.
 * @module middlewares/validationSprint10
 */

const Joi = require('joi');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crée un middleware de validation Express à partir d'un schéma Joi.
 * @param {Joi.ObjectSchema} schema - Le schéma Joi à appliquer.
 * @param {'body'|'query'|'params'} source - La source des données à valider.
 * @returns {import('express').RequestHandler}
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        error: 'Données de requête invalides.',
        details,
      });
    }

    req[source] = value;
    next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Schémas
// ─────────────────────────────────────────────────────────────────────────────

/** Schéma de validation pour la création d'un export CSV */
const createExportSchema = Joi.object({
  export_type: Joi.string()
    .valid('orders', 'users', 'reconciliations', 'payouts', 'stats')
    .required()
    .messages({
      'any.only': 'Type d\'export invalide. Valeurs acceptées : orders, users, reconciliations, payouts, stats.',
      'any.required': 'Le champ export_type est requis.',
    }),
  filters: Joi.object({
    start_date: Joi.date().iso().optional(),
    end_date: Joi.date().iso().min(Joi.ref('start_date')).optional(),
    status: Joi.string().max(50).optional(),
    role: Joi.string().valid('client', 'merchant', 'delivery', 'admin').optional(),
    merchant_id: Joi.string().uuid().optional(),
    deliverer_id: Joi.string().uuid().optional(),
  }).optional().default({}),
});

/** Schéma de validation pour l'invalidation du cache */
const cacheInvalidationSchema = Joi.object({
  pattern: Joi.string()
    .min(2)
    .max(200)
    .pattern(/^[a-zA-Z0-9:_*-]+$/)
    .required()
    .messages({
      'string.pattern.base': 'Le pattern ne peut contenir que des caractères alphanumériques, :, _, *, -.',
      'any.required': 'Le champ pattern est requis.',
      'string.min': 'Le pattern doit faire au moins 2 caractères.',
      'string.max': 'Le pattern ne peut pas dépasser 200 caractères.',
    }),
  reason: Joi.string().max(500).optional(),
});

/** Schéma de validation pour le flush du cache */
const cacheFlushSchema = Joi.object({
  confirm: Joi.string()
    .valid('FLUSH_ALL_CACHE')
    .required()
    .messages({
      'any.only': 'Confirmation invalide. Envoyez "FLUSH_ALL_CACHE" pour confirmer.',
      'any.required': 'Le champ confirm est requis pour cette action critique.',
    }),
});

/** Schéma de validation pour les query params de la liste des exports */
const exportListQuerySchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'processing', 'completed', 'failed')
    .optional(),
  cursor: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(50).default(20),
});

/** Schéma de validation pour le paramètre jobId */
const jobIdParamSchema = Joi.object({
  jobId: Joi.string().uuid().required().messages({
    'string.guid': 'L\'identifiant du job doit être un UUID valide.',
    'any.required': 'L\'identifiant du job est requis.',
  }),
});

/** Schéma de validation pour le paramètre service */
const serviceParamSchema = Joi.object({
  service: Joi.string()
    .valid('postgresql', 'redis', 'osrm', 'socketio', 'disk', 'memory')
    .required()
    .messages({
      'any.only': 'Service invalide. Valeurs acceptées : postgresql, redis, osrm, socketio, disk, memory.',
      'any.required': 'Le nom du service est requis.',
    }),
});

/** Schéma de validation pour le viewport de la carte temps réel */
const viewportSchema = Joi.object({
  north: Joi.number().min(-90).max(90).required(),
  south: Joi.number().min(-90).max(90).required(),
  east: Joi.number().min(-180).max(180).required(),
  west: Joi.number().min(-180).max(180).required(),
}).custom((value, helpers) => {
  if (value.north <= value.south) {
    return helpers.error('any.invalid', { message: 'north doit être supérieur à south.' });
  }
  if (value.east <= value.west) {
    return helpers.error('any.invalid', { message: 'east doit être supérieur à west.' });
  }
  return value;
});

/** Schéma de validation pour la mise à jour de position (carte temps réel) */
const positionUpdateSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required().messages({
    'number.min': 'La latitude doit être comprise entre -90 et 90.',
    'number.max': 'La latitude doit être comprise entre -90 et 90.',
    'any.required': 'La latitude est requise.',
  }),
  longitude: Joi.number().min(-180).max(180).required().messages({
    'number.min': 'La longitude doit être comprise entre -180 et 180.',
    'number.max': 'La longitude doit être comprise entre -180 et 180.',
    'any.required': 'La longitude est requise.',
  }),
  heading: Joi.number().min(0).max(360).optional(),
  speed: Joi.number().min(0).max(200).optional(),
  accuracy: Joi.number().min(0).max(1000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Exports des middlewares
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  validateCreateExport: validate(createExportSchema, 'body'),
  validateCacheInvalidation: validate(cacheInvalidationSchema, 'body'),
  validateCacheFlush: validate(cacheFlushSchema, 'body'),
  validateExportListQuery: validate(exportListQuerySchema, 'query'),
  validateJobIdParam: validate(jobIdParamSchema, 'params'),
  validateServiceParam: validate(serviceParamSchema, 'params'),
  validateViewport: validate(viewportSchema, 'body'),
  validatePositionUpdate: validate(positionUpdateSchema, 'body'),
};
