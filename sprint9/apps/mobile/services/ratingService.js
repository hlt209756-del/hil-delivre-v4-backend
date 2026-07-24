'use strict';

/**
 * @fileoverview Service API mobile pour les notations.
 * Communique avec le backend pour gérer les notations bidirectionnelles.
 * @module mobile/services/ratingService
 */

import { apiClient } from './apiClient';

/**
 * Crée une notation pour une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @param {string} ratedUserId - UUID de l'utilisateur noté
 * @param {number} score - Score de 1 à 5
 * @param {string|null} comment - Commentaire optionnel
 * @returns {Promise<object>} Résultat de la création
 */
export async function createRating(orderId, ratedUserId, score, comment = null) {
    try {
        const response = await apiClient.post(`/api/orders/${orderId}/rate`, {
            rated_user_id: ratedUserId,
            score,
            comment
        });
        return response.data;
    } catch (error) {
        console.error('[RatingService Mobile] Erreur createRating:', error.message);
        throw error;
    }
}

/**
 * Vérifie si l'utilisateur peut noter une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @param {string} ratedUserId - UUID de l'utilisateur à noter
 * @returns {Promise<{can_rate: boolean, reason: string|null}>}
 */
export async function checkCanRate(orderId, ratedUserId) {
    try {
        const response = await apiClient.get(`/api/orders/${orderId}/can-rate`, {
            params: { rated_user_id: ratedUserId }
        });
        return response.data.data;
    } catch (error) {
        console.error('[RatingService Mobile] Erreur checkCanRate:', error.message);
        return { can_rate: false, reason: 'Erreur de vérification' };
    }
}

/**
 * Récupère les notations d'un utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {object} options - Options de pagination
 * @param {number} [options.page=1] - Page
 * @param {number} [options.limit=20] - Limite
 * @param {string} [options.sortBy='created_at'] - Tri
 * @param {string} [options.sortOrder='desc'] - Ordre
 * @returns {Promise<object>} Notations paginées
 */
export async function getUserRatings(userId, options = {}) {
    try {
        const { page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'desc' } = options;
        const response = await apiClient.get(`/api/users/${userId}/ratings`, {
            params: { page, limit, sort_by: sortBy, sort_order: sortOrder }
        });
        return response.data.data;
    } catch (error) {
        console.error('[RatingService Mobile] Erreur getUserRatings:', error.message);
        throw error;
    }
}

/**
 * Récupère le résumé de notation d'un utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<{avg_rating: number, ratings_count: number}>}
 */
export async function getUserRatingSummary(userId) {
    try {
        const response = await apiClient.get(`/api/users/${userId}/rating-summary`);
        return response.data.data;
    } catch (error) {
        console.error('[RatingService Mobile] Erreur getUserRatingSummary:', error.message);
        return { avg_rating: 0, ratings_count: 0 };
    }
}

/**
 * Récupère les notations d'une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<object[]>} Liste des notations
 */
export async function getOrderRatings(orderId) {
    try {
        const response = await apiClient.get(`/api/orders/${orderId}/ratings`);
        return response.data.data;
    } catch (error) {
        console.error('[RatingService Mobile] Erreur getOrderRatings:', error.message);
        return [];
    }
}
