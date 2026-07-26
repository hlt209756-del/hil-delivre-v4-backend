'use strict';

/**
 * @fileoverview Routes pour les endpoints de fidélisation.
 * @module routes/loyaltyRoutes
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const loyaltyController = require('../controllers/loyaltyController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const {
    validateRedeemPoints,
    validateLoyaltyHistoryQuery
} = require('../middlewares/validationSprint9');

// ============================================================================
// Rate Limiters
// ============================================================================

const loyaltyReadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: { success: false, message: 'Trop de requêtes. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

const loyaltyRedeemLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { success: false, message: 'Trop de conversions. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

const adminLoyaltyLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    message: { success: false, message: 'Trop de requêtes admin. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

// ============================================================================
// Routes client
// ============================================================================

/**
 * GET /api/loyalty/points
 * Récupère le solde de points du client connecté
 */
router.get(
    '/loyalty/points',
    authenticate,
    authorize(['client']),
    loyaltyReadLimiter,
    loyaltyController.getPoints
);

/**
 * GET /api/loyalty/history
 * Récupère l'historique des transactions de points
 */
router.get(
    '/loyalty/history',
    authenticate,
    authorize(['client']),
    loyaltyReadLimiter,
    validateLoyaltyHistoryQuery,
    loyaltyController.getHistory
);

/**
 * POST /api/loyalty/redeem
 * Convertit des points en crédit plateforme
 */
router.post(
    '/loyalty/redeem',
    authenticate,
    authorize(['client']),
    loyaltyRedeemLimiter,
    validateRedeemPoints,
    loyaltyController.redeemPoints
);

// ============================================================================
// Routes admin
// ============================================================================

/**
 * GET /api/admin/loyalty/stats
 * Statistiques du programme de fidélité
 */
router.get(
    '/admin/loyalty/stats',
    authenticate,
    authorize(['admin']),
    adminLoyaltyLimiter,
    loyaltyController.adminGetStats
);

/**
 * POST /api/admin/loyalty/expire
 * Déclenche manuellement l'expiration des points
 */
router.post(
    '/admin/loyalty/expire',
    authenticate,
    authorize(['admin']),
    adminLoyaltyLimiter,
    loyaltyController.adminExpirePoints
);

module.exports = router;
