'use strict';

/**
 * @fileoverview Service d'authentification pour l'application mobile Hil_Delivre v4.
 * Encapsule tous les appels API liés à l'authentification.
 *
 * @module services/authService
 */

import { API_BASE_URL } from '../config/api';

/**
 * Timeout par défaut pour les requêtes (15 secondes).
 */
const REQUEST_TIMEOUT = 15000;

/**
 * Effectue une requête HTTP avec timeout et gestion d'erreurs.
 *
 * @param {string} endpoint - Chemin de l'endpoint (ex: '/api/auth/login')
 * @param {object} options - Options fetch
 * @returns {Promise<object>} Réponse JSON parsée
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
      return {
        success: false,
        error: {
          code: 'TIMEOUT',
          message: 'La requête a expiré. Vérifiez votre connexion internet.',
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'Impossible de contacter le serveur. Vérifiez votre connexion internet.',
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Inscription d'un nouvel utilisateur.
 *
 * @param {object} data - Données d'inscription
 * @param {string} data.email
 * @param {string} data.password
 * @param {string} data.phone_number
 * @param {string} data.first_name
 * @param {string} data.last_name
 * @param {string} [data.preferred_language]
 * @param {boolean} data.cil_consent
 * @param {boolean} data.terms_accepted
 * @returns {Promise<object>} Réponse API
 */
async function register(data) {
  return apiRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * Connexion d'un utilisateur.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<object>} Réponse API avec session et profil
 */
async function login(email, password) {
  return apiRequest('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Déconnexion de l'utilisateur.
 *
 * @param {string} accessToken - Token d'accès actuel
 * @returns {Promise<object>} Réponse API
 */
async function logout(accessToken) {
  return apiRequest('/api/auth/logout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Rafraîchir le token d'accès.
 *
 * @param {string} refreshToken - Token de rafraîchissement
 * @returns {Promise<object>} Réponse API avec nouvelle session
 */
async function refreshToken(refreshToken) {
  return apiRequest('/api/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

/**
 * Demander un email de réinitialisation de mot de passe.
 *
 * @param {string} email
 * @returns {Promise<object>} Réponse API
 */
async function forgotPassword(email) {
  return apiRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/**
 * Réinitialiser le mot de passe.
 *
 * @param {string} accessToken - Token de réinitialisation
 * @param {string} newPassword - Nouveau mot de passe
 * @returns {Promise<object>} Réponse API
 */
async function resetPassword(accessToken, newPassword) {
  return apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ access_token: accessToken, new_password: newPassword }),
  });
}

/**
 * Récupérer le profil de l'utilisateur authentifié.
 *
 * @param {string} accessToken - Token d'accès
 * @returns {Promise<object>} Réponse API avec profil
 */
async function getProfile(accessToken) {
  return apiRequest('/api/user/profile', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export default {
  register,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
  getProfile,
};
