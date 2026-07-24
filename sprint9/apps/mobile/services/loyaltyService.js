'use strict';

/**
 * @fileoverview Service API mobile pour le programme de fidélisation.
 * Communique avec le backend pour gérer les points de fidélité.
 * @module mobile/services/loyaltyService
 */

import { apiClient } from './apiClient';

/**
 * Récupère le solde de points de fidélité du client.
 *
 * @returns {Promise<object>} Solde et informations associées
 */
export async function getPointsBalance() {
    try {
        const response = await apiClient.get('/api/loyalty/points');
        return response.data.data;
    } catch (error) {
        console.error('[LoyaltyService Mobile] Erreur getPointsBalance:', error.message);
        throw error;
    }
}

/**
 * Récupère l'historique des transactions de points.
 *
 * @param {object} options - Options de pagination et filtrage
 * @param {number} [options.page=1] - Page
 * @param {number} [options.limit=20] - Limite
 * @param {string} [options.type] - Type de transaction (earned, redeemed, expired)
 * @returns {Promise<object>} Historique paginé
 */
export async function getPointsHistory(options = {}) {
    try {
        const { page = 1, limit = 20, type } = options;
        const params = { page, limit };
        if (type) params.type = type;

        const response = await apiClient.get('/api/loyalty/history', { params });
        return response.data.data;
    } catch (error) {
        console.error('[LoyaltyService Mobile] Erreur getPointsHistory:', error.message);
        throw error;
    }
}

/**
 * Convertit des points en crédit plateforme.
 *
 * @param {number} points - Nombre de points à convertir (minimum 100)
 * @returns {Promise<object>} Résultat de la conversion
 */
export async function redeemPoints(points) {
    try {
        const response = await apiClient.post('/api/loyalty/redeem', { points });
        return response.data;
    } catch (error) {
        console.error('[LoyaltyService Mobile] Erreur redeemPoints:', error.message);
        throw error;
    }
}
