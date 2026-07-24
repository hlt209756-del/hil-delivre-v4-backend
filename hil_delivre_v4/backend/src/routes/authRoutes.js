'use strict';

/**
 * @fileoverview Routes d'authentification pour Hil_Delivre v4.
 * Préfixe : /api/auth
 *
 * @module routes/authRoutes
 */

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');
const { validate, schemas } = require('../middlewares/validationMiddleware');

const router = Router();

// ============================================================
// RATE LIMITERS SPÉCIFIQUES À L'AUTHENTIFICATION
// ============================================================

/**
 * Rate limiter strict pour les endpoints d'authentification.
 * 20 requêtes par fenêtre de 15 minutes par IP.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.',
    },
  },
  keyGenerator: (req) => {
    // Identifier par IP + email (si disponible) pour éviter le contournement
    const email = req.body?.email || '';
    return `${req.ip}-${email}`;
  },
});

/**
 * Rate limiter encore plus strict pour les tentatives de connexion échouées.
 * 5 tentatives par fenêtre de 15 minutes par IP.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Ne compter que les échecs
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_LOGIN_ATTEMPTS',
      message: 'Trop de tentatives de connexion échouées. Veuillez réessayer dans 15 minutes.',
    },
  },
});

/**
 * Rate limiter pour les demandes de réinitialisation de mot de passe.
 * 3 requêtes par heure par IP.
 */
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Trop de demandes de réinitialisation. Veuillez réessayer dans 1 heure.',
    },
  },
});

// ============================================================
// ROUTES PUBLIQUES
// ============================================================

/**
 * POST /api/auth/register
 * Inscription d'un nouvel utilisateur.
 */
router.post(
  '/register',
  authLimiter,
  validate(schemas.registerSchema),
  authController.register
);

/**
 * POST /api/auth/login
 * Connexion d'un utilisateur existant.
 */
router.post(
  '/login',
  loginLimiter,
  validate(schemas.loginSchema),
  authController.login
);

/**
 * POST /api/auth/refresh
 * Rafraîchir le token d'accès.
 */
router.post(
  '/refresh',
  authLimiter,
  validate(schemas.refreshTokenSchema),
  authController.refreshToken
);

/**
 * POST /api/auth/forgot-password
 * Demander un email de réinitialisation de mot de passe.
 */
router.post(
  '/forgot-password',
  passwordResetLimiter,
  validate(schemas.forgotPasswordSchema),
  authController.forgotPassword
);

/**
 * POST /api/auth/reset-password
 * Réinitialiser le mot de passe avec un token.
 */
router.post(
  '/reset-password',
  passwordResetLimiter,
  validate(schemas.resetPasswordSchema),
  authController.resetPassword
);

// ============================================================
// ROUTES AUTHENTIFIÉES
// ============================================================

/**
 * POST /api/auth/logout
 * Déconnexion de l'utilisateur.
 */
router.post(
  '/logout',
  authenticate,
  authController.logout
);

module.exports = router;
