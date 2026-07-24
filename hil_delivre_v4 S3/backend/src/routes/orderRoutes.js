'use strict';

/**
 * @fileoverview Routes de gestion des commandes pour Hil_Delivre v4.
 * Préfixe : /api/orders
 *
 * @module routes/orderRoutes
 */

const { Router } = require('express');
const orderController = require('../controllers/orderController');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const {
  createOrderSchema,
  updateOrderStatusSchema,
  cancelOrderSchema,
} = require('../middlewares/validationSprint3');

const router = Router();

// Toutes les routes de commande nécessitent une authentification
router.use(authenticate);

// ============================================================
// ROUTES CLIENT
// ============================================================

/**
 * POST /api/orders
 * Créer une nouvelle commande.
 */
router.post(
  '/',
  requireRole('client'),
  validate(createOrderSchema),
  orderController.createOrder
);

/**
 * POST /api/orders/:orderId/cancel
 * Annuler une commande (client uniquement, si pending/accepted).
 */
router.post(
  '/:orderId/cancel',
  requireRole('client'),
  validate(cancelOrderSchema),
  orderController.cancelOrder
);

// ============================================================
// ROUTES COMMUNES (client, marchand, livreur, admin)
// ============================================================

/**
 * GET /api/orders
 * Liste des commandes de l'utilisateur authentifié.
 */
router.get(
  '/',
  requireRole('client', 'merchant', 'delivery', 'admin'),
  orderController.listOrders
);

/**
 * GET /api/orders/:orderId
 * Détails d'une commande spécifique.
 */
router.get(
  '/:orderId',
  requireRole('client', 'merchant', 'delivery', 'admin'),
  orderController.getOrderDetails
);

/**
 * PUT /api/orders/:orderId/status
 * Mettre à jour le statut d'une commande.
 * Transitions contrôlées par rôle.
 */
router.put(
  '/:orderId/status',
  requireRole('merchant', 'delivery', 'admin'),
  validate(updateOrderStatusSchema),
  orderController.updateOrderStatus
);

module.exports = router;
