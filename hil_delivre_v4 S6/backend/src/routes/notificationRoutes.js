/**
 * @file notificationRoutes.js
 * @description Routes API pour les notifications et device tokens (Sprint 6).
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const notificationController = require('../controllers/notificationController');
const {
  getNotificationsSchema,
  markReadSchema,
  updatePreferencesSchema,
  registerDeviceSchema,
  unregisterDeviceSchema,
  broadcastSchema
} = require('../middlewares/validationSprint6');

const router = express.Router();

// ============================================================================
// RATE LIMITERS
// ============================================================================

const notificationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, error: 'Too many requests', code: 429 },
  standardHeaders: true,
  legacyHeaders: false
});

const broadcastRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10,
  message: { success: false, error: 'Broadcast rate limit exceeded', code: 429 },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// ROUTES — NOTIFICATIONS
// ============================================================================

/**
 * GET /api/notifications
 * Récupère les notifications de l'utilisateur (paginées).
 */
router.get(
  '/',
  authenticate,
  notificationRateLimit,
  validate(getNotificationsSchema, 'query'),
  notificationController.getNotifications
);

/**
 * PUT /api/notifications/read
 * Marque des notifications comme lues.
 */
router.put(
  '/read',
  authenticate,
  validate(markReadSchema, 'body'),
  notificationController.markNotificationsRead
);

// ============================================================================
// ROUTES — PRÉFÉRENCES
// ============================================================================

/**
 * GET /api/notifications/preferences
 * Récupère les préférences de notification.
 */
router.get(
  '/preferences',
  authenticate,
  notificationController.getPreferences
);

/**
 * PUT /api/notifications/preferences
 * Met à jour les préférences de notification.
 */
router.put(
  '/preferences',
  authenticate,
  validate(updatePreferencesSchema, 'body'),
  notificationController.updatePreferences
);

// ============================================================================
// ROUTES — DEVICE TOKENS
// ============================================================================

/**
 * POST /api/notifications/device
 * Enregistre un token FCM.
 */
router.post(
  '/device',
  authenticate,
  validate(registerDeviceSchema, 'body'),
  notificationController.registerDevice
);

/**
 * DELETE /api/notifications/device
 * Supprime un token FCM.
 */
router.delete(
  '/device',
  authenticate,
  validate(unregisterDeviceSchema, 'body'),
  notificationController.unregisterDevice
);

// ============================================================================
// ROUTES — ADMIN BROADCAST
// ============================================================================

/**
 * POST /api/notifications/broadcast
 * Envoie une notification à tous les utilisateurs d'un rôle.
 * Admin uniquement.
 */
router.post(
  '/broadcast',
  authenticate,
  requireRole('admin'),
  broadcastRateLimit,
  validate(broadcastSchema, 'body'),
  notificationController.broadcastNotification
);

module.exports = router;
