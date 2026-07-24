'use strict';

/**
 * @fileoverview Tests d'intégration pour les endpoints Menu (Sprint 3).
 */

const request = require('supertest');

// Mock du service Supabase
jest.mock('../services/supabaseService', () => {
  const supabaseAdmin = {
    from: jest.fn(),
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

const mockMerchantProfile = {
  user_id: 'merchant-id',
  role: 'merchant',
  display_name: 'Restaurant Test',
  kyc_status: 'approved',
  is_active: true,
  is_subscribed: true,
  subscription_end_date: new Date(Date.now() + 86400000).toISOString(),
};

const mockClientProfile = {
  user_id: 'client-id',
  role: 'client',
  is_active: true,
  kyc_status: 'pending',
};

function mockAuthenticatedUser(profile) {
  supabaseAdmin.auth.getUser.mockResolvedValue({
    data: { user: { id: profile.user_id, email: 'test@test.com' } },
    error: null,
  });
  supabaseAdmin.from.mockImplementation((table) => {
    if (table === 'profiles_data') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: profile, error: null }),
          }),
        }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

// ============================================================
// TESTS PUBLICS
// ============================================================

describe('GET /api/merchants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner la liste des marchands actifs', async () => {
    const mockMerchants = [
      { user_id: '1', display_name: 'Restaurant A', score_rating: 4.5 },
      { user_id: '2', display_name: 'Restaurant B', score_rating: 4.2 },
    ];

    supabaseAdmin.from.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              ilike: jest.fn().mockReturnThis(),
              order: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({
                  data: mockMerchants,
                  error: null,
                  count: 2,
                }),
              }),
            }),
          }),
        }),
      }),
    }));

    const res = await request(app).get('/api/merchants');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.merchants).toHaveLength(2);
    expect(res.body.data.pagination.total).toBe(2);
  });

  it('devrait supporter la pagination', async () => {
    supabaseAdmin.from.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                range: jest.fn().mockResolvedValue({
                  data: [],
                  error: null,
                  count: 0,
                }),
              }),
            }),
          }),
        }),
      }),
    }));

    const res = await request(app).get('/api/merchants?page=2&limit=10');

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.page).toBe(2);
    expect(res.body.data.pagination.limit).toBe(10);
  });
});

describe('GET /api/merchants/:merchantId/menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 404 si le marchand n\'existe pas', async () => {
    supabaseAdmin.from.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            }),
          }),
        }),
      }),
    }));

    const res = await request(app).get('/api/merchants/invalid-id/menu');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MERCHANT_NOT_FOUND');
  });

  it('devrait retourner le menu groupé par catégorie', async () => {
    const callCount = { value: 0 };
    supabaseAdmin.from.mockImplementation(() => {
      callCount.value++;
      if (callCount.value === 1) {
        // Premier appel : récupérer le marchand
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { user_id: 'merchant-1', display_name: 'Test', is_active: true },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      // Deuxième appel : récupérer les articles
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                order: jest.fn().mockResolvedValue({
                  data: [
                    { id: '1', name: 'Riz', category: 'Plats', price: 1500 },
                    { id: '2', name: 'Jus', category: 'Boissons', price: 500 },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    });

    const res = await request(app).get('/api/merchants/merchant-1/menu');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total_items).toBe(2);
    expect(res.body.data.categories).toHaveProperty('Plats');
    expect(res.body.data.categories).toHaveProperty('Boissons');
  });
});

// ============================================================
// TESTS CRUD MARCHAND
// ============================================================

describe('POST /api/menu/items', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid token' },
    });

    const res = await request(app)
      .post('/api/menu/items')
      .send({ name: 'Test', price: 1000, category: 'Plats' });

    expect(res.status).toBe(401);
  });

  it('devrait retourner 403 si le rôle n\'est pas marchand', async () => {
    mockAuthenticatedUser(mockClientProfile);

    const res = await request(app)
      .post('/api/menu/items')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: 'Test', price: 1000, category: 'Plats' });

    expect(res.status).toBe(403);
  });

  it('devrait retourner 422 si le prix est négatif', async () => {
    mockAuthenticatedUser(mockMerchantProfile);

    const res = await request(app)
      .post('/api/menu/items')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: 'Test', price: -100, category: 'Plats' });

    expect(res.status).toBe(422);
  });

  it('devrait retourner 422 si le nom est manquant', async () => {
    mockAuthenticatedUser(mockMerchantProfile);

    const res = await request(app)
      .post('/api/menu/items')
      .set('Authorization', 'Bearer mock-token')
      .send({ price: 1000, category: 'Plats' });

    expect(res.status).toBe(422);
  });

  it('devrait créer un article avec succès (201)', async () => {
    const mockItem = { id: 'item-1', name: 'Riz sauce', price: 1500, category: 'Plats' };

    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: { id: 'merchant-id', email: 'merchant@test.com' } },
      error: null,
    });

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
      if (table === 'menu_items') {
        return {
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: mockItem, error: null }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis() };
    });

    const res = await request(app)
      .post('/api/menu/items')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: 'Riz sauce', price: 1500, category: 'Plats' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.item.name).toBe('Riz sauce');
  });
});

// ============================================================
// TESTS COMMANDES
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

    const res = await request(app)
      .post('/api/orders')
      .send({});

    expect(res.status).toBe(401);
  });

  it('devrait retourner 403 si le rôle n\'est pas client', async () => {
    mockAuthenticatedUser(mockMerchantProfile);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send({
        merchant_id: 'some-uuid-1234-5678-9012-123456789012',
        items: [{ menu_item_id: 'item-uuid-1234-5678-9012-123456789012', quantity: 1 }],
      });

    expect(res.status).toBe(403);
  });

  it('devrait retourner 422 si le panier est vide', async () => {
    mockAuthenticatedUser(mockClientProfile);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send({
        merchant_id: '12345678-1234-1234-1234-123456789012',
        items: [],
      });

    expect(res.status).toBe(422);
  });

  it('devrait retourner 422 si merchant_id est manquant', async () => {
    mockAuthenticatedUser(mockClientProfile);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer mock-token')
      .send({
        items: [{ menu_item_id: '12345678-1234-1234-1234-123456789012', quantity: 1 }],
      });

    expect(res.status).toBe(422);
  });
});

describe('GET /api/orders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner les commandes du client authentifié', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: { id: 'client-id', email: 'client@test.com' } },
      error: null,
    });

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
  });
});
