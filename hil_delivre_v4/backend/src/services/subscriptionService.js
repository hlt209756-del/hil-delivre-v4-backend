// backend/src/services/subscriptionService.js - Service métier de gestion des abonnements
// Gère le cycle de vie complet des abonnements marchands/livreurs : création d'essai,
// renouvellement via PayDunya, expiration, notifications et statistiques admin.

const Joi = require("joi");
const dayjs = require("dayjs");
const { supabaseAdmin } = require("../config/supabase");
const notificationService = require("./notificationService");
const paymentService = require("./paymentService");
const auditService = require("./auditService");

const userIdSchema = Joi.string().uuid().required();

const subscriptionService = {
  createTrialSubscription: async (userId, planType) => {
    const { error: validationError } = userIdSchema.validate(userId);
    if (validationError) {
      throw new Error(`Erreur de validation: ${validationError.details[0].message}`);
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from("subscription_plans")
      .select("*")
      .eq("plan_type", planType)
      .single();

    if (planError || !plan) {
      throw new Error(`Plan d'abonnement ${planType} introuvable.`);
    }

    const trialDays = plan.trial_duration_days ?? plan.duration_days;
    const now = dayjs();
    const expiresAt = now.add(trialDays, "day").toISOString();

    const { data: subscription, error: insertError } = await supabaseAdmin
      .from("subscriptions")
      .insert({
        user_id: userId,
        plan_id: plan.id,
        plan_type: planType,
        amount: plan.amount,
        status: "active",
        started_at: now.toISOString(),
        expires_at: expiresAt,
        is_trial: true,
        trial_ends_at: expiresAt,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Erreur lors de la création de l'abonnement d'essai: ${insertError.message}`);
    }

    await auditService.logActivity(
      userId,
      "SUBSCRIPTION_CREATED",
      `Abonnement d'essai créé pour le plan ${planType}, expire le ${expiresAt}.`
    );

    return subscription;
  },

  initiateRenewal: async (userId) => {
    const { data: subscription, error } = await supabaseAdmin
      .from("subscriptions")
      .select("*, subscription_plans(name, amount)")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !subscription) {
      throw new Error("Abonnement introuvable pour cet utilisateur.");
    }

    const amount = subscription.subscription_plans?.amount ?? subscription.amount;

    const paymentResult = await paymentService.initiatePayment({
      amount,
      customer_id: userId,
      metadata: {
        type: "subscription_renewal",
        userId,
        subscriptionId: subscription.id,
      },
    });

    if (!paymentResult || !paymentResult.payment_url) {
      throw new Error("Échec de l'initialisation du paiement PayDunya.");
    }

    await auditService.logActivity(
      userId,
      "SUBSCRIPTION_RENEWAL_INITIATED",
      `Renouvellement initié pour l'abonnement ${subscription.id}.`
    );

    return { payment_url: paymentResult.payment_url };
  },

  handleRenewalPayment: async (paymentTransaction) => {
    const { status, amount, transactionId, metadata } = paymentTransaction;
    const { userId, subscriptionId } = metadata;

    if (status !== "SUCCESS") {
      await auditService.logActivity(
        userId,
        "SUBSCRIPTION_RENEWAL_FAILED",
        `Le paiement de renouvellement ${transactionId} a échoué (statut: ${status}).`
      );
      return;
    }

    const { data: subscription, error: subError } = await supabaseAdmin
      .from("subscriptions")
      .select("*, subscription_plans(duration_days)")
      .eq("id", subscriptionId)
      .single();

    if (subError || !subscription) {
      throw new Error(`Abonnement ${subscriptionId} introuvable.`);
    }

    const durationDays = subscription.subscription_plans?.duration_days ?? 30;
    const baseDate = dayjs(subscription.expires_at).isAfter(dayjs()) ? dayjs(subscription.expires_at) : dayjs();
    const newExpiresAt = baseDate.add(durationDays, "day").toISOString();

    await supabaseAdmin
      .from("subscriptions")
      .update({
        status: "active",
        is_trial: false,
        payment_transaction_id: transactionId,
        expires_at: newExpiresAt,
      })
      .eq("id", subscriptionId);

    const { data: adminProfile, error: adminError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("role", "admin")
      .single();

    if (!adminError && adminProfile) {
      await supabaseAdmin
        .from("profiles")
        .update({ virtual_balance: adminProfile.virtual_balance + amount })
        .eq("user_id", adminProfile.user_id);

      await supabaseAdmin.from("wallets").insert({
        user_id: adminProfile.user_id,
        amount,
        transaction_type: "credit",
        reference: transactionId,
        description: `Renouvellement d'abonnement de l'utilisateur ${userId}`,
      });
    }

    await auditService.logActivity(
      userId,
      "SUBSCRIPTION_RENEWAL_SUCCESS",
      `Abonnement ${subscriptionId} renouvelé avec succès jusqu'au ${newExpiresAt}.`
    );

    await notificationService.sendNotification(
      userId,
      "SUBSCRIPTION_RENEWED",
      `Votre abonnement a été renouvelé avec succès jusqu'au ${dayjs(newExpiresAt).format("DD/MM/YYYY")}.`
    );
  },

  checkExpiration: async (userId) => {
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select("subscription_expires_at, subscription_status")
      .eq("user_id", userId)
      .single();

    if (error || !profile || !profile.subscription_expires_at) {
      return false;
    }

    return dayjs(profile.subscription_expires_at).isAfter(dayjs());
  },

  getSubscriptionStatus: async (userId) => {
    const { data: subscription, error } = await supabaseAdmin
      .from("subscriptions")
      .select("*, subscription_plans(name, amount)")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !subscription) {
      return { status: "inactive" };
    }

    return {
      status: subscription.status,
      expires_at: subscription.expires_at,
      started_at: subscription.started_at,
      is_trial: subscription.is_trial,
      plan_name: subscription.subscription_plans?.name,
      amount: subscription.subscription_plans?.amount ?? subscription.amount,
    };
  },

  getSubscriptionHistory: async (userId) => {
    const { data: subscriptions, error } = await supabaseAdmin
      .from("subscriptions")
      .select("*, subscription_plans(name, amount)")
      .eq("user_id", userId)
      .order("started_at", { ascending: false });

    if (error || !subscriptions) {
      return [];
    }

    return subscriptions.map((sub) => ({
      id: sub.id,
      plan_type: sub.plan_type,
      plan_name: sub.subscription_plans?.name,
      amount: sub.subscription_plans?.amount ?? sub.amount,
      status: sub.status,
      started_at: sub.started_at,
      expires_at: sub.expires_at,
      is_trial: sub.is_trial,
    }));
  },

  processExpirationNotifications: async () => {
    const today = dayjs().startOf("day");

    const reminders = [
      { daysBefore: 7, event: "SUBSCRIPTION_EXPIRATION_REMINDER", label: "7 jours" },
      { daysBefore: 3, event: "SUBSCRIPTION_EXPIRATION_REMINDER", label: "3 jours" },
      { daysBefore: 0, event: "SUBSCRIPTION_EXPIRED_TODAY", label: "aujourd'hui" },
    ];

    for (const reminder of reminders) {
      const targetDate = today.add(reminder.daysBefore, "day");

      const { data: expiringSubscriptions, error } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id, expires_at, plan_type")
        .eq("status", "active")
        .gte("expires_at", targetDate.toISOString())
        .lt("expires_at", targetDate.add(1, "day").toISOString());

      if (error || !expiringSubscriptions) continue;

      for (const sub of expiringSubscriptions) {
        const message =
          reminder.daysBefore === 0
            ? "Votre abonnement expire aujourd'hui. Renouvelez-le pour continuer à utiliser Hil_Delivre."
            : `Votre abonnement expire dans ${reminder.label}. Pensez à le renouveler.`;

        await notificationService.sendNotification(sub.user_id, reminder.event, message);
        await auditService.logActivity(
          sub.user_id,
          reminder.event,
          `Notification d'expiration envoyée (${reminder.label}).`
        );
      }
    }
  },

  getExpiredSubscriptions: async () => {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select("*, subscription_plans(name, amount)")
      .or(`status.eq.expired,expires_at.lt.${dayjs().toISOString()}`)
      .order("expires_at", { ascending: false });

    if (error) {
      throw new Error(`Erreur lors de la récupération des abonnements expirés: ${error.message}`);
    }

    return data || [];
  },

  getSubscriptionStats: async () => {
    const { data: all, error } = await supabaseAdmin.from("subscriptions").select("status, is_trial, amount");

    if (error) {
      throw new Error(`Erreur lors de la récupération des statistiques d'abonnement: ${error.message}`);
    }

    const subscriptions = all || [];
    const stats = {
      total: subscriptions.length,
      active: subscriptions.filter((s) => s.status === "active").length,
      expired: subscriptions.filter((s) => s.status === "expired").length,
      trial: subscriptions.filter((s) => s.is_trial).length,
      totalRevenue: subscriptions
        .filter((s) => s.status === "active" && !s.is_trial)
        .reduce((sum, s) => sum + (s.amount || 0), 0),
    };

    return stats;
  },
};

module.exports = subscriptionService;
