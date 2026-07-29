// backend/src/routes/subscriptionRoutes.js - Routes API pour la gestion des abonnements

const express = require("express");
const subscriptionController = require("../controllers/subscriptionController");
const authMiddleware = require("../middlewares/authMiddleware"); // Supposé exister du Sprint 2
const roleMiddleware = require("../middlewares/roleMiddleware"); // Supposé exister du Sprint 2
const subscriptionGate = require("../middlewares/subscriptionGate"); // À implémenter dans ce sprint
const { rateLimiter } = require("../middlewares/rateLimiter"); // Supposé exister du Sprint 2

const router = express.Router();

// Routes accessibles aux utilisateurs authentifiés (marchands et livreurs)
router.use(authMiddleware.authenticate); // Toutes les routes ci-dessous nécessitent une authentification

// Récupérer le statut de l'abonnement de l'utilisateur
router.get(
  "/status",
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 100 }), // 100 requêtes par 15 minutes
  subscriptionController.getStatus
);

// Initier le renouvellement de l'abonnement
// Cette route doit être accessible même si l'abonnement est expiré pour permettre le renouvellement
router.post(
  "/renew",
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }), // 10 requêtes par 15 minutes pour éviter les abus
  // Le middleware subscriptionGate ne doit PAS bloquer cette route pour les utilisateurs expirés
  subscriptionController.initRenewal
);

// Récupérer l'historique des abonnements de l'utilisateur
router.get(
  "/history",
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 50 }), // 50 requêtes par 15 minutes
  subscriptionController.getHistory
);

// Routes d'administration (nécessitent le rôle 'admin')
router.use(roleMiddleware.requireRole("admin")); // Toutes les routes ci-dessous nécessitent le rôle admin

// Récupérer la liste des abonnements expirés
router.get(
  "/admin/expired",
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }), // 20 requêtes par 15 minutes
  subscriptionController.adminGetExpired
);

// Récupérer les statistiques d'abonnement
router.get(
  "/admin/stats",
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }), // 20 requêtes par 15 minutes
  subscriptionController.adminGetStats
);

module.exports = router;
