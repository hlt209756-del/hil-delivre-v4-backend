'use strict';

/**
 * @fileoverview Application Express principale pour Hil_Delivre v4.
 * Configure les middlewares de sécurité, les routes et la gestion d'erreurs.
 *
 * @module app
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const kycRoutes = require('./routes/kycRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// ============================================================
// MIDDLEWARES DE SÉCURITÉ
// ============================================================

/**
 * Helmet : headers de sécurité HTTP.
 * - CSP stricte
 * - HSTS
 * - Protection clickjacking (X-Frame-Options)
 * - Désactivation X-Powered-By
 */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", process.env.SUPABASE_URL || ''],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Nécessaire pour les images externes
}));

/**
 * CORS : whitelist restrictive d'origines.
 */
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Bloqué par la politique CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400, // Cache preflight 24h
}));

/**
 * Rate Limiting global : 100 requêtes par 15 minutes par IP.
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Trop de requêtes. Veuillez réessayer ultérieurement.',
    },
  },
});

app.use(globalLimiter);

// ============================================================
// MIDDLEWARES DE PARSING
// ============================================================

/**
 * Body parser JSON avec limite de taille (10kb) pour prévenir les attaques
 * par payload volumineux.
 */
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ============================================================
// LOGGING
// ============================================================

/**
 * Morgan : logging HTTP.
 * - 'combined' en production (format Apache)
 * - 'dev' en développement (coloré, concis)
 */
const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(logFormat));

// ============================================================
// ENDPOINTS DE SANTÉ
// ============================================================

/**
 * GET /health
 * Endpoint de santé pour les load balancers et le monitoring.
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

/**
 * GET /api/health
 * Endpoint de santé API.
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'hil-delivre-api',
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ============================================================
// ROUTES API
// ============================================================

app.use('/api/auth', authRoutes);
app.use('/api/user', profileRoutes);
app.use('/api/user/kyc', kycRoutes);
app.use('/api/admin', adminRoutes);

// ============================================================
// GESTION DES ERREURS
// ============================================================

/**
 * 404 : Route non trouvée.
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} introuvable.`,
    },
  });
});

/**
 * Gestionnaire d'erreurs global.
 * En production : aucun détail interne n'est exposé.
 * En développement : stack trace complète.
 */
app.use((err, req, res, _next) => {
  // Erreur CORS
  if (err.message === 'Bloqué par la politique CORS') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'CORS_BLOCKED',
        message: 'Origine non autorisée.',
      },
    });
  }

  // Erreur de parsing JSON
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Le corps de la requête contient du JSON invalide.',
      },
    });
  }

  // Erreur de payload trop volumineux
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      success: false,
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Le corps de la requête dépasse la taille maximale autorisée (10kb).',
      },
    });
  }

  // Erreur générique
  console.error('[ERROR HANDLER]', err.stack || err.message);

  const statusCode = err.statusCode || err.status || 500;
  const response = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Erreur interne du serveur.',
    },
  };

  // En développement, inclure les détails
  if (process.env.NODE_ENV !== 'production') {
    response.error.details = err.message;
    response.error.stack = err.stack;
  }

  return res.status(statusCode).json(response);
});

module.exports = app;
