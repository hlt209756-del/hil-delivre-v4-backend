'use strict';

/**
 * @fileoverview Tests E2E du flux d'authentification pour Hil_Delivre v4.
 * Couvre : inscription → login → KYC → OTP → refresh token → logout.
 * @module __tests__/e2e/authFlow.test
 */

const request = require('supertest');
const app = require('../../app');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const NEW_USER = {
  email: 'newuser.e2e@hildelivre.bf',
  phone_number: '+22670999001',
  password: 'SecureP@ss2024!',
  role: 'client',
  first_name: 'Amadou',
  last_name: 'Ouédraogo',
  preferred_language: 'fr',
};

const NEW_MERCHANT = {
  email: 'merchant.e2e@hildelivre.bf',
  phone_number: '+22670999002',
  password: 'M3rchant$ecure!',
  role: 'merchant',
  first_name: 'Fatimata',
  last_name: 'Sawadogo',
  display_name: 'Restaurant Le Sahel',
  preferred_language: 'fr',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests E2E Auth
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Flux d\'authentification complet', () => {
  let clientToken;
  let refreshToken;
  let merchantToken;

  // ─── Phase 1 : Inscription ─────────────────────────────────────────────────

  describe('Phase 1: Inscription', () => {
    it('POST /api/auth/register — Inscription client réussie', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(NEW_USER)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('user_id');
      expect(res.body.data).toHaveProperty('access_token');
      expect(res.body.data).toHaveProperty('refresh_token');
      expect(res.body.data.role).toBe('client');

      clientToken = res.body.data.access_token;
      refreshToken = res.body.data.refresh_token;
    });

    it('POST /api/auth/register — Rejet si email déjà utilisé', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(NEW_USER)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('existe déjà');
    });

    it('POST /api/auth/register — Rejet si mot de passe faible', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...NEW_USER, email: 'weak@test.bf', phone_number: '+22670999099', password: '123' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('POST /api/auth/register — Rejet si numéro de téléphone invalide', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ ...NEW_USER, email: 'phone@test.bf', phone_number: '12345' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('POST /api/auth/register — Inscription marchand réussie', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send(NEW_MERCHANT)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe('merchant');
      merchantToken = res.body.data.access_token;
    });
  });

  // ─── Phase 2 : Connexion ───────────────────────────────────────────────────

  describe('Phase 2: Connexion', () => {
    it('POST /api/auth/login — Connexion par email réussie', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: NEW_USER.email, password: NEW_USER.password })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('access_token');
      expect(res.body.data).toHaveProperty('refresh_token');
      expect(res.body.data.user.role).toBe('client');

      clientToken = res.body.data.access_token;
      refreshToken = res.body.data.refresh_token;
    });

    it('POST /api/auth/login — Rejet si mot de passe incorrect', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: NEW_USER.email, password: 'WrongPassword!' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it('POST /api/auth/login — Rejet si email inexistant', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@hildelivre.bf', password: 'Test123!' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── Phase 3 : Vérification OTP ───────────────────────────────────────────

  describe('Phase 3: Vérification OTP du numéro de téléphone', () => {
    it('POST /api/otp/send — Envoi OTP au numéro du client', async () => {
      const res = await request(app)
        .post('/api/otp/send')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ phone_number: NEW_USER.phone_number, purpose: 'phone_verification' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('envoyé');
      // Le numéro est masqué dans la réponse
      expect(res.body.data.phone_masked).toMatch(/\*+/);
    });

    it('POST /api/otp/verify — Vérification OTP réussie', async () => {
      // En mode test, le code OTP est '123456'
      const res = await request(app)
        .post('/api/otp/verify')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ phone_number: NEW_USER.phone_number, code: '123456', purpose: 'phone_verification' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.phone_verified).toBe(true);
    });

    it('POST /api/otp/verify — Rejet si code incorrect', async () => {
      const res = await request(app)
        .post('/api/otp/verify')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ phone_number: NEW_USER.phone_number, code: '000000', purpose: 'phone_verification' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('POST /api/otp/send — Rate limit après 3 envois', async () => {
      // Simuler 3 envois supplémentaires
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/otp/send')
          .set('Authorization', `Bearer ${clientToken}`)
          .send({ phone_number: NEW_USER.phone_number, purpose: 'phone_verification' });
      }

      const res = await request(app)
        .post('/api/otp/send')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ phone_number: NEW_USER.phone_number, purpose: 'phone_verification' })
        .expect(429);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── Phase 4 : KYC (Marchand) ─────────────────────────────────────────────

  describe('Phase 4: Soumission KYC pour le marchand', () => {
    it('POST /api/users/kyc — Soumission des documents KYC', async () => {
      const res = await request(app)
        .post('/api/users/kyc')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          id_document_url: 'https://storage.supabase.co/documents/cnib_merchant.jpg',
          business_registration_number: 'BF-IFU-2024-00123',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.kyc_status).toBe('pending');
    });

    it('GET /api/users/profile — Le profil reflète le statut KYC', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${merchantToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.kyc_status).toBe('pending');
      expect(res.body.data.business_registration_number).toBe('BF-IFU-2024-00123');
    });

    it('POST /api/users/kyc — Rejet si rôle client (pas autorisé)', async () => {
      const res = await request(app)
        .post('/api/users/kyc')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ id_document_url: 'https://fake.url/doc.jpg' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── Phase 5 : Refresh Token ───────────────────────────────────────────────

  describe('Phase 5: Rafraîchissement du token', () => {
    it('POST /api/auth/refresh-token — Refresh réussi', async () => {
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({ refresh_token: refreshToken })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('access_token');
      expect(res.body.data).toHaveProperty('refresh_token');
      // Le nouveau token est différent de l'ancien
      expect(res.body.data.access_token).not.toBe(clientToken);

      clientToken = res.body.data.access_token;
      refreshToken = res.body.data.refresh_token;
    });

    it('POST /api/auth/refresh-token — Rejet si token invalide', async () => {
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .send({ refresh_token: 'invalid_token_here' })
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── Phase 6 : Profil et mise à jour ───────────────────────────────────────

  describe('Phase 6: Gestion du profil', () => {
    it('GET /api/users/profile — Récupération du profil', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.first_name).toBe(NEW_USER.first_name);
      expect(res.body.data.last_name).toBe(NEW_USER.last_name);
      expect(res.body.data.phone_verified).toBe(true);
    });

    it('PUT /api/users/profile — Mise à jour du profil', async () => {
      const res = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          first_name: 'Amadou-Updated',
          default_waypoints: {
            home: { latitude: 12.3456, longitude: -1.5234, label: 'Domicile' },
          },
          preferred_language: 'mo',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.first_name).toBe('Amadou-Updated');
      expect(res.body.data.preferred_language).toBe('mo');
    });
  });

  // ─── Phase 7 : Déconnexion ─────────────────────────────────────────────────

  describe('Phase 7: Déconnexion', () => {
    it('POST /api/auth/logout — Déconnexion réussie', async () => {
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('GET /api/users/profile — Rejet après déconnexion', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests de sécurité auth
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Sécurité de l\'authentification', () => {
  it('Rejet des requêtes sans token sur les routes protégées', async () => {
    const protectedRoutes = [
      { method: 'get', path: '/api/users/profile' },
      { method: 'post', path: '/api/orders' },
      { method: 'get', path: '/api/wallet/balance' },
      { method: 'get', path: '/api/notifications' },
    ];

    for (const route of protectedRoutes) {
      const res = await request(app)[route.method](route.path).expect(401);
      expect(res.body.success).toBe(false);
    }
  });

  it('Rejet des tokens malformés', async () => {
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', 'Bearer malformed.token.here')
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('Rejet des tokens expirés', async () => {
    const res = await request(app)
      .get('/api/users/profile')
      .set('Authorization', 'Bearer expired_test_token')
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it('Protection contre l\'injection SQL dans le login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: "'; DROP TABLE users; --", password: 'test' })
      .expect(400);

    expect(res.body.success).toBe(false);
  });

  it('Protection contre les XSS dans l\'inscription', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        ...NEW_USER,
        email: 'xss@test.bf',
        phone_number: '+22670999098',
        first_name: '<script>alert("xss")</script>',
      })
      .expect(400);

    expect(res.body.success).toBe(false);
  });
});
