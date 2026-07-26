'use strict';

/**
 * @fileoverview Contrôleur de monitoring pour le Sprint 10 de Hil_Delivre v4.
 * Gère les endpoints de health checks, métriques Prometheus, exports CSV et cache.
 * @module controllers/monitoringController
 */

const healthService = require('../services/healthService');
const metricsService = require('../services/metricsService');
const exportService = require('../services/exportService');
const cacheService = require('../services/cacheService');

/**
 * GET /api/monitoring/health
 * Retourne l'état de santé agrégé de tous les services.
 * Accessible uniquement aux administrateurs.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getHealthStatus = async (req, res) => {
  try {
    const results = await healthService.runAllChecks();

    const statusCode = results.status === 'healthy' ? 200
      : results.status === 'degraded' ? 200
      : 503;

    return res.status(statusCode).json({
      success: true,
      data: {
        status: results.status,
        timestamp: results.timestamp,
        services: results.services,
        uptime: process.uptime(),
        version: process.env.APP_VERSION || '4.10.0',
      },
    });
  } catch (error) {
    console.error('[MonitoringController] getHealthStatus error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification de santé des services.',
    });
  }
};

/**
 * GET /api/monitoring/health/:service
 * Retourne l'état de santé d'un service spécifique.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getServiceHealth = async (req, res) => {
  try {
    const { service } = req.params;
    const validServices = ['postgresql', 'redis', 'osrm', 'socketio', 'disk', 'memory'];

    if (!validServices.includes(service)) {
      return res.status(400).json({
        success: false,
        error: `Service invalide. Services disponibles : ${validServices.join(', ')}`,
      });
    }

    const methodMap = {
      postgresql: 'checkPostgreSQL',
      redis: 'checkRedis',
      osrm: 'checkOSRM',
      socketio: 'checkSocketIO',
      disk: 'checkDiskSpace',
      memory: 'checkMemory',
    };

    const result = await healthService[methodMap[service]]();
    const statusCode = result.status === 'healthy' ? 200 : result.status === 'degraded' ? 200 : 503;

    return res.status(statusCode).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[MonitoringController] getServiceHealth error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la vérification du service.',
    });
  }
};

/**
 * GET /api/monitoring/metrics
 * Retourne les métriques au format Prometheus text exposition.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getMetrics = async (req, res) => {
  try {
    const metrics = await metricsService.getMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.status(200).send(metrics);
  } catch (error) {
    console.error('[MonitoringController] getMetrics error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des métriques.',
    });
  }
};

/**
 * GET /api/monitoring/metrics/json
 * Retourne les métriques au format JSON (pour dashboards internes).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getMetricsJson = async (req, res) => {
  try {
    const metrics = await metricsService.getMetricsJson();
    return res.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    console.error('[MonitoringController] getMetricsJson error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des métriques JSON.',
    });
  }
};

/**
 * POST /api/monitoring/exports
 * Crée un nouveau job d'export CSV asynchrone.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const createExport = async (req, res) => {
  try {
    const { export_type, filters } = req.body;
    const adminId = req.user.id;

    const job = await exportService.createExportJob({
      adminId,
      exportType: export_type,
      filters: filters || {},
    });

    return res.status(202).json({
      success: true,
      message: 'Export initié avec succès. Le fichier sera disponible sous peu.',
      data: {
        job_id: job.id,
        status: job.status,
        export_type: job.export_type,
        created_at: job.created_at,
      },
    });
  } catch (error) {
    console.error('[MonitoringController] createExport error:', error.message);

    if (error.message === 'RATE_LIMIT_EXCEEDED') {
      return res.status(429).json({
        success: false,
        error: 'Limite d\'exports atteinte. Maximum 5 exports par heure.',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la création de l\'export.',
    });
  }
};

/**
 * GET /api/monitoring/exports
 * Liste les jobs d'export de l'administrateur connecté.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const listExports = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { status, cursor, limit } = req.query;

    const result = await exportService.listExportJobs({
      adminId,
      status: status || null,
      cursor: cursor || null,
      limit: Math.min(parseInt(limit, 10) || 20, 50),
    });

    return res.status(200).json({
      success: true,
      data: result.jobs,
      pagination: {
        next_cursor: result.nextCursor,
        has_more: result.hasMore,
      },
    });
  } catch (error) {
    console.error('[MonitoringController] listExports error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des exports.',
    });
  }
};

/**
 * GET /api/monitoring/exports/:jobId
 * Récupère le détail et le lien de téléchargement d'un export.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getExportDetail = async (req, res) => {
  try {
    const { jobId } = req.params;
    const adminId = req.user.id;

    const job = await exportService.getExportJob(jobId, adminId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Export non trouvé.',
      });
    }

    return res.status(200).json({
      success: true,
      data: job,
    });
  } catch (error) {
    console.error('[MonitoringController] getExportDetail error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération du détail de l\'export.',
    });
  }
};

/**
 * DELETE /api/monitoring/exports/:jobId
 * Annule un export en cours ou supprime un export terminé.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const deleteExport = async (req, res) => {
  try {
    const { jobId } = req.params;
    const adminId = req.user.id;

    await exportService.deleteExportJob(jobId, adminId);

    return res.status(200).json({
      success: true,
      message: 'Export supprimé avec succès.',
    });
  } catch (error) {
    console.error('[MonitoringController] deleteExport error:', error.message);

    if (error.message === 'EXPORT_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: 'Export non trouvé.',
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la suppression de l\'export.',
    });
  }
};

/**
 * POST /api/monitoring/cache/invalidate
 * Invalide un pattern de cache Redis.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const invalidateCache = async (req, res) => {
  try {
    const { pattern, reason } = req.body;
    const adminId = req.user.id;

    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'Le champ "pattern" est requis.',
      });
    }

    const count = await cacheService.invalidatePattern(pattern, adminId, reason);

    return res.status(200).json({
      success: true,
      message: `${count} clé(s) de cache invalidée(s).`,
      data: { invalidated_count: count, pattern },
    });
  } catch (error) {
    console.error('[MonitoringController] invalidateCache error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'invalidation du cache.',
    });
  }
};

/**
 * GET /api/monitoring/cache/stats
 * Retourne les statistiques du cache Redis (hit/miss ratio, mémoire).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getCacheStats = async (req, res) => {
  try {
    const stats = cacheService.getStats();

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('[MonitoringController] getCacheStats error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques du cache.',
    });
  }
};

/**
 * POST /api/monitoring/cache/flush
 * Vide entièrement le cache Redis. Action critique.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const flushCache = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { confirm } = req.body;

    if (confirm !== 'FLUSH_ALL_CACHE') {
      return res.status(400).json({
        success: false,
        error: 'Confirmation requise. Envoyez {"confirm": "FLUSH_ALL_CACHE"} pour confirmer.',
      });
    }

    await cacheService.flush(adminId, 'Manual flush by admin');

    return res.status(200).json({
      success: true,
      message: 'Cache vidé avec succès.',
    });
  } catch (error) {
    console.error('[MonitoringController] flushCache error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Erreur lors du vidage du cache.',
    });
  }
};

module.exports = {
  getHealthStatus,
  getServiceHealth,
  getMetrics,
  getMetricsJson,
  createExport,
  listExports,
  getExportDetail,
  deleteExport,
  invalidateCache,
  getCacheStats,
  flushCache,
};
