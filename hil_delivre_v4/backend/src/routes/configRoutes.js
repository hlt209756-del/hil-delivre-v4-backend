/**
 * @file configRoutes.js
 * @description Routes API pour la gestion de la configuration plateforme (Sprint 4).
 * Accessible uniquement par les administrateurs pour la modification.
 * Lecture publique pour les taux affichés côté client.
 */

'use strict';

const express = require('express');
const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { validate } = require('../middlewares/validationMiddleware');
const platformConfigService = require('../services/platformConfigService');
const { success, error: errorResponse } = require('../utils/responseHelper');
const {
  updateConfigSchema,
  configKeyParamSchema
} = require('../middlewares/validationSprint4');

const router = express.Router();

// ============================================================================
// ROUTES PUBLIQUES (lecture des taux pour affichage)
// ============================================================================

/**
 * GET /api/config/rates
 * Récupère les taux publics nécessaires à l'affichage côté client.
 * (commission, TVA, frais de livraison)
 * Auth : Aucune (les taux sont publics pour la transparence).
 */
router.get('/rates', async (req, res) => {
  try {
    const rates = await platformConfigService.getOrderCalculationRates();

    return res.status(200).json(
      success(rates, 'Platform rates retrieved')
    );
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to retrieve platform rates')
    );
  }
});

// ============================================================================
// ROUTES ADMIN (gestion de la configuration)
// ============================================================================

/**
 * GET /api/admin/config
 * Récupère toutes les configurations de la plateforme.
 * Auth : JWT requis, rôle admin.
 */
router.get(
  '/',
  authenticate,
  requireRole('admin'),
  async (req, res) => {
    try {
      const configs = await platformConfigService.getAllConfigs();

      return res.status(200).json(
        success(configs, 'All platform configurations retrieved')
      );
    } catch (err) {
      return res.status(500).json(
        errorResponse('Failed to retrieve configurations')
      );
    }
  }
);

/**
 * GET /api/admin/config/:key
 * Récupère une configuration spécifique.
 * Auth : JWT requis, rôle admin.
 */
router.get(
  '/:key',
  authenticate,
  requireRole('admin'),
  validate(configKeyParamSchema, 'params'),
  async (req, res) => {
    try {
      const { key } = req.params;
      const value = await platformConfigService.getConfig(key);

      return res.status(200).json(
        success({ key, value }, 'Configuration retrieved')
      );
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 500;
      return res.status(statusCode).json(
        errorResponse(err.message, statusCode)
      );
    }
  }
);

/**
 * PUT /api/admin/config/:key
 * Met à jour une configuration spécifique.
 * Auth : JWT requis, rôle admin.
 */
router.put(
  '/:key',
  authenticate,
  requireRole('admin'),
  validate(configKeyParamSchema, 'params'),
  validate(updateConfigSchema, 'body'),
  async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      const adminId = req.user.id;

      const updated = await platformConfigService.updateConfig(key, value, adminId);

      return res.status(200).json(
        success(updated, `Configuration "${key}" updated successfully`)
      );
    } catch (err) {
      const statusCode = err.message.includes('not found') ? 404 : 500;
      return res.status(statusCode).json(
        errorResponse(err.message, statusCode)
      );
    }
  }
);

module.exports = router;
