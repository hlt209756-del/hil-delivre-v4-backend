'use strict';

/**
 * @fileoverview Tests E2E du flux d'administration pour Hil_Delivre v4.
 * Couvre : dashboard → users → reconciliation → payouts → exports → monitoring.
 * @module __tests__/e2e/adminFlow.test
 */

const request = require('supertest');
const app = require('../../app');

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_TOKEN = 'Bearer test_token_admin';
const CLIENT_TOKEN = 'Bearer test_token_client';
const DELIVERER_TOKEN = 'Bearer test_token_deliverer';

const TEST_ADMIN = {
  id: '00000000-0000-0000-0000-000000000004',
  role: 'admin',
};

const TEST_CLIENT = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'client',
};

const TEST_DELIVERER = {
  id: '00000000-0000-0000-0000-000000000003',
  role: 'delivery',
};

const TEST_MERCHANT = {
  id: '00000000-0000-0000-0000-000000000002',
  role: 'merchant',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests E2E Admin
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Flux d\'administration complet', () => {
  let exportJobId;
  let reconciliationId;
  let payoutId;

  // ─── Phase 1 : Dashboard ───────────────────────────────────────────────────

  describe('Phase 1: Dashboard et métriques temps réel', () => {
    it('GET /api/admin/dashboard — Métriques temps réel', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('active_orders');
      expect(res.body.data).toHaveProperty('online_deliverers');
      expect(res.body.data).toHaveProperty('pending_kyc');
      expect(res.body.data).toHaveProperty('today_revenue');
      expect(res.body.data).toHaveProperty('today_orders_count');
      expect(res.body.data).toHaveProperty('completion_rate');
    });

    it('GET /api/admin/stats — Statistiques historiques', async () => {
      const res = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', ADMIN_TOKEN)
        .query({ period: '7d' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('revenue');
      expect(res.body.data).toHaveProperty('gmv');
      expect(res.body.data).toHaveProperty('orders_count');
      expect(res.body.data).toHaveProperty('avg_order_value');
    });

    it('GET /api/admin/stats/top-merchants — Top marchands', async () => {
      const res = await request(app)
        .get('/api/admin/stats/top-merchants')
        .set('Authorization', ADMIN_TOKEN)
        .query({ limit: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it('GET /api/admin/stats/top-deliverers — Top livreurs', async () => {
      const res = await request(app)
        .get('/api/admin/stats/top-deliverers')
        .set('Authorization', ADMIN_TOKEN)
        .query({ limit: 5 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET /api/admin/dashboard — Rejet si non-admin', async () => {
      const res = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', CLIENT_TOKEN)
        .expect(403);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── Phase 2 : Gestion des utilisateurs ───────────────────────────────────

  describe('Phase 2: Gestion des utilisateurs', () => {
    it('GET /api/admin/users — Liste paginée des utilisateurs', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', ADMIN_TOKEN)
        .query({ limit: 10, role: 'client' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('next_cursor');
    });

    it('GET /api/admin/users/:userId — Détail d\'un utilisateur', async () => {
      const res = await request(app)
        .get(`/api/admin/users/${TEST_CLIENT.id}`)
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('role');
      expect(res.body.data).toHaveProperty('total_orders_count');
      expect(res.body.data).toHaveProperty('created_at');
    });

    it('POST /api/admin/users/:userId/suspend — Suspension d\'un utilisateur', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${TEST_CLIENT.id}/suspend`)
        .set('Authorization', ADMIN_TOKEN)
        .send({ reason: 'Comportement abusif signalé par 3 marchands' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.is_suspended).toBe(true);
      expect(res.body.data.suspension_reason).toContain('abusif');
    });

    it('POST /api/admin/users/:userId/unsuspend — Réactivation', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${TEST_CLIENT.id}/unsuspend`)
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.is_suspended).toBe(false);
    });

    it('POST /api/admin/users/:adminId/suspend — Impossible de suspendre un admin', async () => {
      const res = await request(app)
        .post(`/api/admin/users/${TEST_ADMIN.id}/suspend`)
        .set('Authorization', ADMIN_TOKEN)
        .send({ reason: 'Test' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('DELETE /api/admin/users/:userId — Suppression avec anonymisation CIL', async () => {
      const res = await request(app)
        .delete(`/api/admin/users/${TEST_CLIENT.id}`)
        .set('Authorization', ADMIN_TOKEN)
        .send({ reason: 'Demande de suppression par l\'utilisateur (droit CIL)' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.anonymized).toBe(true);
    });
  });

  // ─── Phase 3 : Réconciliation cash ────────────────────────────────────────

  describe('Phase 3: Réconciliation cash des livreurs', () => {
    it('POST /api/admin/reconciliation/generate — Génération d\'une fiche', async () => {
      const res = await request(app)
        .post('/api/admin/reconciliation/generate')
        .set('Authorization', ADMIN_TOKEN)
        .send({
          deliverer_id: TEST_DELIVERER.id,
          start_date: '2024-01-01',
          end_date: '2024-01-31',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('total_collected');
      expect(res.body.data).toHaveProperty('delivery_fees_kept');
      expect(res.body.data).toHaveProperty('amount_to_remit');
      expect(res.body.data.status).toBe('pending');

      reconciliationId = res.body.data.id;
    });

    it('GET /api/admin/reconciliation — Liste des fiches', async () => {
      const res = await request(app)
        .get('/api/admin/reconciliation')
        .set('Authorization', ADMIN_TOKEN)
        .query({ status: 'pending' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET /api/admin/reconciliation/balance/:id — Solde cash livreur', async () => {
      const res = await request(app)
        .get(`/api/admin/reconciliation/balance/${TEST_DELIVERER.id}`)
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('cash_balance');
      expect(res.body.data).toHaveProperty('total_earnings');
    });

    it('POST /api/deliverer/reconciliation/:id/submit — Le livreur soumet', async () => {
      const res = await request(app)
        .post(`/api/deliverer/reconciliation/${reconciliationId}/submit`)
        .set('Authorization', DELIVERER_TOKEN)
        .send({ payment_reference: 'MOOV-TXN-20240131-001' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('submitted');
    });

    it('POST /api/admin/reconciliation/:id/confirm — Admin confirme', async () => {
      const res = await request(app)
        .post(`/api/admin/reconciliation/${reconciliationId}/confirm`)
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('confirmed');
    });
  });

  // ─── Phase 4 : Payouts marchands ──────────────────────────────────────────

  describe('Phase 4: Payouts marchands', () => {
    it('POST /api/admin/payouts/generate — Génération d\'un payout', async () => {
      const res = await request(app)
        .post('/api/admin/payouts/generate')
        .set('Authorization', ADMIN_TOKEN)
        .send({
          merchant_id: TEST_MERCHANT.id,
          start_date: '2024-01-01',
          end_date: '2024-01-31',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('gross_amount');
      expect(res.body.data).toHaveProperty('commission_amount');
      expect(res.body.data).toHaveProperty('net_amount');
      expect(res.body.data.status).toBe('pending');
      // Vérification : net = gross - commission (5%)
      expect(res.body.data.net_amount).toBe(
        res.body.data.gross_amount - res.body.data.commission_amount
      );

      payoutId = res.body.data.id;
    });

    it('GET /api/admin/payouts — Liste des payouts', async () => {
      const res = await request(app)
        .get('/api/admin/payouts')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('POST /api/admin/payouts/:id/approve — Approbation du payout', async () => {
      const res = await request(app)
        .post(`/api/admin/payouts/${payoutId}/approve`)
        .set('Authorization', ADMIN_TOKEN)
        .send({ payment_reference: 'PAYDUNYA-PAYOUT-20240131-001' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('completed');
    });
  });

  // ─── Phase 5 : Exports CSV ─────────────────────────────────────────────────

  describe('Phase 5: Exports CSV', () => {
    it('POST /api/monitoring/exports — Création d\'un export orders', async () => {
      const res = await request(app)
        .post('/api/monitoring/exports')
        .set('Authorization', ADMIN_TOKEN)
        .send({
          export_type: 'orders',
          filters: {
            start_date: '2024-01-01',
            end_date: '2024-01-31',
            status: 'delivered',
          },
        })
        .expect(202);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('job_id');
      expect(res.body.data.status).toBe('pending');

      exportJobId = res.body.data.job_id;
    });

    it('GET /api/monitoring/exports — Liste des exports', async () => {
      const res = await request(app)
        .get('/api/monitoring/exports')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body).toHaveProperty('pagination');
    });

    it('GET /api/monitoring/exports/:jobId — Détail d\'un export', async () => {
      const res = await request(app)
        .get(`/api/monitoring/exports/${exportJobId}`)
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('export_type');
    });

    it('POST /api/monitoring/exports — Rejet si non-admin', async () => {
      const res = await request(app)
        .post('/api/monitoring/exports')
        .set('Authorization', CLIENT_TOKEN)
        .send({ export_type: 'users' })
        .expect(403);

      expect(res.body.success).toBe(false);
    });

    it('POST /api/monitoring/exports — Rejet si type invalide', async () => {
      const res = await request(app)
        .post('/api/monitoring/exports')
        .set('Authorization', ADMIN_TOKEN)
        .send({ export_type: 'invalid_type' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('DELETE /api/monitoring/exports/:jobId — Suppression d\'un export', async () => {
      const res = await request(app)
        .delete(`/api/monitoring/exports/${exportJobId}`)
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── Phase 6 : Monitoring et Health ────────────────────────────────────────

  describe('Phase 6: Monitoring et Health Checks', () => {
    it('GET /api/monitoring/health — Health check public', async () => {
      const res = await request(app)
        .get('/api/monitoring/health')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('GET /api/monitoring/health/detailed — Health check détaillé (admin)', async () => {
      const res = await request(app)
        .get('/api/monitoring/health/detailed')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('services');
      expect(res.body.data).toHaveProperty('uptime');
    });

    it('GET /api/monitoring/health/:service — Health d\'un service', async () => {
      const res = await request(app)
        .get('/api/monitoring/health/postgresql')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('response_time_ms');
    });

    it('GET /api/monitoring/metrics/json — Métriques JSON (admin)', async () => {
      const res = await request(app)
        .get('/api/monitoring/metrics/json')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
    });

    it('GET /api/monitoring/cache/stats — Stats du cache', async () => {
      const res = await request(app)
        .get('/api/monitoring/cache/stats')
        .set('Authorization', ADMIN_TOKEN)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('hit_count');
      expect(res.body.data).toHaveProperty('miss_count');
      expect(res.body.data).toHaveProperty('hit_ratio');
    });

    it('POST /api/monitoring/cache/invalidate — Invalidation de cache', async () => {
      const res = await request(app)
        .post('/api/monitoring/cache/invalidate')
        .set('Authorization', ADMIN_TOKEN)
        .send({ pattern: 'dashboard:*', reason: 'Refresh manuel des métriques' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('invalidated_count');
    });

    it('POST /api/monitoring/cache/flush — Flush cache (avec confirmation)', async () => {
      const res = await request(app)
        .post('/api/monitoring/cache/flush')
        .set('Authorization', ADMIN_TOKEN)
        .send({ confirm: 'FLUSH_ALL_CACHE' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('POST /api/monitoring/cache/flush — Rejet sans confirmation', async () => {
      const res = await request(app)
        .post('/api/monitoring/cache/flush')
        .set('Authorization', ADMIN_TOKEN)
        .send({ confirm: 'wrong' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });
  });

  // ─── Phase 7 : Audit trail ─────────────────────────────────────────────────

  describe('Phase 7: Vérification de l\'audit trail', () => {
    it('Toutes les actions admin sont loggées', async () => {
      const res = await request(app)
        .get('/api/admin/audit-log')
        .set('Authorization', ADMIN_TOKEN)
        .query({ limit: 50 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Vérifier que les actions précédentes sont loggées
      const actionTypes = res.body.data.map((a) => a.action_type);
      expect(actionTypes).toContain('user_suspended');
      expect(actionTypes).toContain('user_unsuspended');
      expect(actionTypes).toContain('user_deleted');
      expect(actionTypes).toContain('reconciliation_confirmed');
      expect(actionTypes).toContain('payout_approved');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests de sécurité admin
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E: Sécurité du panel admin', () => {
  const adminRoutes = [
    { method: 'get', path: '/api/admin/dashboard' },
    { method: 'get', path: '/api/admin/stats' },
    { method: 'get', path: '/api/admin/users' },
    { method: 'post', path: '/api/admin/reconciliation/generate' },
    { method: 'post', path: '/api/admin/payouts/generate' },
    { method: 'get', path: '/api/monitoring/health/detailed' },
    { method: 'post', path: '/api/monitoring/exports' },
    { method: 'post', path: '/api/monitoring/cache/flush' },
  ];

  it('Toutes les routes admin rejettent les non-admins', async () => {
    for (const route of adminRoutes) {
      const res = await request(app)
        [route.method](route.path)
        .set('Authorization', CLIENT_TOKEN);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    }
  });

  it('Toutes les routes admin rejettent les requêtes non authentifiées', async () => {
    for (const route of adminRoutes) {
      const res = await request(app)[route.method](route.path);
      expect(res.status).toBe(401);
    }
  });
});
