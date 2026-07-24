'use strict';

/**
 * @fileoverview Routes d'administration pour Hil_Delivre v4.
 * Préfixe : /api/admin
 * Toutes les routes nécessitent le rôle 'admin'.
 *
 * @module routes/adminRoutes
 */

const { Router } = require('express');
const kycController = require('../controllers/kycController');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate, schemas } = require('../middlewares/validationMiddleware');

const router = Router();

// Toutes les routes admin nécessitent authentification + rôle admin
router.use(authenticate);
router.use(requireRole('admin'));

// ============================================================
// ROUTES KYC ADMIN
// ============================================================

/**
 * GET /api/admin/kyc/pending
 * Lister les demandes KYC en attente.
 */
router.get('/kyc/pending', kycController.listPendingKYC);

/**
 * PUT /api/admin/kyc/:userId/review
 * Approuver ou rejeter une demande KYC.
 */
router.put(
  '/kyc/:userId/review',
  validate(schemas.kycReviewSchema),
  kycController.reviewKYC
);

module.exports = router;
