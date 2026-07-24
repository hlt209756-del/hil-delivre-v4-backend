'use strict';

/**
 * @fileoverview Helpers pour les réponses API standardisées.
 * Garantit un format de réponse cohérent dans toute l'application.
 *
 * @module utils/responseHelper
 */

/**
 * Envoie une réponse de succès standardisée.
 *
 * @param {import('express').Response} res - Objet Response Express
 * @param {number} statusCode - Code HTTP (200, 201, etc.)
 * @param {string} message - Message de succès
 * @param {object} [data] - Données à inclure dans la réponse
 * @returns {import('express').Response}
 */
function success(res, statusCode, message, data = null) {
  const response = {
    success: true,
    message,
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
}

/**
 * Envoie une réponse d'erreur standardisée.
 *
 * @param {import('express').Response} res - Objet Response Express
 * @param {number} statusCode - Code HTTP (400, 401, 403, 404, 409, 422, 500)
 * @param {string} code - Code d'erreur machine-readable (ex: 'AUTH_TOKEN_MISSING')
 * @param {string} message - Message d'erreur human-readable
 * @param {object} [details] - Détails supplémentaires (uniquement en dev)
 * @returns {import('express').Response}
 */
function error(res, statusCode, code, message, details = null) {
  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details && process.env.NODE_ENV !== 'production') {
    response.error.details = details;
  }

  return res.status(statusCode).json(response);
}

/**
 * Envoie une réponse paginée standardisée.
 *
 * @param {import('express').Response} res - Objet Response Express
 * @param {Array} items - Éléments de la page courante
 * @param {object} pagination - Informations de pagination
 * @param {number} pagination.page - Page courante
 * @param {number} pagination.limit - Nombre d'éléments par page
 * @param {number} pagination.total - Nombre total d'éléments
 * @returns {import('express').Response}
 */
function paginated(res, items, pagination) {
  return res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        total_pages: Math.ceil(pagination.total / pagination.limit),
        has_next: pagination.page * pagination.limit < pagination.total,
        has_prev: pagination.page > 1,
      },
    },
  });
}

module.exports = {
  success,
  error,
  paginated,
};
