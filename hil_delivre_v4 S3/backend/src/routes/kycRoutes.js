'use strict';

/**
 * @fileoverview Routes KYC pour Hil_Delivre v4.
 * Routes utilisateur : /api/user/kyc (préfixées dans profileRoutes ou montées séparément)
 * Routes admin : /api/admin/kyc
 *
 * @module routes/kycRoutes
 */

const { Router } = require('express');
const kycController = require('../controllers/kycController');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate, schemas } = require('../middlewares/validationMiddleware');

const router = Router();

// Toutes les routes KYC nécessitent une authentification
router.use(authenticate);

// ============================================================
// ROUTES UTILISATEUR (marchands/livreurs)
// ============================================================

/**
 * POST /api/user/kyc
 * Soumettre une demande KYC.
 * Le schéma de validation est déterminé dynamiquement selon le requested_role.
 */
router.post(
  '/',
  (req, res, next) => {
    // Validation dynamique selon le rôle demandé
    const requestedRole = req.body?.requested_role;

    if (requestedRole === 'merchant') {
      return validate(schemas.kycMerchantSchema)(req, res, next);
    } else if (requestedRole === 'delivery') {
      return validate(schemas.kycDeliverySchema)(req, res, next);
    }

    // Si le rôle n'est pas reconnu, laisser Joi gérer l'erreur
    return validate(schemas.kycMerchantSchema)(req, res, next);
  },
  kycController.submitKYC
);

/**
 * GET /api/user/kyc/status
 * Récupérer le statut KYC de l'utilisateur.
 */
router.get('/status', kycController.getKYCStatus);

module.exports = router;
