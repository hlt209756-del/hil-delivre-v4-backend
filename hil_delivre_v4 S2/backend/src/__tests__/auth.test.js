'use strict';

/**
 * @fileoverview Tests d'intégration pour les endpoints d'authentification.
 * Teste les routes /api/auth/* avec des mocks Supabase.
 *
 * @module __tests__/auth.test
 */

const request = require('supertest');

// Mock du service Supabase AVANT l'import de l'app
jest.mock('../services/supabaseService', () => {
  const mockSupabaseAdmin = {
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
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    })),
  };

  return {
    supabaseAdmin: mockSupabaseAdmin,
    getSupabaseClient: jest.fn(),
    SUPABASE_URL: 'https://test.supabase.co',
  };
});

const app = require('../app');
const { supabaseAdmin } = require('../services/supabaseService');

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const validRegistration = {
    email: 'test@example.com',
    password: 'SecureP@ss1',
    phone_number: '+22670000000',
    first_name: 'Jean',
    last_name: 'Dupont',
    preferred_language: 'fr',
    cil_consent: true,
    terms_accepted: true,
  };

  it('devrait retourner 422 si email manquant', async () => {
    const { email, ...body } = validRegistration;
    const res = await request(app).post('/api/auth/register').send(body);

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 422 si mot de passe trop faible', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, password: '12345' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 422 si numéro de téléphone invalide', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, phone_number: '123' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 422 si cil_consent est false', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, cil_consent: false });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 422 si terms_accepted est false', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, terms_accepted: false });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 409 si email existe déjà', async () => {
    supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
      data: { users: [{ email: 'test@example.com' }] },
    });

    const res = await request(app).post('/api/auth/register').send(validRegistration);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  it('devrait retourner 201 avec une inscription réussie', async () => {
    const mockUserId = '123e4567-e89b-12d3-a456-426614174000';

    supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
      data: { users: [] },
    });

    supabaseAdmin.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: mockUserId, email: 'test@example.com' } },
      error: null,
    });

    supabaseAdmin.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { action_link: 'https://test.com/link' } },
      error: null,
    });

    // Mock from() pour supporter les deux appels : update (profil) et select (charger profil)
    supabaseAdmin.from.mockImplementation(() => ({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'profile-id',
              user_id: mockUserId,
              role: 'client',
              first_name: 'Jean',
              last_name: 'Dupont',
              kyc_status: 'pending',
              is_active: true,
            },
            error: null,
          }),
        }),
      }),
    }));

    supabaseAdmin.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: mockUserId, email: 'test@example.com' },
        session: {
          access_token: 'mock_access_token',
          refresh_token: 'mock_refresh_token',
          expires_in: 3600,
          expires_at: Date.now() + 3600000,
        },
      },
      error: null,
    });

    const res = await request(app).post('/api/auth/register').send(validRegistration);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('devrait rejeter les champs inconnus (stripUnknown)', async () => {
    supabaseAdmin.auth.admin.listUsers.mockResolvedValue({
      data: { users: [] },
    });

    supabaseAdmin.auth.admin.createUser.mockResolvedValue({
      data: { user: { id: 'id', email: 'test@example.com' } },
      error: null,
    });

    supabaseAdmin.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { action_link: 'https://test.com/link' } },
      error: null,
    });

    supabaseAdmin.from.mockImplementation(() => ({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { role: 'client', is_active: true }, error: null }),
        }),
      }),
    }));

    supabaseAdmin.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'id', email: 'test@example.com' },
        session: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, expires_at: 0 },
      },
      error: null,
    });

    // Le champ "role" ne doit PAS être accepté (élévation de privilège)
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validRegistration, role: 'admin' });

    // L'inscription doit réussir mais le rôle admin est ignoré
    expect(res.status).toBe(201);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 422 si email manquant', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'test' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 401 avec des identifiants invalides', async () => {
    supabaseAdmin.auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { message: 'Invalid login credentials' },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'WrongP@ss1' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('devrait retourner 403 si le compte est désactivé', async () => {
    const mockUserId = '123e4567-e89b-12d3-a456-426614174000';

    supabaseAdmin.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: mockUserId, email: 'test@example.com' },
        session: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, expires_at: 0 },
      },
      error: null,
    });

    supabaseAdmin.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { role: 'client', is_active: false, kyc_status: 'pending' },
            error: null,
          }),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'SecureP@ss1' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('devrait retourner 200 avec une connexion réussie', async () => {
    const mockUserId = '123e4567-e89b-12d3-a456-426614174000';

    supabaseAdmin.auth.signInWithPassword.mockResolvedValue({
      data: {
        user: { id: mockUserId, email: 'test@example.com' },
        session: {
          access_token: 'mock_access_token',
          refresh_token: 'mock_refresh_token',
          expires_in: 3600,
          expires_at: Date.now() + 3600000,
        },
      },
      error: null,
    });

    supabaseAdmin.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: {
              id: 'profile-id',
              user_id: mockUserId,
              role: 'client',
              first_name: 'Jean',
              last_name: 'Dupont',
              kyc_status: 'pending',
              is_active: true,
            },
            error: null,
          }),
        }),
      }),
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'SecureP@ss1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session.access_token).toBe('mock_access_token');
    expect(res.body.data.profile.role).toBe('client');
  });
});

describe('POST /api/auth/refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 422 si refresh_token manquant', async () => {
    const res = await request(app).post('/api/auth/refresh').send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('devrait retourner 401 si refresh_token invalide', async () => {
    supabaseAdmin.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid refresh token' },
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: 'invalid_token' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('devrait retourner 200 avec un nouveau token', async () => {
    supabaseAdmin.auth.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 3600,
          expires_at: Date.now() + 3600000,
        },
      },
      error: null,
    });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refresh_token: 'valid_refresh_token' });

    expect(res.status).toBe(200);
    expect(res.body.data.session.access_token).toBe('new_access_token');
  });
});

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('devrait retourner 422 si email manquant', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({});

    expect(res.status).toBe(422);
  });

  it('devrait toujours retourner 200 (ne pas révéler si email existe)', async () => {
    supabaseAdmin.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nonexistent@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Endpoints de santé', () => {
  it('GET /health devrait retourner 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });

  it('GET /api/health devrait retourner 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});

describe('404 Handler', () => {
  it('devrait retourner 404 pour une route inexistante', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
