'use strict';

/**
 * @fileoverview Tests d'intégration pour le programme de fidélisation.
 * Couvre les cas nominaux, les validations, le RBAC et les edge cases.
 */

const request = require('supertest');
const app = require('../../app');
const supabase = require('../config/supabase');

// ============================================================================
// MOCKS
// ============================================================================

jest.mock('../config/supabase', () => ({
    from: jest.fn(),
    rpc: jest.fn()
}));

const mockUser = (id, role) => ({ id, role, email: `${role}@test.com` });
const clientUser = mockUser('client-uuid-001', 'client');
const merchantUser = mockUser('merchant-uuid-001', 'merchant');
const adminUser = mockUser('admin-uuid-001', 'admin');

jest.mock('../middlewares/authMiddleware', () => ({
    authenticate: (req, res, next) => {
        req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : clientUser;
        next();
    },
    authorize: (roles) => (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Accès interdit', error: 'FORBIDDEN' });
        }
        next();
    }
}));

// ============================================================================
// TESTS : GET /api/loyalty/points
// ============================================================================

describe('GET /api/loyalty/points', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait récupérer le solde de points du client', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'loyalty_points') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        gt: jest.fn().mockResolvedValue({
                            data: [
                                { points_balance: 50, expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() },
                                { points_balance: 30, expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString() }
                            ],
                            error: null
                        })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        in: jest.fn().mockResolvedValue({
                            data: [
                                { config_key: 'loyalty_points_per_100fcfa', config_value: '1' },
                                { config_key: 'loyalty_expiry_months', config_value: '6' },
                                { config_key: 'loyalty_conversion_rate', config_value: '5' },
                                { config_key: 'loyalty_min_redeem', config_value: '100' }
                            ],
                            error: null
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/loyalty/points')
            .set('x-test-user', JSON.stringify(clientUser));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.available_points).toBe(80);
        expect(res.body.data.value_fcfa).toBe(400); // 80 * 5
        expect(res.body.data.expiring_soon).toBe(30); // 30 points expirent dans 20 jours
        expect(res.body.data.can_redeem).toBe(false); // 80 < 100
    });

    it('devrait rejeter si le rôle n\'est pas client', async () => {
        const res = await request(app)
            .get('/api/loyalty/points')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

// ============================================================================
// TESTS : GET /api/loyalty/history
// ============================================================================

describe('GET /api/loyalty/history', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait récupérer l\'historique paginé', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'loyalty_points') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        range: jest.fn().mockResolvedValue({
                            data: [
                                { id: 'lp1', transaction_type: 'earned', points_earned: 15, points_balance: 15, description: 'Commande X', created_at: new Date().toISOString() },
                                { id: 'lp2', transaction_type: 'redeemed', points_spent: 100, points_balance: 0, description: 'Conversion', created_at: new Date().toISOString() }
                            ],
                            error: null,
                            count: 2
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/loyalty/history')
            .set('x-test-user', JSON.stringify(clientUser))
            .query({ page: 1, limit: 20 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.transactions).toHaveLength(2);
        expect(res.body.data.pagination.total).toBe(2);
    });

    it('devrait filtrer par type de transaction', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'loyalty_points') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        range: jest.fn().mockResolvedValue({
                            data: [],
                            error: null,
                            count: 0
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/loyalty/history')
            .set('x-test-user', JSON.stringify(clientUser))
            .query({ type: 'earned' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('devrait rejeter un type de transaction invalide', async () => {
        const res = await request(app)
            .get('/api/loyalty/history')
            .set('x-test-user', JSON.stringify(clientUser))
            .query({ type: 'invalid_type' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

// ============================================================================
// TESTS : POST /api/loyalty/redeem
// ============================================================================

describe('POST /api/loyalty/redeem', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait convertir des points en crédit avec succès', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        in: jest.fn().mockResolvedValue({
                            data: [
                                { config_key: 'loyalty_conversion_rate', config_value: '5' },
                                { config_key: 'loyalty_min_redeem', config_value: '100' }
                            ],
                            error: null
                        })
                    })
                };
            }
            if (table === 'users') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: 'client-uuid-001', role: 'client' },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'loyalty_points') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        gt: jest.fn().mockReturnThis()
                    })
                };
            }
            if (table === 'profiles_data') {
                return {
                    update: jest.fn().mockReturnValue({
                        eq: jest.fn().mockResolvedValue({ error: null })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        supabase.rpc.mockResolvedValue({ data: 500, error: null }); // 100 points * 5 = 500 FCFA

        const res = await request(app)
            .post('/api/loyalty/redeem')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({ points: 100 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.points_redeemed).toBe(100);
        expect(res.body.data.credit_amount).toBe(500);
    });

    it('devrait rejeter si points < minimum (100)', async () => {
        const res = await request(app)
            .post('/api/loyalty/redeem')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({ points: 50 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter si points n\'est pas un entier', async () => {
        const res = await request(app)
            .post('/api/loyalty/redeem')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({ points: 100.5 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter si le champ points est manquant', async () => {
        const res = await request(app)
            .post('/api/loyalty/redeem')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter si le rôle n\'est pas client', async () => {
        const res = await request(app)
            .post('/api/loyalty/redeem')
            .set('x-test-user', JSON.stringify(merchantUser))
            .send({ points: 100 });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('devrait gérer l\'erreur de solde insuffisant', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        in: jest.fn().mockResolvedValue({
                            data: [
                                { config_key: 'loyalty_conversion_rate', config_value: '5' },
                                { config_key: 'loyalty_min_redeem', config_value: '100' }
                            ],
                            error: null
                        })
                    })
                };
            }
            if (table === 'users') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: 'client-uuid-001', role: 'client' },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        supabase.rpc.mockResolvedValue({
            data: null,
            error: { message: 'Solde insuffisant: 50 points disponibles, 100 demandés' }
        });

        const res = await request(app)
            .post('/api/loyalty/redeem')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({ points: 100 });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('insuffisant');
    });
});

// ============================================================================
// TESTS : GET /api/admin/loyalty/stats
// ============================================================================

describe('GET /api/admin/loyalty/stats', () => {
    it('devrait récupérer les stats de fidélité (admin)', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'loyalty_points') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        gt: jest.fn().mockResolvedValue({
                            data: [
                                { points_balance: 100, user_id: 'u1' },
                                { points_balance: 200, user_id: 'u2' }
                            ],
                            error: null
                        })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        in: jest.fn().mockResolvedValue({
                            data: [
                                { config_key: 'loyalty_conversion_rate', config_value: '5' },
                                { config_key: 'loyalty_min_redeem', config_value: '100' }
                            ],
                            error: null
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/admin/loyalty/stats')
            .set('x-test-user', JSON.stringify(adminUser));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('total_active_points');
        expect(res.body.data).toHaveProperty('config');
    });

    it('devrait rejeter si le rôle n\'est pas admin', async () => {
        const res = await request(app)
            .get('/api/admin/loyalty/stats')
            .set('x-test-user', JSON.stringify(clientUser));

        expect(res.status).toBe(403);
    });
});

// ============================================================================
// TESTS : POST /api/admin/loyalty/expire
// ============================================================================

describe('POST /api/admin/loyalty/expire', () => {
    it('devrait déclencher l\'expiration des points (admin)', async () => {
        supabase.rpc.mockResolvedValue({ data: 5, error: null });
        supabase.from.mockImplementation((table) => {
            if (table === 'loyalty_points') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        gte: jest.fn().mockResolvedValue({
                            data: [],
                            error: null
                        })
                    })
                };
            }
            if (table === 'admin_actions') {
                return {
                    insert: jest.fn().mockResolvedValue({ error: null })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/admin/loyalty/expire')
            .set('x-test-user', JSON.stringify(adminUser));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.expired_count).toBe(5);
    });
});
