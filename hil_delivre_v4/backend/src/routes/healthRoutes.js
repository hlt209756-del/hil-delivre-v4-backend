/**
 * ============================================================
 * Hil_Delivre v4 — Routeur Health Check
 * Sprint 1 : Infrastructure
 * ============================================================
 * Endpoint GET /health (et /api/health via le préfixe /api
 * ajouté dans app.js). Vérifie l'état de l'application et
 * effectue un health check léger sur Supabase.
 * ============================================================
 */

const { Router } = require('express');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const router = Router();

// ============================================================
// Rate limiting pour les endpoints sensibles (préparation Sprint 2+)
// ============================================================

const rateLimit = require('express-rate-limit');

const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes sur cet endpoint. Veuillez réessayer plus tard.',
  },
});

// Appliqué ici pour démontrer la structure — les endpoints sensibles
// des sprints suivants hériteront de ce middleware.
router.use('/sensitive', sensitiveRateLimiter);

// ============================================================
// GET /health
// ============================================================

router.get('/health', async (req, res) => {
  const healthData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '4.0.0-sprint1',
    environment: config.env,
    uptime: process.uptime(),
    services: {
      api: 'operational',
      database: 'checking...',
    },
  };

  // Health check léger sur Supabase (service_role_key pour auth interne)
  try {
    const supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { error } = await supabase
      .from('platform_config')
      .select('config_key')
      .limit(1);

    if (error) {
      healthData.services.database = 'error';
      healthData.status = 'degraded';
    } else {
      healthData.services.database = 'operational';
    }
  } catch {
    healthData.services.database = 'error';
    healthData.status = 'degraded';
  }

  const statusCode = healthData.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(healthData);
});

// ============================================================
// GET /health/ready (Kubernetes readiness probe — préparation)
// ============================================================

router.get('/health/ready', (req, res) => {
  res.status(200).json({
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// Export
// ============================================================

module.exports = router;
