'use strict';

/**
 * @fileoverview Service de gestion des commandes pour l'application mobile Hil_Delivre v4.
 * Gère les appels API pour la création, consultation et annulation de commandes.
 *
 * @module services/orderService
 */

import { API_BASE_URL } from '../config/api';

const REQUEST_TIMEOUT = 20000; // 20s pour les opérations de commande

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
 * Créer une nouvelle commande.
 *
 * @param {string} accessToken - Token d'accès
 * @param {object} orderData - Données de la commande
 * @param {string} orderData.merchant_id - ID du marchand
 * @param {Array<{menu_item_id: string, quantity: number}>} orderData.items - Articles
 * @param {string} [orderData.delivery_address] - Adresse de livraison
 * @param {number} [orderData.delivery_latitude] - Latitude
 * @param {number} [orderData.delivery_longitude] - Longitude
 * @param {string} [orderData.client_note] - Note du client
 * @returns {Promise<object>} Commande créée
 */
async function createOrder(accessToken, orderData) {
  if (!accessToken) {
    return { success: false, error: { code: 'NO_TOKEN', message: 'Authentification requise.' } };
  }

  return apiRequest('/api/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(orderData),
  });
}

/**
 * Récupérer la liste des commandes de l'utilisateur.
 *
 * @param {string} accessToken - Token d'accès
 * @param {object} params - Paramètres de filtrage
 * @param {number} [params.page=1] - Page courante
 * @param {number} [params.limit=20] - Résultats par page
 * @param {string} [params.status] - Filtrer par statut
 * @returns {Promise<object>} Liste des commandes avec pagination
 */
async function getOrders(accessToken, { page = 1, limit = 20, status } = {}) {
  if (!accessToken) {
    return { success: false, error: { code: 'NO_TOKEN', message: 'Authentification requise.' } };
  }

  let endpoint = `/api/orders?page=${page}&limit=${limit}`;
  if (status) {
    endpoint += `&status=${status}`;
  }

  return apiRequest(endpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Récupérer les détails d'une commande.
 *
 * @param {string} accessToken - Token d'accès
 * @param {string} orderId - ID de la commande
 * @returns {Promise<object>} Détails de la commande avec articles
 */
async function getOrderDetails(accessToken, orderId) {
  if (!accessToken || !orderId) {
    return { success: false, error: { code: 'INVALID_PARAM', message: 'Paramètres invalides.' } };
  }

  return apiRequest(`/api/orders/${orderId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Annuler une commande.
 *
 * @param {string} accessToken - Token d'accès
 * @param {string} orderId - ID de la commande
 * @param {string} [reason] - Raison de l'annulation
 * @returns {Promise<object>} Résultat de l'annulation
 */
async function cancelOrder(accessToken, orderId, reason = '') {
  if (!accessToken || !orderId) {
    return { success: false, error: { code: 'INVALID_PARAM', message: 'Paramètres invalides.' } };
  }

  return apiRequest(`/api/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ reason }),
  });
}

/**
 * Mettre à jour le statut d'une commande (marchand/livreur).
 *
 * @param {string} accessToken - Token d'accès
 * @param {string} orderId - ID de la commande
 * @param {string} status - Nouveau statut
 * @param {string} [cancellationReason] - Raison si annulation
 * @returns {Promise<object>} Commande mise à jour
 */
async function updateOrderStatus(accessToken, orderId, status, cancellationReason) {
  if (!accessToken || !orderId || !status) {
    return { success: false, error: { code: 'INVALID_PARAM', message: 'Paramètres invalides.' } };
  }

  const body = { status };
  if (cancellationReason) {
    body.cancellation_reason = cancellationReason;
  }

  return apiRequest(`/api/orders/${orderId}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

export default {
  createOrder,
  getOrders,
  getOrderDetails,
  cancelOrder,
  updateOrderStatus,
};
