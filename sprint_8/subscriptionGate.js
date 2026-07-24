// backend/src/middlewares/subscriptionGate.js - Middleware de vérification d'abonnement (Gating)

const { supabaseAdmin } = require("../config/supabase");
const dayjs = require("dayjs");
const responseHelper = require("../utils/responseHelper");

/**
 * Middleware de gating pour bloquer les marchands/livreurs dont l'abonnement est expiré.
 * Retourne un statut 403 avec un payload spécifique si l'abonnement est expiré.
 * Ne s'applique pas aux rôles 'client' et 'admin'.
 * Ne s'applique pas aux routes de renouvellement d'abonnement.
 */
const subscriptionGate = async (req, res, next) => {
  // Supposons que req.user est déjà peuplé par authMiddleware
  if (!req.user || !req.user.id) {
    return responseHelper.unauthorized(res, "Authentification requise.");
  }

  const userId = req.user.id;

  try {
    const { data: profile, error } = await supabaseAdmin
      .from("profiles_data")
      .select("role, subscription_expires_at, subscription_status")
      .eq("user_id", userId)
      .single();

    if (error || !profile) {
      console.error(`Erreur ou profil introuvable pour l'utilisateur ${userId}:`, error?.message);
      return responseHelper.forbidden(res, "Accès refusé: Profil utilisateur introuvable.");
    }

    // Les clients et les administrateurs ne sont pas soumis au gating d'abonnement
    if (profile.role === "client" || profile.role === "admin") {
      return next();
    }

    // Les marchands et livreurs sont soumis au gating
    if (profile.role === "merchant" || profile.role === "delivery") {
      // Vérifier si la route actuelle est une route de renouvellement d'abonnement
      // Cela permet aux utilisateurs expirés d'accéder à la page de renouvellement
      if (req.path.includes("/api/subscription/renew") || req.path.includes("/api/subscription/status")) {
        return next();
      }

      if (!profile.subscription_expires_at || dayjs(profile.subscription_expires_at).isBefore(dayjs())) {
        // L'abonnement est expiré ou non défini
        await notificationService.sendNotification(
          userId,
          "SUBSCRIPTION_BLOCKED",
          `Votre compte a été bloqué car votre abonnement ${profile.role} a expiré. Veuillez le renouveler.`
        );
        await auditService.logActivity(userId, "ACCOUNT_BLOCKED_SUBSCRIPTION_EXPIRED", `Compte bloqué en raison de l'expiration de l'abonnement.`);

        return res.status(403).json({
          success: false,
          message: "Votre abonnement a expiré. Veuillez le renouveler.",
          blocked: true,
          reason: "subscription_expired",
          renewal_url: "/subscription/renew", // URL front-end vers la page de renouvellement
        });
      }
    }

    // Si l'abonnement est actif ou si l'utilisateur n'est pas soumis au gating, continuer
    next();
  } catch (error) {
    console.error("Erreur inattendue dans le middleware subscriptionGate:", error.message);
    return responseHelper.serverError(res, "Erreur interne du serveur lors de la vérification de l'abonnement.");
  }
};

module.exports = subscriptionGate;
