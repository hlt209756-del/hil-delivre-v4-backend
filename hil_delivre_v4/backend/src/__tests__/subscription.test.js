// backend/src/__tests__/subscription.test.js - Tests d'intégration pour le module d'abonnement

const request = require("supertest");
const express = require("express");
const Joi = require("joi");
const dayjs = require("dayjs");

// Mock des dépendances externes
const { supabaseAdmin } = require("../config/supabase");
const notificationService = require("../services/notificationService");
const paymentService = require("../services/paymentService");
const auditService = require("../services/auditService");
const responseHelper = require("../utils/responseHelper");

// Mock du service d'abonnement pour isoler les tests du contrôleur
const subscriptionService = require("../services/subscriptionService");
const subscriptionController = require("../controllers/subscriptionController");
const subscriptionRoutes = require("../routes/subscriptionRoutes");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const subscriptionGate = require("../middlewares/subscriptionGate");

// Configuration d'une application Express minimale pour les tests de routes
const app = express();
app.use(express.json());

// Mock des middlewares pour les tests de routes
jest.mock("../middlewares/authMiddleware", () =>
  jest.fn((req, res, next) => {
    req.user = { id: "test-user-id", email: "test@example.com" };
    next();
  })
);

jest.mock("../middlewares/roleMiddleware", () => ({
  requireRole: jest.fn((role) => (req, res, next) => {
    if (role === "admin" && req.user.id !== "admin-user-id") {
      return res.status(403).json({ message: "Accès refusé: rôle admin requis." });
    }
    next();
  }),
}));

jest.mock("../middlewares/subscriptionGate", () =>
  jest.fn((req, res, next) => {
    // Par défaut, ne bloque pas
    next();
  })
);

// Appliquer les routes d'abonnement à l'application de test
app.use("/api/subscription", subscriptionRoutes);

