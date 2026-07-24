/**
 * @file responseHelper.js
 * @description Utilitaire de formatage des réponses API.
 * Assure un format cohérent pour toutes les réponses (succès et erreurs).
 */

'use strict';

/**
 * Formate une réponse de succès.
 * @param {*} data - Données à retourner
 * @param {string} [message] - Message optionnel
 * @returns {Object} Réponse formatée
 */
function success(data, message = 'Success') {
  return {
    success: true,
    message,
    data
  };
}

/**
 * Formate une réponse d'erreur.
 * @param {string} message - Message d'erreur
 * @param {number} [code] - Code HTTP
 * @param {*} [details] - Détails supplémentaires (validation errors, etc.)
 * @returns {Object} Réponse formatée
 */
function error(message, code = 500, details = null) {
  const response = {
    success: false,
    error: message,
    code
  };

  if (details) {
    response.details = details;
  }

  return response;
}

module.exports = { success, error };
