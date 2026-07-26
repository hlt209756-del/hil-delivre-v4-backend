/**
 * @file otpRoutes.js
 * @description Routes API pour la vérification OTP par SMS (Sprint 6).
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const notificationController = require('../controllers/notificationController');
const { sendOTPSchema, verifyOTPSchema } = require('../middlewares/validationSprint6');

const router = express.Router();

// ============================================================================
// RATE LIMITERS
// ============================================================================

/**
 * Rate limiter strict pour l'envoi d'OTP.
 * 3 requêtes par numéro par heure (géré aussi côté service).
 */
const otpSendRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5,
  message: { success: false, error: 'Too many OTP requests. Try again later.', code: 429 },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `otp-send-${req.body?.phone_number || req.ip}`
});

/**
 * Rate limiter pour la vérification d'OTP.
 * 10 tentatives par IP par 15 minutes.
 */
const otpVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many verification attempts. Try again later.', code: 429 },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/otp/send
 * Envoie un code OTP par SMS.
 * Auth : JWT requis (l'utilisateur doit être connecté pour vérifier son téléphone).
 */
router.post(
  '/send',
  authenticate,
  otpSendRateLimit,
  validate(sendOTPSchema, 'body'),
  notificationController.sendOTP
);

/**
 * POST /api/otp/verify
 * Vérifie un code OTP.
 * Auth : JWT requis.
 */
router.post(
  '/verify',
  authenticate,
  otpVerifyRateLimit,
  validate(verifyOTPSchema, 'body'),
  notificationController.verifyOTP
);

module.exports = router;
