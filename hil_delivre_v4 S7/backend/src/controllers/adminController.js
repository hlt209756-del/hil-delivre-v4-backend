/**
 * @file adminController.js
 * @description Contrôleur des endpoints d'administration (Sprint 7).
 */

'use strict';

const statsService = require('../services/statsService');
const reconciliationService = require('../services/reconciliationService');
const moderationService = require('../services/moderationService');
const { success, error: errorResponse } = require('../utils/responseHelper');

// ============================================================================
// CONTRÔLEURS — DASHBOARD & STATS
// ============================================================================

/**
 * GET /api/admin/dashboard
 * Métriques temps réel du dashboard.
 */
async function getDashboard(req, res) {
  try {
    const metrics = await statsService.getDashboardMetrics();
    return res.status(200).json(success(metrics, 'Dashboard metrics retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve dashboard metrics'));
  }
}

/**
 * GET /api/admin/stats
 * Statistiques historiques (par période).
 */
async function getStats(req, res) {
  try {
    const { start_date, end_date } = req.query;
    const stats = await statsService.getHistoricalStats({ start_date, end_date });
    return res.status(200).json(success(stats, 'Historical stats retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve stats'));
  }
}

/**
 * GET /api/admin/stats/top-merchants
 * Top marchands par volume.
 */
async function getTopMerchants(req, res) {
  try {
    const { limit = 10, period_days = 30 } = req.query;
    const data = await statsService.getTopMerchants({
      limit: parseInt(limit, 10),
      period_days: parseInt(period_days, 10)
    });
    return res.status(200).json(success(data, 'Top merchants retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve top merchants'));
  }
}

/**
 * GET /api/admin/stats/top-deliverers
 * Top livreurs par performance.
 */
async function getTopDeliverers(req, res) {
  try {
    const { limit = 10, period_days = 30 } = req.query;
    const data = await statsService.getTopDeliverers({
      limit: parseInt(limit, 10),
      period_days: parseInt(period_days, 10)
    });
    return res.status(200).json(success(data, 'Top deliverers retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve top deliverers'));
  }
}

/**
 * POST /api/admin/stats/calculate
 * Déclenche le calcul des stats quotidiennes.
 */
