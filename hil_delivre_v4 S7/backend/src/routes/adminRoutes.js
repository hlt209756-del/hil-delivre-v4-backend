/**
 * @file adminRoutes.js
 * @description Routes API d'administration (Sprint 7).
 * Toutes les routes nécessitent le rôle 'admin'.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const adminController = require('../controllers/adminController');
const {
  suspendUserSchema,
  deleteUserSchema,
  generateReconciliationSchema,
  disputeSchema,
  generatePayoutSchema,
  approvePayoutSchema,
  statsQuerySchema,
  calculateStatsSchema
} = require('../middlewares/validationSprint7');

const router = express.Router();

// Toutes les routes admin nécessitent authentification + rôle admin
router.use(authenticate);
router.use(requireRole('admin'));

// Rate limiter global admin
const adminRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { success: false, error: 'Admin rate limit exceeded', code: 429 }
});
router.use(adminRateLimit);

// ============================================================================
// DASHBOARD & STATS
// ============================================================================

router.get('/dashboard', adminController.getDashboard);
router.get('/stats', validate(statsQuerySchema, 'query'), adminController.getStats);
router.get('/stats/top-merchants', adminController.getTopMerchants);
router.get('/stats/top-deliverers', adminController.getTopDeliverers);
router.post('/stats/calculate', validate(calculateStatsSchema, 'body'), adminController.calculateDailyStats);

// ============================================================================
// GESTION UTILISATEURS
// ============================================================================

router.get('/users', adminController.getUsers);
router.get('/users/:userId', adminController.getUserDetail);
router.post('/users/:userId/suspend', validate(suspendUserSchema, 'body'), adminController.suspendUser);
router.post('/users/:userId/unsuspend', adminController.unsuspendUser);
router.delete('/users/:userId', validate(deleteUserSchema, 'body'), adminController.deleteUser);

// ============================================================================
// RÉCONCILIATION CASH
// ============================================================================

router.get('/reconciliation', adminController.getReconciliations);
router.post('/reconciliation/generate', validate(generateReconciliationSchema, 'body'), adminController.generateReconciliation);
router.post('/reconciliation/:recordId/confirm', adminController.confirmReconciliation);
router.post('/reconciliation/:recordId/dispute', validate(disputeSchema, 'body'), adminController.disputeReconciliation);
router.get('/reconciliation/balance/:delivererId', adminController.getDelivererBalance);

// ============================================================================
// PAYOUTS MARCHANDS
// ============================================================================

router.get('/payouts', adminController.getPayouts);
router.post('/payouts/generate', validate(generatePayoutSchema, 'body'), adminController.generatePayout);
router.post('/payouts/:payoutId/approve', validate(approvePayoutSchema, 'body'), adminController.approvePayout);

module.exports = router;
