'use strict';

/**
 * @fileoverview Routes pour les endpoints de certification hygiène.
 * @module routes/certificationRoutes
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const certificationController = require('../controllers/certificationController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const {
    validateCertificationIdParams,
    validateApproveCertification,
    validateRevokeCertification,
    validateAdminCertificationsQuery
} = require('../middlewares/validationSprint9');

// ============================================================================
// Rate Limiters
// ============================================================================

const merchantCertLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 5,
    message: { success: false, message: 'Trop de demandes de certification. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

const merchantReadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: { success: false, message: 'Trop de requêtes. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

const adminCertLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    message: { success: false, message: 'Trop de requêtes admin. Réessayez plus tard.', error: 'RATE_LIMIT_EXCEEDED' }
});

// ============================================================================
// Routes marchand
// ============================================================================

/**
 * POST /api/merchant/certify
 * Demande une certification hygiène
 */
router.post(
    '/merchant/certify',
    authenticate,
    authorize(['merchant']),
    merchantCertLimiter,
    certificationController.requestCertification
);

/**
 * POST /api/merchant/certify/renew
 * Renouvelle une certification expirée
 */
router.post(
    '/merchant/certify/renew',
    authenticate,
    authorize(['merchant']),
    merchantCertLimiter,
    certificationController.renewCertification
);

/**
 * GET /api/merchant/certification
 * Récupère le statut de certification du marchand connecté
 */
router.get(
    '/merchant/certification',
    authenticate,
    authorize(['merchant']),
    merchantReadLimiter,
    certificationController.getMyStatus
);

// ============================================================================
// Routes admin
// ============================================================================

/**
 * GET /api/admin/certification-hygiene
 * Liste des certifications (paginée avec filtres)
 */
router.get(
    '/admin/certification-hygiene',
    authenticate,
    authorize(['admin']),
    adminCertLimiter,
    validateAdminCertificationsQuery,
    certificationController.adminGetCertifications
);

/**
 * PUT /api/admin/certification-hygiene/:certificationId/approve
 * Approuve une certification
 */
router.put(
    '/admin/certification-hygiene/:certificationId/approve',
    authenticate,
    authorize(['admin']),
    adminCertLimiter,
    validateCertificationIdParams,
    validateApproveCertification,
    certificationController.adminApprove
);

/**
 * PUT /api/admin/certification-hygiene/:certificationId/revoke
 * Révoque une certification
 */
router.put(
    '/admin/certification-hygiene/:certificationId/revoke',
    authenticate,
    authorize(['admin']),
    adminCertLimiter,
    validateCertificationIdParams,
    validateRevokeCertification,
    certificationController.adminRevoke
);

/**
 * POST /api/admin/certification-hygiene/check-expirations
 * Déclenche la vérification des expirations
 */
router.post(
    '/admin/certification-hygiene/check-expirations',
    authenticate,
    authorize(['admin']),
    adminCertLimiter,
    certificationController.adminCheckExpirations
);

module.exports = router;