describe("Subscription Service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock des fonctions Supabase et autres services
    supabaseAdmin.from.mockReturnThis();
    supabaseAdmin.select.mockReturnThis();
    supabaseAdmin.eq.mockReturnThis();
    supabaseAdmin.single.mockResolvedValue({ data: null, error: null });
    supabaseAdmin.insert.mockResolvedValue({ data: null, error: null });
    supabaseAdmin.update.mockResolvedValue({ data: null, error: null });
    supabaseAdmin.order.mockReturnThis();
    supabaseAdmin.limit.mockReturnThis();
    supabaseAdmin.rpc.mockResolvedValue({ data: null, error: null });

    notificationService.sendNotification.mockResolvedValue(true);
    paymentService.initiatePayment.mockResolvedValue({ payment_url: "http://paydunya.com/payment" });
    auditService.logActivity.mockResolvedValue(true);
  });

  // --- Tests pour createTrialSubscription ---
  describe("createTrialSubscription", () => {
    it("devrait créer un abonnement d'essai pour un marchand", async () => {
      const userId = "new-merchant-id";
      const planType = "merchant_monthly";
      const plan = {
        id: "plan-merchant-id",
        duration_days: 30,
        trial_duration_days: 30,
        amount: 6000,
      };
      const expectedExpiresAt = dayjs().add(30, "day").toISOString();

      supabaseAdmin.single.mockResolvedValueOnce({ data: plan, error: null }); // Pour le plan
      supabaseAdmin.insert.mockResolvedValueOnce({
        data: {
          id: "sub-id-1",
          user_id: userId,
          plan_id: plan.id,
          plan_type: planType,
          amount: plan.amount,
          status: "active",
          started_at: dayjs().toISOString(),
          expires_at: expectedExpiresAt,
          is_trial: true,
          trial_ends_at: expectedExpiresAt,
        },
        error: null,
      });

      const subscription = await subscriptionService.createTrialSubscription(userId, planType);

      expect(subscription).toBeDefined();
      expect(subscription.user_id).toBe(userId);
      expect(subscription.is_trial).toBe(true);
      expect(auditService.logActivity).toHaveBeenCalledWith(userId, "SUBSCRIPTION_CREATED", expect.any(String));
    });

    it("devrait échouer si le plan n'est pas trouvé", async () => {
      const userId = "new-delivery-id";
      const planType = "delivery_monthly";

      supabaseAdmin.single.mockResolvedValueOnce({ data: null, error: { message: "Not found" } });

      await expect(subscriptionService.createTrialSubscription(userId, planType)).rejects.toThrow(
        /Plan d'abonnement .* introuvable/
      );
    });

    it("devrait échouer avec des données de validation invalides", async () => {
      await expect(subscriptionService.createTrialSubscription("invalid-uuid", "merchant_monthly")).rejects.toThrow(
        /Erreur de validation/
      );
    });
  });

  // --- Tests pour initiateRenewal ---
  describe("initiateRenewal", () => {
    it("devrait initier un renouvellement et retourner une URL de paiement", async () => {
      const userId = "existing-user-id";
      const currentSubscription = {
        id: "sub-id-2",
        user_id: userId,
        plan_id: "plan-merchant-id",
        plan_type: "merchant_monthly",
        amount: 6000,
        status: "expired",
        expires_at: dayjs().subtract(1, "day").toISOString(),
        subscription_plans: { name: "Abonnement Marchand Mensuel", amount: 6000 },
      };

      supabaseAdmin.single.mockResolvedValueOnce({ data: currentSubscription, error: null });
      paymentService.initiatePayment.mockResolvedValueOnce({ payment_url: "http://paydunya.com/renewal" });

      const result = await subscriptionService.initiateRenewal(userId);

      expect(result).toBeDefined();
      expect(result.payment_url).toBe("http://paydunya.com/renewal");
      expect(paymentService.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({
        amount: 6000,
        customer_id: userId,
        metadata: { type: "subscription_renewal", userId: userId, subscriptionId: currentSubscription.id },
      }));
      expect(auditService.logActivity).toHaveBeenCalledWith(userId, "SUBSCRIPTION_RENEWAL_INITIATED", expect.any(String));
    });

    it("devrait échouer si aucun abonnement n'est trouvé", async () => {
      const userId = "non-existent-user";
      supabaseAdmin.single.mockResolvedValueOnce({ data: null, error: { message: "Not found" } });

      await expect(subscriptionService.initiateRenewal(userId)).rejects.toThrow(/Abonnement introuvable/);
    });

    it("devrait échouer si l'initialisation du paiement PayDunya échoue", async () => {
      const userId = "existing-user-id";
      const currentSubscription = {
        id: "sub-id-2",
        user_id: userId,
        plan_id: "plan-merchant-id",
        plan_type: "merchant_monthly",
        amount: 6000,
        status: "expired",
        expires_at: dayjs().subtract(1, "day").toISOString(),
        subscription_plans: { name: "Abonnement Marchand Mensuel", amount: 6000 },
      };

      supabaseAdmin.single.mockResolvedValueOnce({ data: currentSubscription, error: null });
      paymentService.initiatePayment.mockResolvedValueOnce({ payment_url: null });

      await expect(subscriptionService.initiateRenewal(userId)).rejects.toThrow(/Échec de l'initialisation du paiement PayDunya./);
    });
  });

  // --- Tests pour handleRenewalPayment ---
  describe("handleRenewalPayment", () => {
    const adminUserId = "admin-user-id";
    const adminProfile = { user_id: adminUserId, virtual_balance: 10000, role: "admin" };

    beforeEach(() => {
      supabaseAdmin.from.mockReturnThis();
      supabaseAdmin.select.mockReturnThis();
      supabaseAdmin.eq.mockReturnThis();
      supabaseAdmin.single.mockResolvedValueOnce({ data: adminProfile, error: null }); // Mock pour l'admin user
      supabaseAdmin.update.mockResolvedValue({ data: null, error: null }); // Pour la mise à jour du solde admin
      supabaseAdmin.insert.mockResolvedValue({ data: null, error: null }); // Pour l'insertion dans wallets
    });

    it("devrait renouveler l'abonnement, créditer l'admin et envoyer une notification en cas de succès", async () => {
      const userId = "user-to-renew";
      const subscriptionId = "sub-id-3";
      const planDurationDays = 30;
      const amount = 6000;
      const existingSubscription = {
        id: subscriptionId,
        user_id: userId,
        plan_id: "plan-merchant-id",
        plan_type: "merchant_monthly",
        amount: amount,
        status: "expired",
        expires_at: dayjs().subtract(5, "day").toISOString(),
        subscription_plans: { duration_days: planDurationDays },
      };
      const paymentTransaction = {
        transactionId: "paydunya-tx-123",
        status: "SUCCESS",
        amount: amount,
        metadata: { type: "subscription_renewal", userId: userId, subscriptionId: subscriptionId },
      };

      supabaseAdmin.single.mockResolvedValueOnce({ data: existingSubscription, error: null }); // Pour l'abonnement existant
      supabaseAdmin.update.mockResolvedValueOnce({ data: { ...existingSubscription, status: "active", is_trial: false }, error: null }); // Pour la mise à jour de l'abonnement

      await subscriptionService.handleRenewalPayment(paymentTransaction);

      expect(supabaseAdmin.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          is_trial: false,
          payment_transaction_id: paymentTransaction.transactionId,
        })
      );
      expect(supabaseAdmin.update).toHaveBeenCalledWith(expect.objectContaining({ virtual_balance: adminProfile.virtual_balance + amount }));
      expect(supabaseAdmin.insert).toHaveBeenCalledWith(expect.objectContaining({
        user_id: adminUserId,
        amount: amount,
        transaction_type: "credit",
      }));
      expect(auditService.logActivity).toHaveBeenCalledWith(userId, "SUBSCRIPTION_RENEWAL_SUCCESS", expect.any(String));
      expect(notificationService.sendNotification).toHaveBeenCalledWith(userId, "SUBSCRIPTION_RENEWED", expect.any(String));
    });

    it("ne devrait rien faire si le paiement n'est pas un succès", async () => {
      const paymentTransaction = {
        transactionId: "paydunya-tx-456",
        status: "FAILED",
        amount: 3000,
        metadata: { type: "subscription_renewal", userId: "user-failed", subscriptionId: "sub-id-4" },
      };

      await subscriptionService.handleRenewalPayment(paymentTransaction);

      expect(supabaseAdmin.update).not.toHaveBeenCalled();
      expect(supabaseAdmin.insert).not.toHaveBeenCalled();
      expect(auditService.logActivity).toHaveBeenCalledWith(paymentTransaction.metadata.userId, "SUBSCRIPTION_RENEWAL_FAILED", expect.any(String));
      expect(notificationService.sendNotification).not.toHaveBeenCalled();
    });

    it("devrait échouer si l'abonnement n'est pas trouvé", async () => {
      const paymentTransaction = {
        transactionId: "paydunya-tx-789",
        status: "SUCCESS",
        amount: 3000,
        metadata: { type: "subscription_renewal", userId: "user-not-found", subscriptionId: "sub-id-non-existent" },
      };

      supabaseAdmin.single.mockResolvedValueOnce({ data: null, error: { message: "Not found" } });

      await expect(subscriptionService.handleRenewalPayment(paymentTransaction)).rejects.toThrow(/Abonnement .* introuvable/);
    });
  });

  // --- Tests pour checkExpiration ---
  describe("checkExpiration", () => {
    it("devrait retourner true pour un abonnement actif", async () => {
      const userId = "active-user";
      const profile = {
        subscription_expires_at: dayjs().add(10, "day").toISOString(),
        subscription_status: "active",
      };
      supabaseAdmin.single.mockResolvedValueOnce({ data: profile, error: null });

      const isExpired = await subscriptionService.checkExpiration(userId);
      expect(isExpired).toBe(true);
    });

    it("devrait retourner false pour un abonnement expiré", async () => {
      const userId = "expired-user";
      const profile = {
        subscription_expires_at: dayjs().subtract(1, "day").toISOString(),
        subscription_status: "expired",
      };
      supabaseAdmin.single.mockResolvedValueOnce({ data: profile, error: null });

      const isExpired = await subscriptionService.checkExpiration(userId);
      expect(isExpired).toBe(false);
    });

    it("devrait retourner false si la date d'expiration est nulle", async () => {
      const userId = "no-sub-user";
      const profile = {
        subscription_expires_at: null,
        subscription_status: "inactive",
      };
      supabaseAdmin.single.mockResolvedValueOnce({ data: profile, error: null });

      const isExpired = await subscriptionService.checkExpiration(userId);
      expect(isExpired).toBe(false);
    });
  });

  // --- Tests pour getSubscriptionStatus ---
  describe("getSubscriptionStatus", () => {
    it("devrait retourner le statut complet de l'abonnement", async () => {
      const userId = "user-with-sub";
      const subscription = {
        id: "sub-id-5",
        user_id: userId,
        plan_type: "merchant_monthly",
        amount: 6000,
        status: "active",
        started_at: dayjs().subtract(10, "day").toISOString(),
        expires_at: dayjs().add(20, "day").toISOString(),
        is_trial: false,
        subscription_plans: { name: "Abonnement Marchand Mensuel", amount: 6000 },
      };
      supabaseAdmin.single.mockResolvedValueOnce({ data: subscription, error: null });

      const status = await subscriptionService.getSubscriptionStatus(userId);
      expect(status).toBeDefined();
      expect(status.status).toBe("active");
      expect(status.plan_name).toBe("Abonnement Marchand Mensuel");
    });

    it("devrait retourner 'inactive' si aucun abonnement n'est trouvé", async () => {
      const userId = "user-without-sub";
      supabaseAdmin.single.mockResolvedValueOnce({ data: null, error: { message: "Not found" } });

      const status = await subscriptionService.getSubscriptionStatus(userId);
      expect(status.status).toBe("inactive");
    });
  });

  // --- Tests pour getSubscriptionHistory ---
  describe("getSubscriptionHistory", () => {
    it("devrait retourner l'historique des abonnements d'un utilisateur", async () => {
      const userId = "user-history";
      const subscriptions = [
        {
          id: "sub-id-6",
          user_id: userId,
          plan_type: "merchant_monthly",
          amount: 6000,
          status: "active",
          started_at: dayjs().subtract(60, "day").toISOString(),
          expires_at: dayjs().subtract(30, "day").toISOString(),
          is_trial: true,
          subscription_plans: { name: "Abonnement Marchand Mensuel", amount: 6000 },
        },
        {
          id: "sub-id-7",
          user_id: userId,
          plan_type: "merchant_monthly",
          amount: 6000,
          status: "active",
          started_at: dayjs().subtract(30, "day").toISOString(),
          expires_at: dayjs().add(0, "day").toISOString(),
          is_trial: false,
          subscription_plans: { name: "Abonnement Marchand Mensuel", amount: 6000 },
        },
      ];
      supabaseAdmin.select.mockResolvedValueOnce({ data: subscriptions, error: null });

      const history = await subscriptionService.getSubscriptionHistory(userId);
      expect(history).toBeDefined();
      expect(history.length).toBe(2);
      expect(history[0].plan_name).toBe("Abonnement Marchand Mensuel");
    });

    it("devrait retourner un tableau vide si aucun historique n'est trouvé", async () => {
      const userId = "user-no-history";
      supabaseAdmin.select.mockResolvedValueOnce({ data: [], error: null });

      const history = await subscriptionService.getSubscriptionHistory(userId);
      expect(history).toEqual([]);
    });
  });

  // --- Tests pour processExpirationNotifications ---
  describe("processExpirationNotifications", () => {
    it("devrait envoyer des notifications J-7, J-3 et J-0", async () => {
      const now = dayjs().startOf("day");
      const user7Days = "user-7-days";
      const user3Days = "user-3-days";
      const user0Days = "user-0-days";

      const expiringIn7Days = [
        { user_id: user7Days, expires_at: now.add(7, "day").toISOString(), plan_type: "merchant_monthly" },
      ];
      const expiringIn3Days = [
        { user_id: user3Days, expires_at: now.add(3, "day").toISOString(), plan_type: "delivery_monthly" },
      ];
      const expiringToday = [
        { user_id: user0Days, expires_at: now.toISOString(), plan_type: "merchant_monthly" },
      ];

      supabaseAdmin.select.mockResolvedValueOnce({ data: expiringIn7Days, error: null });
      supabaseAdmin.select.mockResolvedValueOnce({ data: expiringIn3Days, error: null });
      supabaseAdmin.select.mockResolvedValueOnce({ data: expiringToday, error: null });

      await subscriptionService.processExpirationNotifications();

      expect(notificationService.sendNotification).toHaveBeenCalledTimes(3);
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        user7Days,
        "SUBSCRIPTION_EXPIRATION_REMINDER",
        expect.stringContaining("7 jours")
      );
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        user3Days,
        "SUBSCRIPTION_EXPIRATION_REMINDER",
        expect.stringContaining("3 jours")
      );
      expect(notificationService.sendNotification).toHaveBeenCalledWith(
        user0Days,
        "SUBSCRIPTION_EXPIRED_TODAY",
        expect.stringContaining("aujourd'hui")
      );
      expect(auditService.logActivity).toHaveBeenCalledTimes(3);
    });

    it("ne devrait pas envoyer de notifications si aucun abonnement n'expire", async () => {
      supabaseAdmin.select.mockResolvedValue({ data: [], error: null });

      await subscriptionService.processExpirationNotifications();

      expect(notificationService.sendNotification).not.toHaveBeenCalled();
      expect(auditService.logActivity).not.toHaveBeenCalled();
    });
  });
});

