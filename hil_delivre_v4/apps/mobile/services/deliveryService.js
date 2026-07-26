/**
 * @file apps/mobile/services/deliveryService.js
 * @description Service mobile pour les appels API de livraison.
 * Gère l'estimation des frais, le tracking et la géolocalisation.
 */

import { apiClient } from '../config/api';

// ============================================================================
// CONSTANTES
// ============================================================================

const DELIVERY_ENDPOINTS = {
  ESTIMATE: '/api/delivery/estimate',
  CALCULATE: '/api/delivery/calculate',
  SURGE: '/api/delivery/surge',
  ASSIGN: '/api/delivery/assign',
  ASSIGNMENTS_ACTIVE: '/api/delivery/assignments/active',
  ACCEPT_ASSIGNMENT: (id) => `/api/delivery/assignments/${id}/accept`,
  REJECT_ASSIGNMENT: (id) => `/api/delivery/assignments/${id}/reject`,
  LOCATION: '/api/delivery/location',
  AVAILABILITY: '/api/delivery/availability',
  TRACKING_EVENT: '/api/delivery/tracking/event',
  TRACKING_HISTORY: (orderId) => `/api/delivery/tracking/${orderId}`,
  POSITION: (orderId) => `/api/delivery/position/${orderId}`
};

// ============================================================================
// ESTIMATION & FRAIS
// ============================================================================

/**
 * Estime les frais de livraison entre deux points.
 * @param {Object} merchant - {latitude, longitude}
 * @param {Object} delivery - {latitude, longitude}
 * @returns {Promise<Object>}
 */
export async function estimateDeliveryFee(merchant, delivery) {
  try {
    const response = await apiClient.post(DELIVERY_ENDPOINTS.ESTIMATE, {
      merchant_latitude: merchant.latitude,
      merchant_longitude: merchant.longitude,
      delivery_latitude: delivery.latitude,
      delivery_longitude: delivery.longitude
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to estimate delivery fee');
  }
}

/**
 * Calcule les frais définitifs (avec surge).
 * @param {Object} merchant - {latitude, longitude}
 * @param {Object} delivery - {latitude, longitude}
 * @returns {Promise<Object>}
 */
export async function calculateDeliveryFee(merchant, delivery) {
  try {
    const response = await apiClient.post(DELIVERY_ENDPOINTS.CALCULATE, {
      merchant_latitude: merchant.latitude,
      merchant_longitude: merchant.longitude,
      delivery_latitude: delivery.latitude,
      delivery_longitude: delivery.longitude
    });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to calculate delivery fee');
  }
}

/**
 * Récupère le statut actuel du surge pricing.
 * @returns {Promise<Object>}
 */
export async function getSurgeStatus() {
  try {
    const response = await apiClient.get(DELIVERY_ENDPOINTS.SURGE);
    return response.data;
  } catch (error) {
    return { data: { multiplier: 1.0, is_surge_active: false } };
  }
}

// ============================================================================
// ASSIGNATION (Livreur)
// ============================================================================

/**
 * Récupère les assignations actives du livreur.
 * @returns {Promise<Array>}
 */
export async function getActiveAssignments() {
  try {
    const response = await apiClient.get(DELIVERY_ENDPOINTS.ASSIGNMENTS_ACTIVE);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to get assignments');
  }
}

/**
 * Accepte une assignation de livraison.
 * @param {string} assignmentId - UUID de l'assignation
 * @returns {Promise<Object>}
 */
export async function acceptAssignment(assignmentId) {
  try {
    const response = await apiClient.post(DELIVERY_ENDPOINTS.ACCEPT_ASSIGNMENT(assignmentId));
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to accept assignment');
  }
}

/**
 * Rejette une assignation de livraison.
 * @param {string} assignmentId - UUID de l'assignation
 * @param {string} [reason] - Raison du rejet
 * @returns {Promise<Object>}
 */
export async function rejectAssignment(assignmentId, reason = null) {
  try {
    const response = await apiClient.post(
      DELIVERY_ENDPOINTS.REJECT_ASSIGNMENT(assignmentId),
      { reason }
    );
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to reject assignment');
  }
}

// ============================================================================
// GÉOLOCALISATION (Livreur)
// ============================================================================

/**
 * Met à jour la position GPS du livreur.
 * @param {Object} location - {latitude, longitude, heading, speed, accuracy}
 * @returns {Promise<Object>}
 */
export async function updateLocation(location) {
  try {
    const response = await apiClient.put(DELIVERY_ENDPOINTS.LOCATION, location);
    return response.data;
  } catch (error) {
    // Ne pas throw pour les erreurs de throttling (429)
    if (error.response?.status === 429) {
      return { throttled: true };
    }
    throw new Error(error.response?.data?.error || 'Failed to update location');
  }
}

/**
 * Met à jour la disponibilité du livreur.
 * @param {string} availability - 'online', 'busy', 'offline'
 * @returns {Promise<Object>}
 */
export async function updateAvailability(availability) {
  try {
    const response = await apiClient.put(DELIVERY_ENDPOINTS.AVAILABILITY, { availability });
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to update availability');
  }
}

// ============================================================================
// TRACKING
// ============================================================================

/**
 * Enregistre un événement de tracking.
 * @param {string} orderId - UUID de la commande
 * @param {string} eventType - Type d'événement
 * @param {Object} [location] - Position GPS optionnelle
 * @param {Object} [metadata] - Données supplémentaires
 * @returns {Promise<Object>}
 */
export async function recordTrackingEvent(orderId, eventType, location = null, metadata = {}) {
  try {
    const payload = {
      order_id: orderId,
      event_type: eventType,
      metadata
    };

    if (location) {
      payload.latitude = location.latitude;
      payload.longitude = location.longitude;
    }

    const response = await apiClient.post(DELIVERY_ENDPOINTS.TRACKING_EVENT, payload);
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to record tracking event');
  }
}

/**
 * Récupère l'historique de tracking d'une commande.
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<Array>}
 */
export async function getTrackingHistory(orderId) {
  try {
    const response = await apiClient.get(DELIVERY_ENDPOINTS.TRACKING_HISTORY(orderId));
    return response.data;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to get tracking history');
  }
}

/**
 * Récupère la position actuelle du livreur d'une commande.
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<Object|null>}
 */
export async function getDelivererPosition(orderId) {
  try {
    const response = await apiClient.get(DELIVERY_ENDPOINTS.POSITION(orderId));
    return response.data;
  } catch (error) {
    return null;
  }
}

export default {
  estimateDeliveryFee,
  calculateDeliveryFee,
  getSurgeStatus,
  getActiveAssignments,
  acceptAssignment,
  rejectAssignment,
  updateLocation,
  updateAvailability,
  recordTrackingEvent,
  getTrackingHistory,
  getDelivererPosition
};
