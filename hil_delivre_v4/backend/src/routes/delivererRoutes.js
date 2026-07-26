/**
 * @file delivererRoutes.js
 * @description Routes API pour les livreurs (réconciliation cash, solde).
 * Sprint 7 : le livreur peut consulter son solde et soumettre ses réconciliations.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const reconciliationService = require('../services/reconciliationService');
const { success, error: errorResponse } = require('../utils/responseHelper');

const router = express.Router();

router.use(authenticate);
router.use(requireRole('deliverer'));

const delivererRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { success: false, error: 'Rate limit exceeded', code: 429 }
});
router.use(delivererRateLimit);

// ============================================================================
// ROUTES LIVREUR — RÉCONCILIATION
// ============================================================================

/**
 * GET /api/deliverer/reconciliation
 * Liste des réconciliations du livreur connecté.
 */
router.get('/reconciliation', async (req, res) => {
  try {
    const { status, page, limit } = req.query;
    const result = await reconciliationService.getReconciliations({
      deliverer_id: req.user.id,
      status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20
    });
    return res.status(200).json(success(result, 'Reconciliations retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve reconciliations'));
  }
});

/**
 * GET /api/deliverer/balance
 * Solde cash actuel du livreur.
 */
router.get('/balance', async (req, res) => {
  try {
    const balance = await reconciliationService.getDelivererCashBalance(req.user.id);
    return res.status(200).json(success(balance, 'Balance retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve balance'));
  }
});

/**
 * POST /api/deliverer/reconciliation/:recordId/submit
 * Le livreur soumet sa réconciliation (confirme qu'il va payer).
 */
router.post('/reconciliation/:recordId/submit', async (req, res) => {
  try {
    const { recordId } = req.params;
    const { payment_reference } = req.body;

    const result = await reconciliationService.submitReconciliation(
      recordId,
      req.user.id,
      payment_reference
    );
    return res.status(200).json(success(result, 'Reconciliation submitted'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to submit' : err.message, statusCode)
    );
  }
});

module.exports = router;