async function calculateDailyStats(req, res) {
  try {
    const { date } = req.body;
    const result = await statsService.triggerDailyStatsCalculation(date);
    return res.status(200).json(success(result, 'Daily stats calculated'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to calculate stats'));
  }
}

// ============================================================================
// CONTRÔLEURS — GESTION UTILISATEURS
// ============================================================================

/**
 * GET /api/admin/users
 * Liste des utilisateurs (paginée, filtrée).
 */
async function getUsers(req, res) {
  try {
    const { role, status, search, page, limit, sort_by, sort_order } = req.query;
    const result = await moderationService.getUsers({
      role, status, search,
      page: parseInt(page, 10) || 1,
      limit: Math.min(parseInt(limit, 10) || 20, 100),
      sort_by, sort_order
    });
    return res.status(200).json(success(result, 'Users retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve users'));
  }
}

/**
 * GET /api/admin/users/:userId
 * Détail complet d'un utilisateur.
 */
async function getUserDetail(req, res) {
  try {
    const { userId } = req.params;
    const detail = await moderationService.getUserDetail(userId);
    return res.status(200).json(success(detail, 'User detail retrieved'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to retrieve user' : err.message, statusCode)
    );
  }
}

/**
 * POST /api/admin/users/:userId/suspend
 * Suspend un utilisateur.
 */
async function suspendUser(req, res) {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    const result = await moderationService.suspendUser(userId, adminId, reason);
    return res.status(200).json(success(result, 'User suspended'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to suspend user' : err.message, statusCode)
    );
  }
}

/**
 * POST /api/admin/users/:userId/unsuspend
 * Réactive un utilisateur.
 */
async function unsuspendUser(req, res) {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;

    const result = await moderationService.unsuspendUser(userId, adminId);
    return res.status(200).json(success(result, 'User unsuspended'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to unsuspend user' : err.message, statusCode)
    );
  }
}

/**
 * DELETE /api/admin/users/:userId
 * Supprime un utilisateur (anonymisation CIL).
 */
async function deleteUser(req, res) {
  try {
    const { userId } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    const result = await moderationService.deleteUser(userId, adminId, reason);
    return res.status(200).json(success(result, 'User deleted'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to delete user' : err.message, statusCode)
    );
  }
}

// ============================================================================
// CONTRÔLEURS — RÉCONCILIATION CASH
// ============================================================================

/**
 * POST /api/admin/reconciliation/generate
 * Génère un enregistrement de réconciliation.
 */
async function generateReconciliation(req, res) {
  try {
    const { deliverer_id, period_start, period_end } = req.body;
    const record = await reconciliationService.generateReconciliation(
      deliverer_id, period_start, period_end
    );
    return res.status(201).json(success(record, 'Reconciliation generated'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to generate reconciliation' : err.message, statusCode)
    );
  }
}

/**
 * GET /api/admin/reconciliation
 * Liste des réconciliations (filtrées).
 */
async function getReconciliations(req, res) {
  try {
    const { deliverer_id, status, page, limit } = req.query;
    const result = await reconciliationService.getReconciliations({
      deliverer_id, status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20
    });
    return res.status(200).json(success(result, 'Reconciliations retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve reconciliations'));
  }
}

/**
 * POST /api/admin/reconciliation/:recordId/confirm
 * Confirme une réconciliation.
 */
async function confirmReconciliation(req, res) {
  try {
    const { recordId } = req.params;
    const adminId = req.user.id;

    const result = await reconciliationService.confirmReconciliation(recordId, adminId);
    return res.status(200).json(success(result, 'Reconciliation confirmed'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to confirm' : err.message, statusCode)
    );
  }
}

/**
 * POST /api/admin/reconciliation/:recordId/dispute
 * Conteste une réconciliation.
 */
async function disputeReconciliation(req, res) {
  try {
    const { recordId } = req.params;
    const adminId = req.user.id;
    const { reason } = req.body;

    const result = await reconciliationService.disputeReconciliation(recordId, adminId, reason);
    return res.status(200).json(success(result, 'Reconciliation disputed'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to dispute' : err.message, statusCode)
    );
  }
}

/**
 * GET /api/admin/reconciliation/balance/:delivererId
 * Solde cash d'un livreur.
 */
async function getDelivererBalance(req, res) {
  try {
    const { delivererId } = req.params;
    const balance = await reconciliationService.getDelivererCashBalance(delivererId);
    return res.status(200).json(success(balance, 'Balance retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve balance'));
  }
}

// ============================================================================
// CONTRÔLEURS — PAYOUTS MARCHANDS
// ============================================================================

/**
 * POST /api/admin/payouts/generate
 * Génère un payout marchand.
 */
async function generatePayout(req, res) {
  try {
    const { merchant_id, period_start, period_end } = req.body;
    const payout = await moderationService.generateMerchantPayout(
      merchant_id, period_start, period_end
    );
    return res.status(201).json(success(payout, 'Payout generated'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to generate payout'));
  }
}

/**
 * GET /api/admin/payouts
 * Liste des payouts (filtrés).
 */
async function getPayouts(req, res) {
  try {
    const { merchant_id, status, page, limit } = req.query;
    const result = await moderationService.getPayouts({
      merchant_id, status,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20
    });
    return res.status(200).json(success(result, 'Payouts retrieved'));
  } catch (err) {
    return res.status(500).json(errorResponse('Failed to retrieve payouts'));
  }
}

/**
 * POST /api/admin/payouts/:payoutId/approve
 * Approuve un payout.
 */
async function approvePayout(req, res) {
  try {
    const { payoutId } = req.params;
    const adminId = req.user.id;
    const { payment_reference } = req.body;

    const result = await moderationService.approvePayout(payoutId, adminId, payment_reference);
    return res.status(200).json(success(result, 'Payout approved'));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(statusCode === 500 ? 'Failed to approve payout' : err.message, statusCode)
    );
  }
}

module.exports = {
  getDashboard,
  getStats,
  getTopMerchants,
  getTopDeliverers,
  calculateDailyStats,
  getUsers,
  getUserDetail,
  suspendUser,
  unsuspendUser,
  deleteUser,
  generateReconciliation,
  getReconciliations,
  confirmReconciliation,
  disputeReconciliation,
  getDelivererBalance,
  generatePayout,
  getPayouts,
  approvePayout
};
