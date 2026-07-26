'use strict';

/**
 * @fileoverview Service de gestion des menus pour l'application mobile Hil_Delivre v4.
 * Gère les appels API pour la consultation des marchands et de leurs menus.
 *
 * @module services/menuService
 */

import { API_BASE_URL } from '../config/api';

const REQUEST_TIMEOUT = 15000;

/**
 * Helper pour les requêtes API avec timeout et gestion d'erreurs.
 *
 * @param {string} endpoint - Endpoint relatif
 * @param {object} options - Options fetch
 * @returns {Promise<object>} Réponse parsée
 */
async function apiRequest(endpoint, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: { code: 'TIMEOUT', message: 'Requête expirée. Vérifiez votre connexion.' } };
    }
    return { success: false, error: { code: 'NETWORK_ERROR', message: 'Erreur réseau. Vérifiez votre connexion.' } };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Récupérer la liste des marchands actifs.
 *
 * @param {object} params - Paramètres de recherche
 * @param {number} [params.page=1] - Page courante
 * @param {number} [params.limit=20] - Nombre de résultats par page
 * @param {string} [params.search] - Terme de recherche
 * @returns {Promise<object>} Liste des marchands avec pagination
 */
async function getMerchants({ page = 1, limit = 20, search } = {}) {
  let endpoint = `/api/merchants?page=${page}&limit=${limit}`;
  if (search) {
    endpoint += `&search=${encodeURIComponent(search)}`;
  }
  return apiRequest(endpoint);
}

/**
 * Récupérer le menu d'un marchand spécifique.
 *
 * @param {string} merchantId - ID du marchand
 * @param {object} params - Paramètres de filtrage
 * @param {string} [params.category] - Filtrer par catégorie
 * @param {boolean} [params.availableOnly=true] - N'afficher que les articles disponibles
 * @returns {Promise<object>} Menu du marchand avec catégories
 */
async function getMerchantMenu(merchantId, { category, availableOnly = true } = {}) {
  if (!merchantId) {
    return { success: false, error: { code: 'INVALID_PARAM', message: 'ID marchand requis.' } };
  }

  let endpoint = `/api/merchants/${merchantId}/menu?available_only=${availableOnly}`;
  if (category) {
    endpoint += `&category=${encodeURIComponent(category)}`;
  }
  return apiRequest(endpoint);
}

export default {
  getMerchants,
  getMerchantMenu,
};
