'use strict';

/**
 * @fileoverview Tests unitaires pour les middlewares.
 *
 * @module __tests__/middlewares.test
 */

jest.mock('../services/supabaseService', () => ({
  supabaseAdmin: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    })),
  },
  getSupabaseClient: jest.fn(),
  SUPABASE_URL: 'https://test.supabase.co',
}));

const { authenticate } = require('../middlewares/authMiddleware');
const { requireRole, requireKYC, requireSubscription } = require('../middlewares/roleMiddleware');
const { supabaseAdmin } = require('../services/supabaseService');

// Helper pour créer des mocks req/res/next
function createMocks(overrides = {}) {
  const req = {
    headers: {},
    profile: null,
    user: null,
    ...overrides,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  };
  const next = jest.fn();
  return { req, res, next };
}

// ============================================================
// TESTS : authMiddleware
// ============================================================

describe('authMiddleware.authenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 si aucun header Authorization', async () => {
    const { req, res, next } = createMocks();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'AUTH_TOKEN_MISSING' }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('devrait retourner 401 si le format Bearer est invalide', async () => {
    const { req, res, next } = createMocks({
      headers: { authorization: 'Basic token123' },
    });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'AUTH_TOKEN_MISSING' }),
      })
    );
  });

  it('devrait retourner 401 si le token est vide', async () => {
    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer ' },
    });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('devrait retourner 401 si Supabase rejette le token', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid token' },
    });

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer invalid_token' },
    });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }),
      })
    );
  });

  it('devrait retourner 403 si le compte est désactivé', async () => {
    const mockUser = { id: 'user-id', email: 'test@test.com' };
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    const mockSingle = jest.fn().mockResolvedValue({
      data: { user_id: 'user-id', role: 'client', is_active: false },
      error: null,
    });
    supabaseAdmin.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: mockSingle,
        }),
      }),
    });

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer valid_token' },
    });

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'ACCOUNT_DEACTIVATED' }),
      })
    );
  });

  it('devrait appeler next() et attacher user/profile si tout est valide', async () => {
    const mockUser = { id: 'user-id', email: 'test@test.com' };
    const mockProfile = { user_id: 'user-id', role: 'client', is_active: true };

    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    });

    supabaseAdmin.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: mockProfile,
            error: null,
          }),
        }),
      }),
    });

    const { req, res, next } = createMocks({
      headers: { authorization: 'Bearer valid_token' },
    });

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(mockUser);
    expect(req.profile).toEqual(mockProfile);
    expect(req.accessToken).toBe('valid_token');
  });
});

// ============================================================
// TESTS : roleMiddleware.requireRole
// ============================================================

describe('roleMiddleware.requireRole', () => {
  it('devrait retourner 401 si pas de profil', () => {
    const { req, res, next } = createMocks();
    const middleware = requireRole('admin');

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('devrait retourner 403 si le rôle ne correspond pas', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'client' },
    });
    const middleware = requireRole('admin');

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'INSUFFICIENT_ROLE' }),
      })
    );
  });

  it('devrait appeler next() si le rôle correspond', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'admin' },
    });
    const middleware = requireRole('admin');

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('devrait accepter plusieurs rôles', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'merchant' },
    });
    const middleware = requireRole('merchant', 'admin');

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ============================================================
// TESTS : roleMiddleware.requireKYC
// ============================================================

describe('roleMiddleware.requireKYC', () => {
  it('devrait passer pour les clients (pas de KYC requis)', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'client', kyc_status: 'pending' },
    });

    requireKYC(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('devrait passer pour les admins', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'admin', kyc_status: 'pending' },
    });

    requireKYC(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('devrait retourner 403 pour un marchand avec KYC pending', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'merchant', kyc_status: 'pending' },
    });

    requireKYC(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'KYC_NOT_APPROVED' }),
      })
    );
  });

  it('devrait retourner 403 pour un livreur avec KYC rejected', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'delivery', kyc_status: 'rejected' },
    });

    requireKYC(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('devrait passer pour un marchand avec KYC approved', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'merchant', kyc_status: 'approved' },
    });

    requireKYC(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ============================================================
// TESTS : roleMiddleware.requireSubscription
// ============================================================

describe('roleMiddleware.requireSubscription', () => {
  it('devrait passer pour les clients', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'client', is_subscribed: false },
    });

    requireSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('devrait retourner 403 pour un marchand non abonné', () => {
    const { req, res, next } = createMocks({
      profile: { role: 'merchant', is_subscribed: false },
    });

    requireSubscription(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'SUBSCRIPTION_REQUIRED' }),
      })
    );
  });

  it('devrait retourner 403 pour un abonnement expiré', () => {
    const { req, res, next } = createMocks({
      profile: {
        role: 'merchant',
        is_subscribed: true,
        subscription_end_date: '2020-01-01T00:00:00Z', // Expiré
      },
    });

    requireSubscription(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'SUBSCRIPTION_EXPIRED' }),
      })
    );
  });

  it('devrait passer pour un marchand avec abonnement actif', () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { req, res, next } = createMocks({
      profile: {
        role: 'merchant',
        is_subscribed: true,
        subscription_end_date: futureDate,
      },
    });

    requireSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
