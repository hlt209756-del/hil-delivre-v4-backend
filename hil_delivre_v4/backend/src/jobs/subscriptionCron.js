// backend/src/jobs/subscriptionCron.js - Cron jobs pour la gestion des abonnements

const cron = require("node-cron");
const subscriptionService = require("../services/subscriptionService");
const { supabaseAdmin } = require("../config/supabase");

/**
 * Tâche planifiée quotidienne pour envoyer les notifications d'expiration d'abonnement (J-7, J-3, J-0).
 * S'exécute tous les jours à minuit.
 */
cron.schedule("0 0 * * *", async () => {
  console.log("🚀 Exécution du cron job: processExpirationNotifications");
  try {
    await subscriptionService.processExpirationNotifications();
    console.log("✅ Cron job processExpirationNotifications terminé avec succès.");
  } catch (error) {
    console.error("❌ Erreur lors de l'exécution du cron job processExpirationNotifications:", error.message);
  }
}, {
  scheduled: true,
  timezone: "Africa/Ouagadougou" // Ou le fuseau horaire pertinent pour l'Afrique de l'Ouest
});

/**
 * Tâche planifiée horaire pour bloquer les comptes dont l'abonnement est expiré.
 * S'exécute toutes les heures à la 0ème minute.
 * Appelle la fonction PL/pgSQL `check_expired_subscriptions()` pour mettre à jour la base de données.
 */
cron.schedule("0 * * * *", async () => {
  console.log("🚀 Exécution du cron job: blockExpiredAccounts");
  try {
    // Appelle la fonction PL/pgSQL pour mettre à jour les statuts d'abonnement
    const { error } = await supabaseAdmin.rpc("check_expired_subscriptions");

    if (error) {
      throw new Error(`Erreur lors de l'appel de la fonction PL/pgSQL: ${error.message}`);
    }

    console.log("✅ Cron job blockExpiredAccounts terminé avec succès.");
  } catch (error) {
    console.error("❌ Erreur lors de l'exécution du cron job blockExpiredAccounts:", error.message);
  }
}, {
  scheduled: true,
  timezone: "Africa/Ouagadougou"
});

console.log("Cron jobs d'abonnement initialisés.");
