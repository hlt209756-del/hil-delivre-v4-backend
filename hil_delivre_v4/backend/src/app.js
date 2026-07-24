/**
 * ============================================================
 * Hil_Delivre v4 — Application Express
 * Sprint 1 : Infrastructure
 * ============================================================
 * Ce fichier configure l'application Express avec tous les
 * middlewares de sécurité et les routes disponibles.
 * ============================================================
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');

// ============================================================
// Création de l'application
// ============================================================

const app = express();

// ============================================================
// Security — Helmet
// ============================================================

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: true,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hsts: {
      maxAge: 31536000, // 1 an
      includeSubDomains: true,
      preload: true,
    },
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  })
);

// ============================================================
// CORS — Whitelist restrictive
// ============================================================

const corsOptions = {
  origin: config.cors.origins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: true,
  maxAge: 600, // 10 minutes preflight cache
};

app.use(cors(corsOptions));

// ============================================================
// Rate Limiting — Global
// ============================================================

const globalRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes. Veuillez réessayer plus tard.',
  },
  handler: (req, res) => {
    res.status(429).json({
      error: 'Trop de requêtes. Veuillez réessayer plus tard.',
      retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
    });
  },
});

app.use(globalRateLimiter);

// ============================================================
// Body Parsing — Limite stricte 10kb
// ============================================================

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ============================================================
// Logging — Morgan (pas de console.log en production)
// ============================================================

if (config.env !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// ============================================================
// Routes — Health check
// ============================================================

const healthRoutes = require('./routes/healthRoutes');
app.use('/', healthRoutes);
app.use('/api', healthRoutes);

// ============================================================
// 404 Handler — Ne leak pas de détails en production
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Ressource non trouvée.',
    path: config.env === 'production' ? undefined : req.path,
  });
});

// ============================================================
// Error Handler Centralisé — Ne leak JAMAIS de détails en prod
// ============================================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // Log l'erreur côté serveur (jamais exposée au client en production)
  process.stderr.write(`[error] ${err.message}\n${err.stack || ''}\n`);

  if (config.env === 'production') {
    res.status(err.statusCode || 500).json({
      error: 'Erreur serveur interne.',
    });
  } else {
    res.status(err.statusCode || 500).json({
      error: err.message || 'Erreur serveur interne.',
      ...(err.stack && { stack: err.stack }),
    });
  }
});

// ============================================================
// Export
// ============================================================

module.exports = app;