describe("Subscription Controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock des services pour les tests du contrôleur
    subscriptionService.getSubscriptionStatus = jest.fn();
    subscriptionService.initiateRenewal = jest.fn();
    subscriptionService.getSubscriptionHistory = jest.fn();
    subscriptionService.getExpiredSubscriptions = jest.fn();
    subscriptionService.getSubscriptionStats = jest.fn();
    auditService.logActivity = jest.fn();

    // Mock du middleware d'authentification pour simuler un utilisateur connecté
    authMiddleware.mockImplementation((req, res, next) => {
      req.user = { id: "test-user-id", email: "test@example.com", role: "merchant" };
      next();
    });

    // Mock du middleware de gating pour ne pas bloquer par défaut
    subscriptionGate.mockImplementation((req, res, next) => next());
  });

  // --- Tests pour GET /api/subscription/status ---
  describe("GET /api/subscription/status", () => {
    it("devrait retourner le statut de l'abonnement", async () => {
      const mockStatus = {
        status: "active",
        expires_at: dayjs().add(30, "day").toISOString(),
        plan_name: "Abonnement Marchand Mensuel",
      };
      subscriptionService.getSubscriptionStatus.mockResolvedValue(mockStatus);

      const res = await request(app).get("/api/subscription/status");

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockStatus);
      expect(subscriptionService.getSubscriptionStatus).toHaveBeenCalledWith("test-user-id");
      expect(auditService.logActivity).toHaveBeenCalledWith("test-user-id", "SUBSCRIPTION_STATUS_VIEWED", expect.any(String));
    });

    it("devrait retourner une erreur si le service échoue", async () => {
      subscriptionService.getSubscriptionStatus.mockRejectedValue(new Error("Erreur Supabase"));

      const res = await request(app).get("/api/subscription/status");

      expect(res.statusCode).toEqual(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Erreur Supabase");
    });
  });

  // --- Tests pour POST /api/subscription/renew ---
  describe("POST /api/subscription/renew", () => {
    it("devrait initier le renouvellement et retourner l'URL de paiement", async () => {
      const mockPaymentUrl = "http://paydunya.com/renewal-link";
      subscriptionService.initiateRenewal.mockResolvedValue({ payment_url: mockPaymentUrl });

      const res = await request(app).post("/api/subscription/renew");

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.payment_url).toBe(mockPaymentUrl);
      expect(subscriptionService.initiateRenewal).toHaveBeenCalledWith("test-user-id");
      expect(auditService.logActivity).toHaveBeenCalledWith("test-user-id", "SUBSCRIPTION_RENEWAL_INITIATED", expect.any(String));
    });

    it("devrait retourner une erreur si le service échoue", async () => {
      subscriptionService.initiateRenewal.mockRejectedValue(new Error("Erreur PayDunya"));

      const res = await request(app).post("/api/subscription/renew");

      expect(res.statusCode).toEqual(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Erreur PayDunya");
    });
  });

  // --- Tests pour GET /api/subscription/history ---
  describe("GET /api/subscription/history", () => {
    it("devrait retourner l'historique des abonnements", async () => {
      const mockHistory = [
        { id: "sub1", plan_name: "Marchand", status: "active" },
        { id: "sub2", plan_name: "Marchand", status: "expired" },
      ];
      subscriptionService.getSubscriptionHistory.mockResolvedValue(mockHistory);

      const res = await request(app).get("/api/subscription/history");

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockHistory);
      expect(subscriptionService.getSubscriptionHistory).toHaveBeenCalledWith("test-user-id");
      expect(auditService.logActivity).toHaveBeenCalledWith("test-user-id", "SUBSCRIPTION_HISTORY_VIEWED", expect.any(String));
    });

    it("devrait retourner une erreur si le service échoue", async () => {
      subscriptionService.getSubscriptionHistory.mockRejectedValue(new Error("Erreur BDD"));

      const res = await request(app).get("/api/subscription/history");

      expect(res.statusCode).toEqual(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Erreur BDD");
    });
  });

  // --- Tests pour GET /api/admin/subscriptions/expired ---
  describe("GET /api/admin/subscriptions/expired", () => {
    beforeEach(() => {
      // Simuler un utilisateur admin
      authMiddleware.mockImplementation((req, res, next) => {
        req.user = { id: "admin-user-id", email: "admin@example.com", role: "admin" };
        next();
      });
      roleMiddleware.requireRole.mockImplementation((role) => (req, res, next) => {
        if (req.user.role === role) next();
        else res.status(403).json({ message: "Accès refusé: rôle admin requis." });
      });
    });

    it("devrait retourner la liste des abonnements expirés pour un admin", async () => {
      const mockExpired = [
        { id: "sub-exp1", user_email: "user1@test.com", status: "expired" },
      ];
      subscriptionService.getExpiredSubscriptions.mockResolvedValue(mockExpired);

      const res = await request(app).get("/api/admin/subscriptions/expired");

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockExpired);
      expect(subscriptionService.getExpiredSubscriptions).toHaveBeenCalled();
      expect(auditService.logActivity).toHaveBeenCalledWith("admin-user-id", "ADMIN_VIEWED_EXPIRED_SUBSCRIPTIONS", expect.any(String));
    });

    it("devrait refuser l'accès si l'utilisateur n'est pas admin", async () => {
      authMiddleware.mockImplementation((req, res, next) => {
        req.user = { id: "test-user-id", email: "test@example.com", role: "merchant" };
        next();
      });

      const res = await request(app).get("/api/admin/subscriptions/expired");

      expect(res.statusCode).toEqual(403);
      expect(res.body.message).toBe("Accès refusé: rôle admin requis.");
    });
  });

  // --- Tests pour GET /api/admin/subscriptions/stats ---
  describe("GET /api/admin/subscriptions/stats", () => {
    beforeEach(() => {
      // Simuler un utilisateur admin
      authMiddleware.mockImplementation((req, res, next) => {
        req.user = { id: "admin-user-id", email: "admin@example.com", role: "admin" };
        next();
      });
      roleMiddleware.requireRole.mockImplementation((role) => (req, res, next) => {
        if (req.user.role === role) next();
        else res.status(403).json({ message: "Accès refusé: rôle admin requis." });
      });
    });

    it("devrait retourner les statistiques d'abonnement pour un admin", async () => {
      const mockStats = {
        active_subscriptions: 10,
        expired_subscriptions: 2,
        trial_subscriptions: 5,
        total_subscriptions: 12,
      };
      subscriptionService.getSubscriptionStats.mockResolvedValue(mockStats);

      const res = await request(app).get("/api/admin/subscriptions/stats");

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockStats);
      expect(subscriptionService.getSubscriptionStats).toHaveBeenCalled();
      expect(auditService.logActivity).toHaveBeenCalledWith("admin-user-id", "ADMIN_VIEWED_SUBSCRIPTION_STATS", expect.any(String));
    });

    it("devrait refuser l'accès si l'utilisateur n'est pas admin", async () => {
      authMiddleware.mockImplementation((req, res, next) => {
        req.user = { id: "test-user-id", email: "test@example.com", role: "merchant" };
        next();
      });

      const res = await request(app).get("/api/admin/subscriptions/stats");

      expect(res.statusCode).toEqual(403);
      expect(res.body.message).toBe("Accès refusé: rôle admin requis.");
    });
  });
});

