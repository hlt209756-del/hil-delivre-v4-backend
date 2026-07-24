'use strict';

/**
 * @fileoverview Tests E2E du flux de commande complet pour Hil_Delivre v4.
 * Couvre le cycle de vie entier : création → paiement → assignation → livraison → notation.
 * @module __tests__/e2e/orderFlow.test
 */

const request = require('supertest');
const app = require('../../app');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers & Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tokens JWT simulés pour les tests.
 * En environnement de test, le middleware auth accepte ces tokens
 * et injecte les utilisateurs correspondants dans req.user.
 */
const TEST_USERS = {
  client: {
    id: '00000000-0000-0000-0000-000000000001',
    role: 'client',
    email: 'client.test@hildelivre.bf',
    phone_number: '+22670000001',
  },
  merchant: {
    id: '00000000-0000-0000-0000-000000000002',
    role: 'merchant',
    email: 'merchant.test@hildelivre.bf',
    phone_number: '+22670000002',
  },
  deliverer: {
    id: '00000000-0000-0000-0000-000000000003',
    role: 'delivery',
    email: 'deliverer.test@hildelivre.bf',
    phone_number: '+22670000003',
  },
  admin: {
    id: '00000000-0000-0000-0000-000000000004',
    role: 'admin',
    email: 'admin.test@hildelivre.bf',
    phone_number: '+22670000004',
  },
};

/**
 * Génère un header Authorization pour un utilisateur de test.
 * @param {string} role - Le rôle de l'utilisateur.
 * @returns {string} Le header Authorization.
 */
const authHeader = (role) => `Bearer test_token_${role}`;

/**
 * Données de test pour un article de menu.
 */
const MENU_ITEM = {
  name: 'Riz sauce arachide',
  description: 'Plat traditionnel burkinabè avec viande',
  price: 1500,
  category: 'plats_principaux',
  is_available: true,
  stock_quantity: 50,
};

/**
 * Données de test pour une commande.
 */
