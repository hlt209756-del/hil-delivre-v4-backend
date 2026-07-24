'use strict';

/**
 * @fileoverview Routes de gestion du profil utilisateur pour Hil_Delivre v4.
 * Préfixe : /api/user
 *
 * @module routes/profileRoutes
 */

const { Router } = require('express');
const profileController = require('../controllers/profileController');
const { authenticate } = require('../middlewares/authMiddleware');
const { validate, schemas } = require('../middlewares/validationMiddleware');

const router = Router();

// Toutes les routes de profil nécessitent une authentification
router.use(authenticate);

/**
 * GET /api/user/profile
 * Récupérer le profil de l'utilisateur authentifié.
 */
router.get('/profile', profileController.getProfile);

/**
 * PUT /api/user/profile
 * Mettre à jour le profil de l'utilisateur authentifié.
 */
router.put(
  '/profile',
  validate(schemas.updateProfileSchema),
  profileController.updateProfile
);

/**
 * DELETE /api/user/profile
 * Supprimer le compte (droit CIL — droit à l'effacement).
 */
router.delete('/profile', profileController.deleteProfile);

module.exports = router;
