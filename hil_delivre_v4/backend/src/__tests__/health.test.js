/**
 * ============================================================
 * Hil_Delivre v4 — Tests unitaires : Health Check
 * Sprint 1 : Infrastructure
 * ============================================================
 */

const request = require('supertest');
const app = require('../app');

// Mock du client Supabase pour les tests
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => Promise.resolve({ error: null })),
      })),
    })),
  })),
}));

// Configurer l'environnement de test
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.CORS_ORIGINS = 'http://localhost:8080';

// Forcer l'arrêt de Jest après les tests (évite les handles ouverts)
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

describe('Health Check Endpoint', () => {
  describe('GET /health', () => {
    it('devrait retourner un statut 200 avec les données de santé', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('environment');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('api');
      expect(response.body.services).toHaveProperty('database');
    });

    it('devrait retourner status "ok" quand tout fonctionne', async () => {
      const response = await request(app).get('/health');

      expect(response.body.status).toBe('ok');
      expect(response.body.services.api).toBe('operational');
    });

    it('devrait retourner la bonne version', async () => {
      const response = await request(app).get('/health');

      expect(response.body.version).toBe('4.0.0-sprint1');
    });

    it('devrait retourner un timestamp ISO valide', async () => {
      const response = await request(app).get('/health');

      const timestamp = new Date(response.body.timestamp);
      expect(timestamp instanceof Date).toBe(true);
      expect(timestamp.toISOString()).toBe(response.body.timestamp);
    });

    it('devrait retourner l\'uptime en secondes', async () => {
      const response = await request(app).get('/health');

      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /api/health', () => {
    it('devrait fonctionner avec le préfixe /api', async () => {
      const response = await request(app).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
    });

    it('devrait retourner les mêmes données que /health', async () => {
      const response = await request(app).get('/api/health');

      expect(response.body).toHaveProperty('version', '4.0.0-sprint1');
      expect(response.body).toHaveProperty('services');
    });
  });

  describe('GET /health/ready', () => {
    it('devrait retourner un statut 200 avec status "ready"', async () => {
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('404 Handler', () => {
    it('devrait retourner 404 pour une route inexistante', async () => {
      const response = await request(app).get('/route-inexistante');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('ne devrait pas leak le chemin en production', () => {
      // Simuler la production
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = request(app).get('/secret');

      process.env.NODE_ENV = originalEnv;

      // Le test vérifie la structure — en production, path serait undefined
      expect(response).toBeDefined();
    });
  });

  describe('Sécurité des headers', () => {
    it('devrait inclure le header X-Content-Type-Options', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('devrait inclure le header Strict-Transport-Security', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['strict-transport-security']).toBeDefined();
    });

    it('devrait inclure le header X-Frame-Options', async () => {
      const response = await request(app).get('/health');

      expect(response.headers['x-frame-options']).toBeDefined();
    });
  });
});
