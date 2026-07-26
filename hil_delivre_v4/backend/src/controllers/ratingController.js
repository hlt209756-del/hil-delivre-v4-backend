'use strict';

/**
 * @fileoverview Controller pour les endpoints de notation.
 * Gère les requêtes HTTP liées aux notations bidirectionnelles.
 * @module controllers/ratingController
 */

const ratingService = require('../services/ratingService');

/**
 * POST /api/orders/:orderId/rate
 * Crée une notation pour une commande.
 * Rôles : client (note marchand/livreur), delivery (note client)
 */
async function rateOrder(req, res) {
    try {
        const { orderId } = req.params;
        const { rated_user_id, score, comment } = req.body;
        const raterId = req.user.id;

        const result = await ratingService.createRating(raterId, orderId, rated_user_id, score, comment);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(201).json({
            success: true,
            message: 'Notation créée avec succès',
            data: result.data
        });
    } catch (error) {
        console.error('[RatingController] Erreur rateOrder:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/users/:userId/ratings
 * Récupère les notations reçues par un utilisateur (public).
 */
async function getUserRatings(req, res) {
    try {
        const { userId } = req.params;
        const { page, limit, min_score, max_score, sort_by, sort_order } = req.query;

        const result = await ratingService.getRatingsForUser(userId, {
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 20,
            minScore: min_score ? parseInt(min_score, 10) : undefined,
            maxScore: max_score ? parseInt(max_score, 10) : undefined,
            sortBy: sort_by,
            sortOrder: sort_order
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Notations récupérées avec succès',
            data: result.data
        });
    } catch (error) {
        console.error('[RatingController] Erreur getUserRatings:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/orders/:orderId/ratings
 * Récupère les notations d'une commande spécifique.
 * Rôles : parties de la commande + admin
 */
async function getOrderRatings(req, res) {
    try {
        const { orderId } = req.params;

        const result = await ratingService.getRatingsByOrder(orderId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Notations de la commande récupérées',
            data: result.data
        });
    } catch (error) {
        console.error('[RatingController] Erreur getOrderRatings:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/users/:userId/rating-summary
 * Récupère la note moyenne d'un utilisateur (public).
 */
async function getUserRatingSummary(req, res) {
    try {
        const { userId } = req.params;

        const result = await ratingService.getAverageRating(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Résumé des notations récupéré',
            data: result.data
        });
    } catch (error) {
        console.error('[RatingController] Erreur getUserRatingSummary:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/orders/:orderId/can-rate
 * Vérifie si l'utilisateur peut noter pour cette commande.
 * Rôles : client, delivery
 */
async function checkCanRate(req, res) {
    try {
        const { orderId } = req.params;
        const { rated_user_id } = req.query;
        const raterId = req.user.id;

        if (!rated_user_id) {
            return res.status(400).json({
                success: false,
                message: 'Le paramètre rated_user_id est requis',
                error: 'MISSING_PARAMETER'
            });
        }

        const result = await ratingService.canUserRate(raterId, orderId, rated_user_id);

        return res.status(200).json({
            success: true,
            data: {
                can_rate: result.canRate,
                reason: result.reason
            }
        });
    } catch (error) {
        console.error('[RatingController] Erreur checkCanRate:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/admin/ratings
 * Liste des notations pour modération (admin).
 */
async function adminGetRatings(req, res) {
    try {
        const { page, limit, include_hidden, min_score, max_score, user_id } = req.query;

        const result = await ratingService.getAdminRatings({
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 20,
            includeHidden: include_hidden === 'true',
            minScore: min_score ? parseInt(min_score, 10) : undefined,
            maxScore: max_score ? parseInt(max_score, 10) : undefined,
            userId: user_id
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Notations récupérées (admin)',
            data: result.data
        });
    } catch (error) {
        console.error('[RatingController] Erreur adminGetRatings:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * DELETE /api/admin/ratings/:ratingId
 * Modère (masque) une notation abusive (admin).
 */
async function adminDeleteRating(req, res) {
    try {
        const { ratingId } = req.params;
        const { reason } = req.body;
        const adminId = req.user.id;

        const result = await ratingService.deleteRating(ratingId, adminId, reason);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Notation modérée avec succès',
            data: result.data
        });
    } catch (error) {
        console.error('[RatingController] Erreur adminDeleteRating:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = {
    rateOrder,
    getUserRatings,
    getOrderRatings,
    getUserRatingSummary,
    checkCanRate,
    adminGetRatings,
    adminDeleteRating
};
