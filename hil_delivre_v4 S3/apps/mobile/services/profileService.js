'use strict';

/**
 * @fileoverview Service de gestion du profil pour l'application mobile Hil_Delivre v4.
 *
 * @module services/profileService
 */

import { API_BASE_URL } from '../config/api';

const REQUEST_TIMEOUT = 15000;

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

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      return { success: false, error: { code: 'TIMEOUT', message: 'Requête expirée.' } };
    }
    return { success: false, error: { code: 'NETWORK_ERROR', message: 'Erreur réseau.' } };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Mettre à jour le profil utilisateur.
 *
 * @param {string} accessToken - Token d'accès
 * @param {object} data - Données à mettre à jour
 * @returns {Promise<object>} Réponse API
 */
async function updateProfile(accessToken, data) {
  return apiRequest('/api/user/profile', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

/**
 * Supprimer le compte (droit CIL).
 *
 * @param {string} accessToken - Token d'accès
 * @returns {Promise<object>} Réponse API
 */
async function deleteProfile(accessToken) {
  return apiRequest('/api/user/profile', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Soumettre une demande KYC.
 *
 * @param {string} accessToken - Token d'accès
 * @param {object} data - Données KYC
 * @returns {Promise<object>} Réponse API
 */
async function submitKYC(accessToken, data) {
  return apiRequest('/api/user/kyc', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(data),
  });
}

/**
 * Récupérer le statut KYC.
 *
 * @param {string} accessToken - Token d'accès
 * @returns {Promise<object>} Réponse API
 */
async function getKYCStatus(accessToken) {
  return apiRequest('/api/user/kyc/status', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export default {
  updateProfile,
  deleteProfile,
  submitKYC,
  getKYCStatus,
};
