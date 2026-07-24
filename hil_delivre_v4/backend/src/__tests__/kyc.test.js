'use strict';

/**
 * @fileoverview Tests d'intégration pour les endpoints KYC.
 *
 * @module __tests__/kyc.test
 */

const request = require('supertest');

jest.mock('../services/supabaseService', () => {
  const mockFrom = jest.fn();

  return {
    supabaseAdmin: {
      auth: {
        admin: {
          createUser: jest.fn(),
          listUsers: jest.fn(),
          generateLink: jest.fn(),
          signOut: jest.fn(),
          updateUserById: jest.fn(),
        },
        signInWithPassword: jest.fn(),
        refreshSession: jest.fn(),
        resetPasswordForEmail: jest.fn(),
        getUser: jest.fn(),
      },
      from: mockFrom,
    },
    getSupabaseClient: jest.fn(),
    SUPABASE_URL: 'https://test.supabase.co',
  };
});

const app = require('../app');
const { supabaseAdmin } = require('../services/supabaseService');

// Helper pour simuler un utilisateur authentifié
function mockAuthenticatedUser(profile = {}) {
  const defaultProfile = {
    id: 'profile-id',
    user_id: 'user-id',
    role: 'client',
    kyc_status: 'pending',
    is_active: true,
    id_document_url: null,
    ...profile,
  };

  supabaseAdmin.auth.getUser.mockResolvedValue({
    data: { user: { id: defaultProfile.user_id, email: 'test@test.com' } },
    error: null,
  });

  // Mock pour authenticate middleware (from('profiles_data').select().eq().single())
  supabaseAdmin.from.mockImplementation((table) => {
    if (table === 'profiles_data') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: defaultProfile,
              error: null,
            }),
            not: jest.fn().mockReturnValue({
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
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { ...defaultProfile, kyc_status: 'pending' },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
  });
}

describe('POST /api/user/kyc', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validMerchantKYC = {
    requested_role: 'merchant',
    business_registration_number: 'BF-IFU-12345',
    id_document_url: 'https://storage.supabase.co/documents/cnib.jpg',
    display_name: 'Restaurant Chez Ali',
    address: 'Ouagadougou, Secteur 30',
    latitude: 12.3714,
    longitude: -1.5197,
  };

  const validDeliveryKYC = {
    requested_role: 'delivery',
    id_document_url: 'https://storage.supabase.co/documents/cnib.jpg',
    phone_number: '+22670123456',
  };

  it('devrait retourner 401 sans authentification', async () => {
    const res = await request(app).post('/api/user/kyc').send(validMerchantKYC);

    expect(res.status).toBe(401);
  });

  it('devrait retourner 422 si requested_role invalide', async () => {
    mockAuthenticatedUser();

    const res = await request(app)
      .post('/api/user/kyc')
      .set('Authorization', 'Bearer valid_token')
      .send({ ...validMerchantKYC, requested_role: 'admin' });

    expect(res.status).toBe(422);
  });

  it('devrait retourner 422 si id_document_url n\'est pas HTTPS', async () => {
    mockAuthenticatedUser();

    const res = await request(app)
      .post('/api/user/kyc')
      .set('Authorization', 'Bearer valid_token')
      .send({ ...validMerchantKYC, id_document_url: 'http://insecure.com/doc.jpg' });

    expect(res.status).toBe(422);
  });

  it('devrait retourner 409 si l\'utilisateur n\'est pas un client', async () => {
    mockAuthenticatedUser({ role: 'merchant' });

    const res = await request(app)
      .post('/api/user/kyc')
      .set('Authorization', 'Bearer valid_token')
      .send(validMerchantKYC);

    expect(res.status).toBe(409);
  });

  it('devrait accepter une demande KYC marchand valide', async () => {
    mockAuthenticatedUser({ role: 'client', kyc_status: 'pending', id_document_url: null });

    const res = await request(app)
      .post('/api/user/kyc')
      .set('Authorization', 'Bearer valid_token')
      .send(validMerchantKYC);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.requested_role).toBe('merchant');
  });

  it('devrait accepter une demande KYC livreur valide', async () => {
    mockAuthenticatedUser({ role: 'client', kyc_status: 'pending', id_document_url: null });

    const res = await request(app)
      .post('/api/user/kyc')
      .set('Authorization', 'Bearer valid_token')
      .send(validDeliveryKYC);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/user/kyc/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    const res = await request(app).get('/api/user/kyc/status');
    expect(res.status).toBe(401);
  });

  it('devrait retourner le statut KYC', async () => {
    mockAuthenticatedUser({
      role: 'client',
      kyc_status: 'pending',
      id_document_url: 'https://storage.supabase.co/doc.jpg',
      business_registration_number: 'BF-12345',
    });

    const res = await request(app)
      .get('/api/user/kyc/status')
      .set('Authorization', 'Bearer valid_token');

    expect(res.status).toBe(200);
    expect(res.body.data.kyc_status).toBe('pending');
    expect(res.body.data.has_document).toBe(true);
  });
});

describe('PUT /api/admin/kyc/:userId/review', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 401 sans authentification', async () => {
    const res = await request(app)
      .put('/api/admin/kyc/user-id/review')
      .send({ decision: 'approved', approved_role: 'merchant' });

    expect(res.status).toBe(401);
  });

  it('devrait retourner 403 si l\'utilisateur n\'est pas admin', async () => {
    mockAuthenticatedUser({ role: 'client' });

    const res = await request(app)
      .put('/api/admin/kyc/user-id/review')
      .set('Authorization', 'Bearer valid_token')
      .send({ decision: 'approved', approved_role: 'merchant' });

    expect(res.status).toBe(403);
  });

  it('devrait retourner 422 si decision invalide', async () => {
    mockAuthenticatedUser({ role: 'admin' });

    const res = await request(app)
      .put('/api/admin/kyc/user-id/review')
      .set('Authorization', 'Bearer valid_token')
      .send({ decision: 'maybe' });

    expect(res.status).toBe(422);
  });

  it('devrait retourner 422 si rejection sans raison', async () => {
    mockAuthenticatedUser({ role: 'admin' });

    const res = await request(app)
      .put('/api/admin/kyc/user-id/review')
      .set('Authorization', 'Bearer valid_token')
      .send({ decision: 'rejected' });

    expect(res.status).toBe(422);
  });
});
