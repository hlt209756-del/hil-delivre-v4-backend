'use strict';

/**
 * @fileoverview Routes de gestion des menus pour Hil_Delivre v4.
 *
 * Routes publiques :
 *   GET /api/merchants — Liste des marchands
 *   GET /api/merchants/:merchantId/menu — Menu d'un marchand
 *
 * Routes marchands (authentifiées) :
 *   GET /api/menu/my-items — Mes articles
 *   POST /api/menu/items — Créer un article
 *   PUT /api/menu/items/:itemId — Modifier un article
 *   DELETE /api/menu/items/:itemId — Supprimer un article
 *
 * @module routes/menuRoutes
 */

const { Router } = require('express');
const menuController = require('../controllers/menuController');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole, requireKYC } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const {
  createMenuItemSchema,
  updateMenuItemSchema,
} = require('../middlewares/validationSprint3');

const router = Router();

// ============================================================
// ROUTES PUBLIQUES (marchands et menus)
// ============================================================

/**
 * GET /api/merchants
 * Liste des marchands actifs.
 */
router.get('/merchants', menuController.listMerchants);

/**
 * GET /api/merchants/:merchantId/menu
 * Menu d'un marchand spécifique.
 */
router.get('/merchants/:merchantId/menu', menuController.getMerchantMenu);

// ============================================================
// ROUTES MARCHANDS (CRUD articles)
// ============================================================

/**
 * GET /api/menu/my-items
 * Liste des articles du marchand authentifié.
 */
router.get(
  '/menu/my-items',
  authenticate,
  requireRole('merchant', 'admin'),
  requireKYC,
  menuController.getMyMenuItems
);

/**
 * POST /api/menu/items
 * Créer un nouvel article de menu.
 */
router.post(
  '/menu/items',
  authenticate,
  requireRole('merchant', 'admin'),
  requireKYC,
  validate(createMenuItemSchema),
  menuController.createMenuItem
);

/**
 * PUT /api/menu/items/:itemId
 * Mettre à jour un article de menu.
 */
router.put(
  '/menu/items/:itemId',
  authenticate,
  requireRole('merchant', 'admin'),
  requireKYC,
  validate(updateMenuItemSchema),
  menuController.updateMenuItem
);

/**
 * DELETE /api/menu/items/:itemId
 * Supprimer un article de menu (soft-delete).
 */
router.delete(
  '/menu/items/:itemId',
  authenticate,
  requireRole('merchant', 'admin'),
  requireKYC,
  menuController.deleteMenuItem
);

module.exports = router;
