/**
 * @file rawBodyMiddleware.js
 * @description Middleware pour capturer le corps brut (raw body) des requêtes.
 * Nécessaire pour la vérification HMAC des webhooks PayDunya.
 * Le body brut est stocké dans req.rawBody avant le parsing JSON.
 */

'use strict';

/**
 * Middleware Express qui capture le raw body pour les routes webhook.
 * Doit être appliqué AVANT express.json() pour les routes qui en ont besoin.
 *
 * Usage dans app.js :
 * ```
 * // Pour les routes webhook, capturer le raw body
 * app.use('/api/payments/webhook', rawBodyMiddleware);
 * // Puis le JSON parser standard
 * app.use(express.json());
 * ```
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function rawBodyMiddleware(req, res, next) {
  // Ne capturer que pour les POST (webhooks)
  if (req.method !== 'POST') {
    return next();
  }

  let data = '';

  req.setEncoding('utf8');

  req.on('data', (chunk) => {
    data += chunk;
  });

  req.on('end', () => {
    req.rawBody = data;

    // Parser le JSON manuellement
    try {
      if (data && req.headers['content-type']?.includes('application/json')) {
        req.body = JSON.parse(data);
      }
    } catch (err) {
      // Si le parsing échoue, laisser le body vide
      req.body = {};
    }

    next();
  });

  req.on('error', (err) => {
    next(err);
  });
}

module.exports = rawBodyMiddleware;
