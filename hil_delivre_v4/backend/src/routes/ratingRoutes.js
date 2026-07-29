'use strict';

/**
 * @fileoverview Routes pour les endpoints de notation.
 * @module routes/ratingRoutes
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const ratingController = require('../controllers/ratingController');
const { authenticate } = require('../middlewares/authMiddleware');
const roleMiddleware = require('../middlewares/roleMiddleware');
const {
    validateRatingParams,
    validateCreateRating,
    validateGetUserRatingsQuery,
    validateUserIdParams,
    validateCanRateQuery,
    validateModerateRating,
    validateRatingIdParams,
    validateAdminRatingsQuery
} = require('../middlewares/validationSprint9');

// ============================================================================
// Rate Limiters
// ============================================================================

const ratingCreateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { success: false, message: 'Trop de notations soumises. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

const ratingReadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: { success: false, message: 'Trop de requêtes. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

const adminRatingLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    message: { success: false, message: 'Trop de requêtes admin. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

// ============================================================================
// Routes publiques
// ============================================================================

/**
 * GET /api/users/:userId/ratings
 * Récupère les notations reçues par un utilisateur (public)
 */
router.get(
    '/users/:userId/ratings',
    ratingReadLimiter,
    validateUserIdParams,
    validateGetUserRatingsQuery,
    ratingController.getUserRatings
);

/**
 * GET /api/users/:userId/rating-summary
 * Récupère la note moyenne d'un utilisateur (public)
 */
router.get(
    '/users/:userId/rating-summary',
    ratingReadLimiter,
    validateUserIdParams,
    ratingController.getUserRatingSummary
);

// ============================================================================
// Routes authentifiées (client, delivery)
// ============================================================================

/**
 * POST /api/orders/:orderId/rate
 * Crée une notation pour une commande
 */
router.post(
    '/orders/:orderId/rate',
    authenticate,
    roleMiddleware.requireRole('client', 'delivery'),
    ratingCreateLimiter,
    validateRatingParams,
    validateCreateRating,
    ratingController.rateOrder
);

/**
 * GET /api/orders/:orderId/can-rate
 * Vérifie si l'utilisateur peut noter
 */
router.get(
    '/orders/:orderId/can-rate',
    authenticate,
    roleMiddleware.requireRole('client', 'delivery'),
    ratingReadLimiter,
    validateRatingParams,
    validateCanRateQuery,
    ratingController.checkCanRate
);

/**
 * GET /api/orders/:orderId/ratings
 * Récupère les notations d'une commande
 */
router.get(
    '/orders/:orderId/ratings',
    authenticate,
    ratingReadLimiter,
    validateRatingParams,
    ratingController.getOrderRatings
);

// ============================================================================
// Routes admin
// ============================================================================

/**
 * GET /api/admin/ratings
 * Liste des notations pour modération
 */
router.get(
    '/admin/ratings',
    authenticate,
    roleMiddleware.requireRole('admin'),
    adminRatingLimiter,
    validateAdminRatingsQuery,
    ratingController.adminGetRatings
);

/**
 * DELETE /api/admin/ratings/:ratingId
 * Modère (masque) une notation abusive
 */
router.delete(
    '/admin/ratings/:ratingId',
    authenticate,
    roleMiddleware.requireRole('admin'),
    adminRatingLimiter,
    validateRatingIdParams,
    validateModerateRating,
    ratingController.adminDeleteRating
);

module.exports = router;
