/**
 * @file validationSprint5.js
 * @description Schémas de validation Joi pour les endpoints du Sprint 5 (Livraison).
 */

'use strict';

const Joi = require('joi');

// ============================================================================
// CONSTANTES
// ============================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRACKING_EVENT_TYPES = [
  'location_update',
  'pickup_started',
  'arrived_at_merchant',
  'order_picked_up',
  'delivery_started',
  'arrived_at_client',
  'order_delivered',
  'delivery_issue'
];

const AVAILABILITY_STATUSES = ['online', 'busy', 'offline'];

// ============================================================================
// SCHÉMAS — ESTIMATION & CALCUL
// ============================================================================

/**
 * Validation pour l'estimation/calcul des frais de livraison.
 * POST /api/delivery/estimate et POST /api/delivery/calculate
 */
const deliveryEstimateSchema = Joi.object({
  merchant_latitude: Joi.number()
    .min(-90).max(90)
    .required()
    .messages({ 'any.required': 'merchant_latitude is required' }),

  merchant_longitude: Joi.number()
    .min(-180).max(180)
    .required()
    .messages({ 'any.required': 'merchant_longitude is required' }),

  delivery_latitude: Joi.number()
    .min(-90).max(90)
    .required()
    .messages({ 'any.required': 'delivery_latitude is required' }),

  delivery_longitude: Joi.number()
    .min(-180).max(180)
    .required()
    .messages({ 'any.required': 'delivery_longitude is required' })
}).options({ stripUnknown: true });

// ============================================================================
// SCHÉMAS — ASSIGNATION
// ============================================================================

/**
 * Validation pour l'assignation d'un livreur.
 * POST /api/delivery/assign
 */
const assignDelivererSchema = Joi.object({
  order_id: Joi.string()
    .pattern(UUID_PATTERN)
    .required()
    .messages({ 'any.required': 'order_id is required' }),

  merchant_latitude: Joi.number()
    .min(-90).max(90)
    .required(),

  merchant_longitude: Joi.number()
    .min(-180).max(180)
    .required()
}).options({ stripUnknown: true });

/**
 * Validation pour le paramètre assignmentId.
 */
const assignmentIdParamSchema = Joi.object({
  assignmentId: Joi.string()
    .pattern(UUID_PATTERN)
    .required()
    .messages({ 'string.pattern.base': 'assignmentId must be a valid UUID' })
}).options({ stripUnknown: true });

/**
 * Validation pour le rejet d'une assignation.
 * POST /api/delivery/assignments/:id/reject
 */
const rejectAssignmentSchema = Joi.object({
  reason: Joi.string()
    .max(500)
    .optional()
    .allow(null, '')
}).options({ stripUnknown: true });

// ============================================================================
// SCHÉMAS — GÉOLOCALISATION
// ============================================================================

/**
 * Validation pour la mise à jour de position.
 * PUT /api/delivery/location
 */
const updateLocationSchema = Joi.object({
  latitude: Joi.number()
    .min(-90).max(90)
    .required()
    .messages({ 'any.required': 'latitude is required' }),

  longitude: Joi.number()
    .min(-180).max(180)
    .required()
    .messages({ 'any.required': 'longitude is required' }),

  heading: Joi.number()
    .min(0).max(360)
    .optional()
    .allow(null),

  speed: Joi.number()
    .min(0).max(200)
    .optional()
    .allow(null),

  accuracy: Joi.number()
    .min(0).max(1000)
    .optional()
    .allow(null)
}).options({ stripUnknown: true });

/**
 * Validation pour la mise à jour de disponibilité.
 * PUT /api/delivery/availability
 */
const updateAvailabilitySchema = Joi.object({
  availability: Joi.string()
    .valid(...AVAILABILITY_STATUSES)
    .required()
    .messages({
      'any.only': `availability must be one of: ${AVAILABILITY_STATUSES.join(', ')}`,
      'any.required': 'availability is required'
    })
}).options({ stripUnknown: true });

// ============================================================================
// SCHÉMAS — TRACKING
// ============================================================================

/**
 * Validation pour l'enregistrement d'un événement de tracking.
 * POST /api/delivery/tracking/event
 */
const trackingEventSchema = Joi.object({
  order_id: Joi.string()
    .pattern(UUID_PATTERN)
    .required()
    .messages({ 'any.required': 'order_id is required' }),

  event_type: Joi.string()
    .valid(...TRACKING_EVENT_TYPES)
    .required()
    .messages({
      'any.only': `event_type must be one of: ${TRACKING_EVENT_TYPES.join(', ')}`,
      'any.required': 'event_type is required'
    }),

  latitude: Joi.number()
    .min(-90).max(90)
    .optional()
    .allow(null),

  longitude: Joi.number()
    .min(-180).max(180)
    .optional()
    .allow(null),

  metadata: Joi.object()
    .optional()
    .default({})
}).options({ stripUnknown: true });

/**
 * Validation pour le paramètre orderId.
 */
const orderIdParamSchema = Joi.object({
  orderId: Joi.string()
    .pattern(UUID_PATTERN)
    .required()
    .messages({ 'string.pattern.base': 'orderId must be a valid UUID' })
}).options({ stripUnknown: true });

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  deliveryEstimateSchema,
  assignDelivererSchema,
  assignmentIdParamSchema,
  rejectAssignmentSchema,
  updateLocationSchema,
  updateAvailabilitySchema,
  trackingEventSchema,
  orderIdParamSchema,
  TRACKING_EVENT_TYPES,
  AVAILABILITY_STATUSES
};
