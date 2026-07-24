// backend/src/controllers/subscriptionController.js - Contrôleur de gestion des abonnements

const Joi = require("joi");
const subscriptionService = require("../services/subscriptionService");
const responseHelper = require("../utils/responseHelper");
const auditService = require("../services/auditService");

// Schémas de validation Joi pour les requêtes
const getStatusSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

const initRenewalSchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

const getHistorySchema = Joi.object({
  userId: Joi.string().uuid().required(),
});

const adminGetExpiredSchema = Joi.object({}); // Pas de paramètres spécifiques pour l'instant
const adminGetStatsSchema = Joi.object({}); // Pas de paramètres spécifiques pour l'instant

const subscriptionController = {
  /**
   * @route GET /api/subscription/status
   * @desc Récupère le statut de l'abonnement de l'utilisateur authentifié.
   * @access Private (Authenticated User)
   */
  getStatus: async (req, res) => {
    const userId = req.user.id; // Récupéré du middleware d'authentification

    const { error: validationError } = getStatusSchema.validate({ userId });
    if (validationError) {
      return responseHelper.badRequest(res, validationError.details[0].message);
    }

    try {
      const status = await subscriptionService.getSubscriptionStatus(userId);
      await auditService.logActivity(userId, "SUBSCRIPTION_STATUS_VIEWED", `Statut d'abonnement consulté.`);
      return responseHelper.success(res, "Statut d'abonnement récupéré avec succès.", status);
    } catch (error) {
      console.error("Erreur dans subscriptionController.getStatus:", error.message);
      return responseHelper.error(res, error.message);
    }
  },

  /**
   * @route POST /api/subscription/renew
   * @desc Initie le processus de renouvellement de l'abonnement via PayDunya.
   * @access Private (Authenticated User)
   */
  initRenewal: async (req, res) => {
    const userId = req.user.id; // Récupéré du middleware d'authentification

    const { error: validationError } = initRenewalSchema.validate({ userId });
    if (validationError) {
      return responseHelper.badRequest(res, validationError.details[0].message);
    }

    try {
      const { payment_url } = await subscriptionService.initiateRenewal(userId);
      await auditService.logActivity(userId, "SUBSCRIPTION_RENEWAL_INITIATED", `Renouvellement d'abonnement initié.`);
      return responseHelper.success(res, "Renouvellement initié. Redirection vers PayDunya.", { payment_url });
    } catch (error) {
      console.error("Erreur dans subscriptionController.initRenewal:", error.message);
      return responseHelper.error(res, error.message);
    }
  },

  /**
   * @route GET /api/subscription/history
   * @desc Récupère l'historique des abonnements de l'utilisateur authentifié.
   * @access Private (Authenticated User)
   */
  getHistory: async (req, res) => {
    const userId = req.user.id; // Récupéré du middleware d'authentification

    const { error: validationError } = getHistorySchema.validate({ userId });
    if (validationError) {
      return responseHelper.badRequest(res, validationError.details[0].message);
    }

    try {
      const history = await subscriptionService.getSubscriptionHistory(userId);
      await auditService.logActivity(userId, "SUBSCRIPTION_HISTORY_VIEWED", `Historique d'abonnement consulté.`);
      return responseHelper.success(res, "Historique d'abonnement récupéré avec succès.", history);
    } catch (error) {
      console.error("Erreur dans subscriptionController.getHistory:", error.message);
      return responseHelper.error(res, error.message);
    }
  },

  /**
   * @route GET /api/admin/subscriptions/expired
   * @desc Récupère la liste des abonnements expirés (Admin uniquement).
   * @access Private (Admin Role)
   */
  adminGetExpired: async (req, res) => {
    const { error: validationError } = adminGetExpiredSchema.validate(req.query); // Valider les query params si besoin
    if (validationError) {
      return responseHelper.badRequest(res, validationError.details[0].message);
    }

    try {
      const expiredSubscriptions = await subscriptionService.getExpiredSubscriptions();
      await auditService.logActivity(req.user.id, "ADMIN_VIEWED_EXPIRED_SUBSCRIPTIONS", `Liste des abonnements expirés consultée.`);
      return responseHelper.success(res, "Abonnements expirés récupérés avec succès.", expiredSubscriptions);
    } catch (error) {
      console.error("Erreur dans subscriptionController.adminGetExpired:", error.message);
      return responseHelper.error(res, error.message);
    }
  },

  /**
   * @route GET /api/admin/subscriptions/stats
   * @desc Récupère des statistiques sur les abonnements (Admin uniquement).
   * @access Private (Admin Role)
   */
  adminGetStats: async (req, res) => {
    const { error: validationError } = adminGetStatsSchema.validate(req.query); // Valider les query params si besoin
    if (validationError) {
      return responseHelper.badRequest(res, validationError.details[0].message);
    }

    try {
      const stats = await subscriptionService.getSubscriptionStats();
      await auditService.logActivity(req.user.id, "ADMIN_VIEWED_SUBSCRIPTION_STATS", `Statistiques d'abonnement consultées.`);
      return responseHelper.success(res, "Statistiques d'abonnement récupérées avec succès.", stats);
    } catch (error) {
      console.error("Erreur dans subscriptionController.adminGetStats:", error.message);
      return responseHelper.error(res, error.message);
    }
  },
};

module.exports = subscriptionController;
