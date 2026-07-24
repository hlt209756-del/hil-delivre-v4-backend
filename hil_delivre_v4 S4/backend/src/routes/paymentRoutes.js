/**
 * @file paymentRoutes.js
 * @description Routes API pour les paiements (Sprint 4).
 * Inclut l'initiation de paiement, le webhook PayDunya,
 * le statut de paiement et la récupération des factures FEC.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const paymentController = require('../controllers/paymentController');
const {
  initiatePaymentSchema,
  webhookPayDunyaSchema,
  orderIdParamSchema
} = require('../middlewares/validationSprint4');

const router = express.Router();

// ============================================================================
// RATE LIMITERS SPÉCIFIQUES AUX PAIEMENTS
// ============================================================================

/**
 * Rate limiter pour l'initiation de paiement.
 * Limite : 10 requêtes par 15 minutes par IP.
 * Protège contre les tentatives de spam de paiement.
 */
const paymentInitiateRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    success: false,
    error: 'Too many payment attempts. Please try again in 15 minutes.',
    code: 429
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Combiner IP + userId pour un rate limiting plus précis
    return `${req.ip}-${req.user?.id || 'anonymous'}`;
  }
});

/**
 * Rate limiter pour le webhook PayDunya.
 * Limite : 100 requêtes par minute (PayDunya peut envoyer des retries).
 */
const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { status: 'error', message: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Rate limiter pour la consultation du statut de paiement.
 * Limite : 30 requêtes par minute (polling côté mobile).
 */
const statusRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: {
    success: false,
    error: 'Too many status check requests. Please slow down.',
    code: 429
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/payments/initiate
 * Initie un paiement (Mobile Money ou Cash).
 * Auth : JWT requis, rôle client.
 */
router.post(
  '/initiate',
  authenticate,
  requireRole('client'),
  paymentInitiateRateLimit,
  validate(initiatePaymentSchema, 'body'),
  paymentController.initiatePayment
);

/**
 * POST /api/payments/webhook
 * Webhook PayDunya pour les notifications de paiement.
 * Auth : Aucune (public), sécurisé par signature HMAC.
 * Note : Le body est parsé en JSON mais on conserve le rawBody pour la vérification.
 */
router.post(
  '/webhook',
  webhookRateLimit,
  validate(webhookPayDunyaSchema, 'body'),
  paymentController.webhookPayDunya
);

/**
 * GET /api/payments/:orderId/status
 * Récupère le statut de paiement d'une commande.
 * Auth : JWT requis, accessible par les parties de la commande.
 */
router.get(
  '/:orderId/status',
  authenticate,
  statusRateLimit,
  validate(orderIdParamSchema, 'params'),
  paymentController.getPaymentStatus
);

/**
 * GET /api/orders/:orderId/invoice
 * Récupère la facture FEC d'une commande.
 * Auth : JWT requis, accessible par le client ou le marchand.
 * Note : Cette route est montée sur /api/orders dans app.js
 */
router.get(
  '/orders/:orderId/invoice',
  authenticate,
  validate(orderIdParamSchema, 'params'),
  paymentController.getInvoice
);

module.exports = router;
