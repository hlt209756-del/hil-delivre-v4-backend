'use strict';

/**
 * @fileoverview Routes de monitoring pour le Sprint 10 de Hil_Delivre v4.
 * Toutes les routes sont protégées par authentification JWT et rôle admin,
 * sauf /health (public) et /metrics (protégé par token Prometheus).
 * @module routes/monitoringRoutes
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const monitoringController = require('../controllers/monitoringController');
const { authenticate } = require('../middlewares/authMiddleware');
const {
  validateCreateExport,
  validateCacheInvalidation,
  validateCacheFlush,
  validateExportListQuery,
  validateJobIdParam,
  validateServiceParam,
} = require('../middlewares/validationSprint10');

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiters
// ─────────────────────────────────────────────────────────────────────────────

/** Rate limiter pour les endpoints admin monitoring : 120 req/min */
const adminMonitoringLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trop de requêtes. Réessayez dans une minute.',
  },
});

/** Rate limiter pour les exports : 5 req/h */
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'Limite d\'exports atteinte. Maximum 5 exports par heure.',
  },
});

/** Rate limiter pour le flush cache : 2 req/h (action critique) */
const flushLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    error: 'Action critique limitée. Maximum 2 flush par heure.',
  },
});

/** Rate limiter pour les métriques Prometheus : 60 req/min (scraping) */
const metricsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

// ─────────────────────────────────────────────────────────────────────────────
// Middleware d'autorisation admin
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware vérifiant que l'utilisateur authentifié a le rôle 'admin'.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Accès refusé. Rôle administrateur requis.',
    });
  }
  next();
};

/**
 * Middleware vérifiant le token Prometheus pour l'endpoint /metrics.
 * Accepte soit un token Bearer, soit un query param ?token=xxx.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const requireMetricsToken = (req, res, next) => {
  const expectedToken = process.env.PROMETHEUS_METRICS_TOKEN;

  // Si pas de token configuré, autoriser (dev mode)
  if (!expectedToken) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const providedToken = authHeader?.replace('Bearer ', '') || queryToken;

  if (!providedToken || providedToken !== expectedToken) {
    return res.status(401).json({
      success: false,
      error: 'Token de métriques invalide.',
    });
  }

  next();
};

// ─────────────────────────────────────────────────────────────────────────────
// Routes publiques / semi-publiques
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/health
 * Health check public (sans détails sensibles).
 * Retourne uniquement le statut agrégé pour les load balancers.
 */
router.get('/health', (req, res) => {
  // Version simplifiée pour les load balancers (pas besoin d'auth)
  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '4.10.0',
  });
});

/**
 * GET /api/monitoring/metrics
 * Endpoint Prometheus (protégé par token dédié, pas JWT).
 */
router.get(
  '/metrics',
  metricsLimiter,
  requireMetricsToken,
  monitoringController.getMetrics
);

// ─────────────────────────────────────────────────────────────────────────────
// Routes admin protégées
// ─────────────────────────────────────────────────────────────────────────────

// Toutes les routes suivantes nécessitent JWT + rôle admin
router.use(authenticate);
router.use(requireAdmin);
router.use(adminMonitoringLimiter);

// --- Health Checks détaillés ---
router.get('/health/detailed', monitoringController.getHealthStatus);
router.get('/health/:service', validateServiceParam, monitoringController.getServiceHealth);

// --- Métriques JSON (dashboard admin) ---
router.get('/metrics/json', monitoringController.getMetricsJson);

// --- Exports CSV ---
router.post('/exports', exportLimiter, validateCreateExport, monitoringController.createExport);
router.get('/exports', validateExportListQuery, monitoringController.listExports);
router.get('/exports/:jobId', validateJobIdParam, monitoringController.getExportDetail);
router.delete('/exports/:jobId', validateJobIdParam, monitoringController.deleteExport);

// --- Cache Management ---
router.get('/cache/stats', monitoringController.getCacheStats);
router.post('/cache/invalidate', validateCacheInvalidation, monitoringController.invalidateCache);
router.post('/cache/flush', flushLimiter, validateCacheFlush, monitoringController.flushCache);

module.exports = router;
