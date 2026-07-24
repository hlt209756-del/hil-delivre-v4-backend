'use strict';

/**
 * @fileoverview Tests d'intégration pour les endpoints Orders (Sprint 3).
 */

const request = require('supertest');

// Mock du service Supabase
jest.mock('../services/supabaseService', () => {
  const supabaseAdmin = {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getUser: jest.fn(),
      admin: {
        listUsers: jest.fn(),
      },
    },
  };
  return { supabaseAdmin, getSupabaseClient: jest.fn() };
});

const { supabaseAdmin } = require('../services/supabaseService');
const app = require('../app');

// ============================================================
// HELPERS
// ============================================================

const mockClientProfile = {
  user_id: 'client-id',
  role: 'client',
  is_active: true,
  kyc_status: 'pending',
};

const mockMerchantProfile = {
  user_id: 'merchant-id',
  role: 'merchant',
  display_name: 'Restaurant Test',
  kyc_status: 'approved',
  is_active: true,
  is_subscribed: true,
  subscription_end_date: new Date(Date.now() + 86400000).toISOString(),
};

const mockDeliveryProfile = {
  user_id: 'delivery-id',
  role: 'delivery',
  is_active: true,
  kyc_status: 'approved',
  is_subscribed: true,
  subscription_end_date: new Date(Date.now() + 86400000).toISOString(),
};

function mockAuthenticatedUser(profile) {
  supabaseAdmin.auth.getUser.mockResolvedValue({
    data: { user: { id: profile.user_id, email: 'test@test.com' } },
    error: null,
  });
}

const validOrderPayload = {
  merchant_id: '12345678-1234-1234-1234-123456789012',
  items: [
    { menu_item_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', quantity: 2 },
    { menu_item_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', quantity: 1 },
  ],
  delivery_address: 'Quartier Koulouba, Ouagadougou',
  client_note: 'Sans piment svp',
};

// ============================================================
// TESTS CRÉATION DE COMMANDE
// ============================================================

describe('POST /api/orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const res = await request(app).post('/api/orders').send(validOrderPayload);
    expect(res.status).toBe(401);
  });

  it('devrait retourner 403 si le rôle n\'est pas client', async () => {
    mockAuthenticatedUser(mockMerchantProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockMerchantProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send(validOrderPayload);

    expect(res.status).toBe(403);
  });

  it('devrait retourner 422 si le panier est vide', async () => {
    mockAuthenticatedUser(mockClientProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockClientProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send({ merchant_id: '12345678-1234-1234-1234-123456789012', items: [] });

    expect(res.status).toBe(422);
    // La validation Joi capture le panier vide (items.min(1)) avant le contrôleur
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 422 si merchant_id est manquant', async () => {
    mockAuthenticatedUser(mockClientProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockClientProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send({ items: [{ menu_item_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', quantity: 1 }] });

    expect(res.status).toBe(422);
  });

  it('devrait retourner 422 si la quantité est 0', async () => {
    mockAuthenticatedUser(mockClientProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockClientProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send({
        merchant_id: '12345678-1234-1234-1234-123456789012',
        items: [{ menu_item_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', quantity: 0 }],
      });

    expect(res.status).toBe(422);
  });
});

// ============================================================
// TESTS LISTE DES COMMANDES
// ============================================================

describe('GET /api/orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const res = await request(app).get('/api/orders');
    expect(res.status).toBe(401);
  });

  it('devrait retourner les commandes du client', async () => {
    mockAuthenticatedUser(mockClientProfile);

    const mockOrders = [
      { id: 'order-1', status: 'pending', total_amount: 5000 },
      { id: 'order-2', status: 'delivered', total_amount: 3000 },
    ];

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockClientProfile, error: null }),
            }),
          }),
        };
      }
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({
                  data: mockOrders,
                  error: null,
                  count: 2,
                }),
              }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);
  });
});

// ============================================================
// TESTS MISE À JOUR DU STATUT
// ============================================================

describe('PUT /api/orders/:orderId/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const res = await request(app)
      .put('/api/orders/order-1/status')
      .send({ status: 'accepted' });

    expect(res.status).toBe(401);
  });

  it('devrait retourner 403 si le rôle est client (ne peut pas changer le statut)', async () => {
    mockAuthenticatedUser(mockClientProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockClientProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .put('/api/orders/order-1/status')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'accepted' });

    expect(res.status).toBe(403);
  });

  it('devrait retourner 422 si le statut est invalide', async () => {
    mockAuthenticatedUser(mockMerchantProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockMerchantProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .put('/api/orders/order-1/status')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'invalid_status' });

    expect(res.status).toBe(422);
  });
});

// ============================================================
// TESTS ANNULATION
// ============================================================

describe('POST /api/orders/:orderId/cancel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const res = await request(app).post('/api/orders/order-1/cancel').send({});
    expect(res.status).toBe(401);
  });

  it('devrait retourner 403 si le rôle n\'est pas client', async () => {
    mockAuthenticatedUser(mockMerchantProfile);
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockMerchantProfile, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .post('/api/orders/order-1/cancel')
      .set('Authorization', 'Bearer mock-token')
      .send({ reason: 'Test' });

    expect(res.status).toBe(403);
  });
});