const ORDER_DATA = {
  merchant_id: TEST_USERS.merchant.id,
  delivery_address: 'Quartier Ouaga 2000, Rue 15.32',
  delivery_latitude: 12.3456,
  delivery_longitude: -1.5234,
  payment_method: 'mobile_money',
  items: [
    { menu_item_id: null, quantity: 2 }, // menu_item_id sera rempli dynamiquement
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests E2E
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Flux de commande complet', () => {
  let menuItemId;
  let orderId;
  let assignmentId;

  // ─── Phase 1 : Préparation du menu ─────────────────────────────────────────

  describe('Phase 1: Préparation du menu par le marchand', () => {
    it('POST /api/menu-items — Le marchand crée un article de menu', async () => {
      const res = await request(app)
        .post('/api/menu-items')
        .set('Authorization', authHeader('merchant'))
        .send(MENU_ITEM)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.name).toBe(MENU_ITEM.name);
      expect(res.body.data.price).toBe(MENU_ITEM.price);
      expect(res.body.data.is_available).toBe(true);

      menuItemId = res.body.data.id;
    });

    it('GET /api/merchants/:id/menu — Le client consulte le menu', async () => {
      const res = await request(app)
        .get(`/api/merchants/${TEST_USERS.merchant.id}/menu`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);

      const item = res.body.data.find((i) => i.id === menuItemId);
      expect(item).toBeDefined();
      expect(item.name).toBe(MENU_ITEM.name);
    });
  });

  // ─── Phase 2 : Création de la commande ─────────────────────────────────────

  describe('Phase 2: Création de la commande par le client', () => {
    it('POST /api/delivery/estimate — Estimation des frais de livraison', async () => {
      const res = await request(app)
        .post('/api/delivery/estimate')
        .set('Authorization', authHeader('client'))
        .send({
          origin: { latitude: 12.3700, longitude: -1.5200 },
          destination: { latitude: 12.3456, longitude: -1.5234 },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('delivery_fee');
      expect(res.body.data).toHaveProperty('distance_km');
      expect(res.body.data).toHaveProperty('estimated_minutes');
      expect(res.body.data.delivery_fee).toBeGreaterThanOrEqual(500); // Minimum garanti
    });

    it('POST /api/orders — Création de la commande', async () => {
      ORDER_DATA.items[0].menu_item_id = menuItemId;

      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', authHeader('client'))
        .send(ORDER_DATA)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.client_id).toBe(TEST_USERS.client.id);
      expect(res.body.data.merchant_id).toBe(TEST_USERS.merchant.id);
      expect(res.body.data).toHaveProperty('food_amount');
      expect(res.body.data).toHaveProperty('delivery_fee');
      expect(res.body.data).toHaveProperty('commission_amount');
      expect(res.body.data).toHaveProperty('platform_vat_amount');
      expect(res.body.data).toHaveProperty('total_amount');

      // Vérification du calcul financier
      const { food_amount, commission_amount, platform_vat_amount, delivery_fee } = res.body.data;
      expect(food_amount).toBe(MENU_ITEM.price * 2); // 2 articles
      expect(commission_amount).toBe(food_amount * 0.05); // 5% commission
      // TVA 18% sur (commission + delivery_fee)
      expect(platform_vat_amount).toBeCloseTo((commission_amount + delivery_fee) * 0.18, 0);

      orderId = res.body.data.id;
    });

    it('GET /api/orders/:id — Vérification des détails de la commande', async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(orderId);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data).toHaveProperty('delivery_fee_detail');
    });
  });

  // ─── Phase 3 : Paiement ────────────────────────────────────────────────────

  describe('Phase 3: Paiement Mobile Money', () => {
    it('POST /api/payments/initiate — Initialisation du paiement', async () => {
      const res = await request(app)
        .post('/api/payments/initiate')
        .set('Authorization', authHeader('client'))
        .send({
          order_id: orderId,
          payment_method: 'mobile_money',
          phone_number: '+22670000001',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('payment_url');
      expect(res.body.data).toHaveProperty('transaction_id');
    });

    it('POST /api/payments/webhook — Confirmation PayDunya (webhook)', async () => {
      const res = await request(app)
        .post('/api/payments/webhook')
        .send({
          status: 'completed',
          custom_data: { order_id: orderId },
          token: process.env.PAYDUNYA_WEBHOOK_TOKEN || 'test_webhook_token',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('GET /api/orders/:id — Commande passe en "accepted" après paiement', async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.data.status).toBe('accepted');
      expect(res.body.data.payment_method).toBe('mobile_money');
    });
  });

  // ─── Phase 4 : Préparation par le marchand ─────────────────────────────────

  describe('Phase 4: Préparation par le marchand', () => {
    it('PUT /api/orders/:id/status — Le marchand accepte et prépare', async () => {
      const res = await request(app)
        .put(`/api/orders/${orderId}/status`)
        .set('Authorization', authHeader('merchant'))
        .send({ status: 'preparing' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('preparing');
    });

    it('PUT /api/orders/:id/status — Le marchand marque "prêt"', async () => {
      const res = await request(app)
        .put(`/api/orders/${orderId}/status`)
        .set('Authorization', authHeader('merchant'))
        .send({ status: 'ready_for_pickup' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ready_for_pickup');
    });
  });

  // ─── Phase 5 : Assignation du livreur ──────────────────────────────────────

  describe('Phase 5: Assignation et acceptation par le livreur', () => {
    it('PUT /api/delivery/availability — Le livreur se met en ligne', async () => {
      const res = await request(app)
        .put('/api/delivery/availability')
        .set('Authorization', authHeader('deliverer'))
        .send({ status: 'online' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('PUT /api/delivery/location — Le livreur met à jour sa position', async () => {
      const res = await request(app)
        .put('/api/delivery/location')
        .set('Authorization', authHeader('deliverer'))
        .send({
          latitude: 12.3700,
          longitude: -1.5200,
          heading: 180,
          speed: 0,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('POST /api/delivery/assign — Assignation de la commande', async () => {
      const res = await request(app)
        .post('/api/delivery/assign')
        .set('Authorization', authHeader('merchant'))
        .send({
          order_id: orderId,
          merchant_location: { latitude: 12.3700, longitude: -1.5200 },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('assignment_id');

      assignmentId = res.body.data.assignment_id;
    });

    it('GET /api/delivery/assignments/active — Le livreur voit la proposition', async () => {
      const res = await request(app)
        .get('/api/delivery/assignments/active')
        .set('Authorization', authHeader('deliverer'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);

      const assignment = res.body.data.find((a) => a.id === assignmentId);
      expect(assignment).toBeDefined();
      expect(assignment.order_id).toBe(orderId);
    });

    it('POST /api/delivery/assignments/:id/accept — Le livreur accepte', async () => {
      const res = await request(app)
        .post(`/api/delivery/assignments/${assignmentId}/accept`)
        .set('Authorization', authHeader('deliverer'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('accepted');
    });
  });

  // ─── Phase 6 : Livraison ───────────────────────────────────────────────────

  describe('Phase 6: Livraison et tracking', () => {
    it('POST /api/delivery/tracking/event — Pickup effectué', async () => {
      const res = await request(app)
        .post('/api/delivery/tracking/event')
        .set('Authorization', authHeader('deliverer'))
        .send({
          order_id: orderId,
          event_type: 'order_picked_up',
          location: { latitude: 12.3700, longitude: -1.5200 },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('GET /api/orders/:id/tracking — Le client suit la livraison', async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}/tracking`)
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('events');
      expect(res.body.data.events.length).toBeGreaterThan(0);
    });

    it('GET /api/delivery/position/:orderId — Position du livreur', async () => {
      const res = await request(app)
        .get(`/api/delivery/position/${orderId}`)
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('latitude');
      expect(res.body.data).toHaveProperty('longitude');
    });

    it('POST /api/delivery/tracking/event — Livraison démarrée', async () => {
      const res = await request(app)
        .post('/api/delivery/tracking/event')
        .set('Authorization', authHeader('deliverer'))
        .send({
          order_id: orderId,
          event_type: 'delivery_started',
          location: { latitude: 12.3700, longitude: -1.5200 },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('POST /api/orders/:id/send-otp — Envoi OTP de confirmation', async () => {
      const res = await request(app)
        .post(`/api/orders/${orderId}/send-otp`)
        .set('Authorization', authHeader('deliverer'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('message');
    });

    it('POST /api/orders/:id/verify-otp — Vérification OTP', async () => {
      // En mode test, le code OTP est '123456'
      const res = await request(app)
        .post(`/api/orders/${orderId}/verify-otp`)
        .set('Authorization', authHeader('deliverer'))
        .send({ code: '123456' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('POST /api/delivery/tracking/event — Commande livrée', async () => {
      const res = await request(app)
        .post('/api/delivery/tracking/event')
        .set('Authorization', authHeader('deliverer'))
        .send({
          order_id: orderId,
          event_type: 'order_delivered',
          location: { latitude: 12.3456, longitude: -1.5234 },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('GET /api/orders/:id — Commande en statut "delivered"', async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.data.status).toBe('delivered');
      expect(res.body.data.delivered_at).toBeDefined();
    });
  });

  // ─── Phase 7 : Notation ────────────────────────────────────────────────────

  describe('Phase 7: Notation post-livraison', () => {
    it('POST /api/orders/:id/rate — Le client note le marchand et le livreur', async () => {
      const res = await request(app)
        .post(`/api/orders/${orderId}/rate`)
        .set('Authorization', authHeader('client'))
        .send({
          merchant_rating: { score: 5, comment: 'Excellent repas, bien chaud !' },
          deliverer_rating: { score: 4, comment: 'Rapide et poli.' },
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('merchant_rating_id');
      expect(res.body.data).toHaveProperty('deliverer_rating_id');
    });

    it('GET /api/users/:id/ratings — Vérification des notes du marchand', async () => {
      const res = await request(app)
        .get(`/api/users/${TEST_USERS.merchant.id}/ratings`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].score).toBe(5);
    });

    it('GET /api/orders/:id/invoice — Récupération de la facture FEC', async () => {
      const res = await request(app)
        .get(`/api/orders/${orderId}/invoice`)
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('invoice_number');
      expect(res.body.data).toHaveProperty('total_ht');
      expect(res.body.data).toHaveProperty('total_tva');
      expect(res.body.data).toHaveProperty('total_ttc');
      expect(res.body.data).toHaveProperty('fec_data');
    });
  });

  // ─── Phase 8 : Vérifications financières ───────────────────────────────────

  describe('Phase 8: Vérifications financières post-commande', () => {
    it('GET /api/wallet/balance — Le marchand a reçu son crédit', async () => {
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Authorization', authHeader('merchant'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.balance).toBeGreaterThan(0);
      // Le marchand reçoit food_amount - commission (5%)
      expect(res.body.data.balance).toBe(MENU_ITEM.price * 2 * 0.95);
    });

    it('GET /api/wallet/balance — Le livreur a reçu ses frais', async () => {
      const res = await request(app)
        .get('/api/wallet/balance')
        .set('Authorization', authHeader('deliverer'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.balance).toBeGreaterThan(0);
      // Le livreur reçoit delivery_fee - commission livraison (1%)
      expect(res.body.data.balance).toBeGreaterThanOrEqual(500 * 0.99); // Minimum garanti - 1%
    });

    it('GET /api/loyalty/points — Le client a gagné des points', async () => {
      const res = await request(app)
        .get('/api/loyalty/points')
        .set('Authorization', authHeader('client'))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.total_points).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests de cas d'erreur et edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Cas d\'erreur du flux de commande', () => {
  it('POST /api/orders — Rejet si article indisponible', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader('client'))
      .send({
        merchant_id: TEST_USERS.merchant.id,
        delivery_address: 'Test',
        delivery_latitude: 12.3456,
        delivery_longitude: -1.5234,
        payment_method: 'mobile_money',
        items: [{ menu_item_id: '00000000-0000-0000-0000-999999999999', quantity: 1 }],
      })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('POST /api/orders — Rejet si non authentifié', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send(ORDER_DATA)
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('PUT /api/orders/:id/status — Rejet si mauvais rôle', async () => {
    const res = await request(app)
      .put('/api/orders/00000000-0000-0000-0000-000000000099/status')
      .set('Authorization', authHeader('client'))
      .send({ status: 'preparing' })
      .expect(403);

    expect(res.body.success).toBe(false);
  });

  it('POST /api/delivery/assign — Rejet si pas de livreur disponible', async () => {
    const res = await request(app)
      .post('/api/delivery/assign')
      .set('Authorization', authHeader('merchant'))
      .send({
        order_id: '00000000-0000-0000-0000-000000000099',
        merchant_location: { latitude: 0, longitude: 0 }, // Aucun livreur à cette position
      })
      .expect(404);

    expect(res.body.success).toBe(false);
  });

  it('POST /api/orders/:id/verify-otp — Rejet si code incorrect', async () => {
    const res = await request(app)
      .post('/api/orders/00000000-0000-0000-0000-000000000099/verify-otp')
      .set('Authorization', authHeader('deliverer'))
      .send({ code: '000000' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });
});
