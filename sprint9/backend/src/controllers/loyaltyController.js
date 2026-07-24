'use strict';

/**
 * @fileoverview Controller pour les endpoints de fidélisation.
 * Gère les requêtes HTTP liées au programme de points de fidélité.
 * @module controllers/loyaltyController
 */

const loyaltyService = require('../services/loyaltyService');

/**
 * GET /api/loyalty/points
 * Récupère le solde de points de fidélité du client connecté.
 * Rôle : client
 */
async function getPoints(req, res) {
    try {
        const userId = req.user.id;

        const result = await loyaltyService.getPointsBalance(userId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Solde de points récupéré',
            data: result.data
        });
    } catch (error) {
        console.error('[LoyaltyController] Erreur getPoints:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/loyalty/history
 * Récupère l'historique des transactions de points.
 * Rôle : client
 */
async function getHistory(req, res) {
    try {
        const userId = req.user.id;
        const { page, limit, type } = req.query;

        const result = await loyaltyService.getPointsHistory(userId, {
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 20,
            type: type || undefined
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
            message: 'Historique des points récupéré',
            data: result.data
        });
    } catch (error) {
        console.error('[LoyaltyController] Erreur getHistory:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * POST /api/loyalty/redeem
 * Convertit des points en crédit plateforme.
 * Rôle : client
 */
async function redeemPoints(req, res) {
    try {
        const userId = req.user.id;
        const { points } = req.body;

        const result = await loyaltyService.redeemPoints(userId, points);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: result.data.message,
            data: result.data
        });
    } catch (error) {
        console.error('[LoyaltyController] Erreur redeemPoints:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/admin/loyalty/stats
 * Récupère les statistiques du programme de fidélité.
 * Rôle : admin
 */
async function adminGetStats(req, res) {
    try {
        const result = await loyaltyService.getLoyaltyStats();

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Statistiques de fidélité récupérées',
            data: result.data
        });
    } catch (error) {
        console.error('[LoyaltyController] Erreur adminGetStats:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * POST /api/admin/loyalty/expire
 * Déclenche manuellement l'expiration des points périmés.
 * Rôle : admin
 */
async function adminExpirePoints(req, res) {
    try {
        const result = await loyaltyService.expirePoints();

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        // Logger l'action admin
        const supabase = require('../config/supabase');
        await supabase.from('admin_actions').insert({
            admin_id: req.user.id,
            action_type: 'loyalty_points_expired',
            target_type: 'loyalty_points',
            target_id: null,
            reason: 'Expiration manuelle déclenchée par admin',
            metadata: { expired_count: result.data.expired_count }
        });

        return res.status(200).json({
            success: true,
            message: `${result.data.expired_count} entrée(s) de points expirée(s)`,
            data: result.data
        });
    } catch (error) {
        console.error('[LoyaltyController] Erreur adminExpirePoints:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = {
    getPoints,
    getHistory,
    redeemPoints,
    adminGetStats,
    adminExpirePoints
};
