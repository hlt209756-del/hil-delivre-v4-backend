'use strict';

/**
 * @fileoverview Middleware de cache HTTP pour le Sprint 10 de Hil_Delivre v4.
 * Implémente ETag, Cache-Control et les requêtes conditionnelles (If-None-Match).
 * @module middlewares/cacheMiddleware
 */

const crypto = require('crypto');

/**
 * Génère un ETag à partir du contenu de la réponse.
 * Utilise un hash MD5 tronqué pour la performance.
 * @param {string|Buffer} content - Le contenu à hasher.
 * @returns {string} L'ETag généré (format: W/"<hash>").
 */
const generateETag = (content) => {
  const hash = crypto
    .createHash('md5')
    .update(typeof content === 'string' ? content : JSON.stringify(content))
    .digest('hex')
    .substring(0, 16);
  return `W/"${hash}"`;
};

/**
 * Crée un middleware de cache HTTP configurable.
 *
 * @param {Object} options - Options de configuration.
 * @param {number} [options.maxAge=0] - Durée de cache en secondes (Cache-Control: max-age).
 * @param {boolean} [options.private=true] - Si true, Cache-Control: private (pas de cache partagé).
 * @param {boolean} [options.etag=true] - Si true, génère et vérifie les ETags.
 * @param {boolean} [options.noStore=false] - Si true, Cache-Control: no-store (aucun cache).
 * @param {string[]} [options.varyHeaders=['Authorization']] - Headers pour le Vary.
 * @returns {import('express').RequestHandler}
 *
 * @example
 * // Cache 60 secondes, privé, avec ETag
 * router.get('/data', httpCache({ maxAge: 60 }), controller.getData);
 *
 * // Pas de cache (données sensibles)
 * router.get('/secrets', httpCache({ noStore: true }), controller.getSecrets);
 */
const httpCache = (options = {}) => {
  const {
    maxAge = 0,
    private: isPrivate = true,
    etag = true,
    noStore = false,
    varyHeaders = ['Authorization'],
  } = options;

  return (req, res, next) => {
    // Pas de cache pour les méthodes non-GET
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }

    // Construire la directive Cache-Control
    if (noStore) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    } else {
      const directives = [];
      directives.push(isPrivate ? 'private' : 'public');
      directives.push(`max-age=${maxAge}`);
      if (maxAge === 0) {
        directives.push('must-revalidate');
      }
      res.set('Cache-Control', directives.join(', '));
    }

    // Header Vary
    if (varyHeaders.length > 0) {
      res.set('Vary', varyHeaders.join(', '));
    }

    // Si ETag est désactivé ou noStore, passer directement
    if (!etag || noStore) {
      return next();
    }

    // Intercepter res.json pour ajouter l'ETag
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const etagValue = generateETag(body);
        res.set('ETag', etagValue);

        // Vérifier If-None-Match (requête conditionnelle)
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etagValue) {
          return res.status(304).end();
        }

        return originalJson(body);
      } catch (error) {
        // En cas d'erreur de génération ETag, envoyer sans ETag
        console.error('[CacheMiddleware] Erreur génération ETag:', error.message);
        return originalJson(body);
      }
    };

    next();
  };
};

/**
 * Middleware de cache pour les endpoints de dashboard (60 secondes).
 */
const cacheDashboard = httpCache({ maxAge: 60, etag: true });

/**
 * Middleware de cache pour les métriques (30 secondes).
 */
const cacheMetrics = httpCache({ maxAge: 30, etag: true });

/**
 * Middleware de cache pour les listes (120 secondes).
 */
const cacheLists = httpCache({ maxAge: 120, etag: true });

/**
 * Middleware sans cache pour les données sensibles.
 */
const noCache = httpCache({ noStore: true });

module.exports = {
  httpCache,
  generateETag,
  cacheDashboard,
  cacheMetrics,
  cacheLists,
  noCache,
};