describe("Subscription Gating Middleware", () => {
  let mockRequest, mockResponse, mockNext;

  beforeEach(() => {
    mockRequest = {
      user: { id: "test-user-id", email: "test@example.com" },
      path: "/api/some-protected-route",
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();

    jest.clearAllMocks();
    supabaseAdmin.from.mockReturnThis();
    supabaseAdmin.select.mockReturnThis();
    supabaseAdmin.eq.mockReturnThis();
    supabaseAdmin.single.mockResolvedValue({ data: null, error: null });
    notificationService.sendNotification.mockResolvedValue(true);
    auditService.logActivity.mockResolvedValue(true);
  });

  it("devrait laisser passer un client", async () => {
    supabaseAdmin.single.mockResolvedValueOnce({ data: { role: "client" }, error: null });

    await subscriptionGate(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it("devrait laisser passer un admin", async () => {
    supabaseAdmin.single.mockResolvedValueOnce({ data: { role: "admin" }, error: null });

    await subscriptionGate(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it("devrait laisser passer un marchand avec un abonnement actif", async () => {
    supabaseAdmin.single.mockResolvedValueOnce({
      data: {
        role: "merchant",
        subscription_expires_at: dayjs().add(1, "day").toISOString(),
        subscription_status: "active",
      },
      error: null,
    });

    await subscriptionGate(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it("devrait bloquer un livreur avec un abonnement expiré", async () => {
    supabaseAdmin.single.mockResolvedValueOnce({
      data: {
        role: "delivery",
        subscription_expires_at: dayjs().subtract(1, "day").toISOString(),
        subscription_status: "expired",
      },
      error: null,
    });

    await subscriptionGate(mockRequest, mockResponse, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: false,
      message: "Votre abonnement a expiré. Veuillez le renouveler.",
      blocked: true,
      reason: "subscription_expired",
      renewal_url: "/subscription/renew",
    });
    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      mockRequest.user.id,
      "SUBSCRIPTION_BLOCKED",
      expect.any(String)
    );
    expect(auditService.logActivity).toHaveBeenCalledWith(
      mockRequest.user.id,
      "ACCOUNT_BLOCKED_SUBSCRIPTION_EXPIRED",
      expect.any(String)
    );
  });

  it("devrait laisser passer un utilisateur expiré vers la route de renouvellement", async () => {
    mockRequest.path = "/api/subscription/renew";
    supabaseAdmin.single.mockResolvedValueOnce({
      data: {
        role: "merchant",
        subscription_expires_at: dayjs().subtract(1, "day").toISOString(),
        subscription_status: "expired",
      },
      error: null,
    });

    await subscriptionGate(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it("devrait laisser passer un utilisateur expiré vers la route de statut", async () => {
    mockRequest.path = "/api/subscription/status";
    supabaseAdmin.single.mockResolvedValueOnce({
      data: {
        role: "delivery",
        subscription_expires_at: dayjs().subtract(1, "day").toISOString(),
        subscription_status: "expired",
      },
      error: null,
    });

    await subscriptionGate(mockRequest, mockResponse, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });
});
