/**
 * @file deliveryRoutes.js
 * @description Routes API pour la livraison (Sprint 5).
 * Inclut l'estimation des frais, l'assignation, le tracking et la géolocalisation.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const deliveryController = require('../controllers/deliveryController');
const {
  deliveryEstimateSchema,
  assignDelivererSchema,
  assignmentIdParamSchema,
  rejectAssignmentSchema,
  updateLocationSchema,
  updateAvailabilitySchema,
  trackingEventSchema,
  orderIdParamSchema
} = require('../middlewares/validationSprint5');

const router = express.Router();

// ============================================================================
// RATE LIMITERS
// ============================================================================

/**
 * Rate limiter pour les mises à jour de position (haute fréquence).
 * Limite : 120 requêtes par minute (1 toutes les 500ms max).
 */
const locationUpdateRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, error: 'Location update rate limit exceeded', code: 429 },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `loc-${req.user?.id || req.ip}`
});

/**
 * Rate limiter pour les estimations (requêtes fréquentes côté client).
 * Limite : 30 requêtes par minute.
 */
const estimateRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many estimation requests', code: 429 },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter pour les actions d'assignation.
 * Limite : 20 requêtes par minute.
 */
const assignmentRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { success: false, error: 'Assignment rate limit exceeded', code: 429 },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// ROUTES — ESTIMATION & FRAIS (Client)
// ============================================================================

/**
 * POST /api/delivery/estimate
 * Estime les frais de livraison (sans surge, pour affichage).
 * Auth : JWT requis, rôle client.
 */
router.post(
  '/estimate',
  authenticate,
  requireRole('client'),
  estimateRateLimit,
  validate(deliveryEstimateSchema, 'body'),
  deliveryController.estimateDeliveryFee
);

/**
 * POST /api/delivery/calculate
 * Calcule les frais définitifs (avec surge).
 * Auth : JWT requis, rôle client.
 */
router.post(
  '/calculate',
  authenticate,
  requireRole('client'),
  estimateRateLimit,
  validate(deliveryEstimateSchema, 'body'),
  deliveryController.calculateDeliveryFee
);

/**
 * GET /api/delivery/surge
 * Récupère le statut actuel du surge pricing.
 * Auth : JWT requis (tous rôles).
 */
router.get(
  '/surge',
  authenticate,
  deliveryController.getSurgeStatus
);

// ============================================================================
// ROUTES — ASSIGNATION (Livreur + Admin)
// ============================================================================

/**
 * POST /api/delivery/assign
 * Initie l'assignation d'un livreur (appelé par le système ou l'admin).
 * Auth : JWT requis, rôle admin ou marchand.
 */
router.post(
  '/assign',
  authenticate,
  requireRole('admin', 'merchant'),
  assignmentRateLimit,
  validate(assignDelivererSchema, 'body'),
  deliveryController.assignDeliverer
);

/**
 * GET /api/delivery/assignments/active
 * Récupère les assignations actives du livreur connecté.
 * Auth : JWT requis, rôle deliverer.
 */
router.get(
  '/assignments/active',
  authenticate,
  requireRole('deliverer'),
  deliveryController.getActiveAssignments
);

/**
 * POST /api/delivery/assignments/:assignmentId/accept
 * Le livreur accepte une assignation.
 * Auth : JWT requis, rôle deliverer.
 */
router.post(
  '/assignments/:assignmentId/accept',
  authenticate,
  requireRole('deliverer'),
  assignmentRateLimit,
  validate(assignmentIdParamSchema, 'params'),
  deliveryController.acceptAssignment
);

/**
 * POST /api/delivery/assignments/:assignmentId/reject
 * Le livreur rejette une assignation.
 * Auth : JWT requis, rôle deliverer.
 */
router.post(
  '/assignments/:assignmentId/reject',
  authenticate,
  requireRole('deliverer'),
  assignmentRateLimit,
  validate(assignmentIdParamSchema, 'params'),
  validate(rejectAssignmentSchema, 'body'),
  deliveryController.rejectAssignment
);

// ============================================================================
// ROUTES — GÉOLOCALISATION (Livreur)
// ============================================================================

/**
 * PUT /api/delivery/location
 * Met à jour la position GPS du livreur.
 * Auth : JWT requis, rôle deliverer.
 */
router.put(
  '/location',
  authenticate,
  requireRole('deliverer'),
  locationUpdateRateLimit,
  validate(updateLocationSchema, 'body'),
  deliveryController.updateLocation
);

/**
 * PUT /api/delivery/availability
 * Met à jour la disponibilité du livreur (online/busy/offline).
 * Auth : JWT requis, rôle deliverer.
 */
router.put(
  '/availability',
  authenticate,
  requireRole('deliverer'),
  validate(updateAvailabilitySchema, 'body'),
  deliveryController.updateAvailability
);

// ============================================================================
// ROUTES — TRACKING (Toutes parties)
// ============================================================================

/**
 * POST /api/delivery/tracking/event
 * Enregistre un événement de tracking.
 * Auth : JWT requis, rôle deliverer.
 */
router.post(
  '/tracking/event',
  authenticate,
  requireRole('deliverer'),
  validate(trackingEventSchema, 'body'),
  deliveryController.recordTrackingEvent
);

/**
 * GET /api/delivery/tracking/:orderId
 * Récupère l'historique de tracking d'une commande.
 * Auth : JWT requis (client, marchand, livreur de la commande ou admin).
 */
router.get(
  '/tracking/:orderId',
  authenticate,
  validate(orderIdParamSchema, 'params'),
  deliveryController.getTrackingHistory
);

/**
 * GET /api/delivery/position/:orderId
 * Récupère la position actuelle du livreur d'une commande.
 * Auth : JWT requis (client ou marchand de la commande).
 */
router.get(
  '/position/:orderId',
  authenticate,
  validate(orderIdParamSchema, 'params'),
  deliveryController.getDelivererPosition
);

module.exports = router;
