'use strict';

/**
 * @fileoverview Tests d'intégration pour le système de notation.
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

// Helpers pour les mocks
const mockUser = (id, role) => ({ id, role, email: `${role}@test.com` });
const clientUser = mockUser('client-uuid-001', 'client');
const merchantUser = mockUser('merchant-uuid-001', 'merchant');
const deliveryUser = mockUser('delivery-uuid-001', 'delivery');
const adminUser = mockUser('admin-uuid-001', 'admin');

const mockOrder = {
    id: 'order-uuid-001',
    status: 'delivered',
    client_id: 'client-uuid-001',
    merchant_id: 'merchant-uuid-001',
    delivery_id: 'delivery-uuid-001',
    delivered_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1h ago
    updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString()
};

// Mock du middleware d'authentification
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
// TESTS : POST /api/orders/:orderId/rate
// ============================================================================

describe('POST /api/orders/:orderId/rate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait créer une notation avec succès (client → marchand)', async () => {
        // Mock: récupérer la commande
        supabase.from.mockImplementation((table) => {
            if (table === 'orders') {
                return {
                    select: jest.fn().mockReturnThis(),
                    eq: jest.fn().mockReturnThis(),
                    single: jest.fn().mockResolvedValue({ data: mockOrder, error: null })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnThis(),
                    eq: jest.fn().mockReturnThis(),
                    single: jest.fn().mockResolvedValue({ data: { config_value: 72 }, error: null })
                };
            }
            if (table === 'ratings') {
                return {
                    select: jest.fn().mockReturnThis(),
                    eq: jest.fn().mockReturnThis(),
                    maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
                    insert: jest.fn().mockReturnValue({
                        select: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: {
                                    id: 'rating-uuid-001',
                                    order_id: 'order-uuid-001',
                                    rater_id: 'client-uuid-001',
                                    rated_user_id: 'merchant-uuid-001',
                                    score: 5,
                                    comment: 'Excellent service',
                                    created_at: new Date().toISOString()
                                },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'merchant-uuid-001',
                score: 5,
                comment: 'Excellent service'
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.score).toBe(5);
    });

    it('devrait rejeter un score invalide (< 1)', async () => {
        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'merchant-uuid-001',
                score: 0,
                comment: 'Test'
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter un score invalide (> 5)', async () => {
        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'merchant-uuid-001',
                score: 6,
                comment: 'Test'
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter un commentaire trop long (> 500 chars)', async () => {
        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'merchant-uuid-001',
                score: 4,
                comment: 'a'.repeat(501)
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter un rated_user_id invalide (non UUID)', async () => {
        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'not-a-uuid',
                score: 4
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter si le rôle est merchant (non autorisé)', async () => {
        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(merchantUser))
            .send({
                rated_user_id: 'client-uuid-001',
                score: 4
            });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter un orderId non UUID', async () => {
        const res = await request(app)
            .post('/api/orders/invalid-id/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'merchant-uuid-001',
                score: 4
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter l\'auto-notation', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'orders') {
                return {
                    select: jest.fn().mockReturnThis(),
                    eq: jest.fn().mockReturnThis(),
                    single: jest.fn().mockResolvedValue({ data: mockOrder, error: null })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnThis(),
                    eq: jest.fn().mockReturnThis(),
                    single: jest.fn().mockResolvedValue({ data: { config_value: 72 }, error: null })
                };
            }
            return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/orders/order-uuid-001/rate')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({
                rated_user_id: 'client-uuid-001', // même que le rater
                score: 5
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toContain('vous-même');
    });
});

// ============================================================================
// TESTS : GET /api/users/:userId/ratings
// ============================================================================

describe('GET /api/users/:userId/ratings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait récupérer les notations d\'un utilisateur', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'ratings') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        range: jest.fn().mockResolvedValue({
                            data: [
                                { id: 'r1', score: 5, comment: 'Super', created_at: new Date().toISOString() },
                                { id: 'r2', score: 4, comment: null, created_at: new Date().toISOString() }
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
            .get('/api/users/merchant-uuid-001/ratings')
            .query({ page: 1, limit: 10 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ratings).toHaveLength(2);
        expect(res.body.data.pagination.total).toBe(2);
    });

    it('devrait supporter les filtres de score', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'ratings') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        gte: jest.fn().mockReturnThis(),
                        lte: jest.fn().mockReturnThis(),
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
            .get('/api/users/merchant-uuid-001/ratings')
            .query({ min_score: 4, max_score: 5 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('devrait rejeter un userId non UUID', async () => {
        const res = await request(app)
            .get('/api/users/not-a-uuid/ratings');

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

// ============================================================================
// TESTS : GET /api/users/:userId/rating-summary
// ============================================================================

describe('GET /api/users/:userId/rating-summary', () => {
    it('devrait récupérer le résumé de notation', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'profiles_data') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { avg_rating: 4.5, ratings_count: 12 },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/users/merchant-uuid-001/rating-summary');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.avg_rating).toBe(4.5);
        expect(res.body.data.ratings_count).toBe(12);
    });
});

// ============================================================================
// TESTS : DELETE /api/admin/ratings/:ratingId (modération)
// ============================================================================

describe('DELETE /api/admin/ratings/:ratingId', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait modérer une notation (admin)', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'ratings') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: 'rating-uuid-001', rated_user_id: 'merchant-uuid-001', is_visible: true },
                                error: null
                            })
                        })
                    }),
                    update: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            select: jest.fn().mockReturnValue({
                                single: jest.fn().mockResolvedValue({
                                    data: { id: 'rating-uuid-001', is_visible: false, moderated_at: new Date().toISOString() },
                                    error: null
                                })
                            })
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
            .delete('/api/admin/ratings/rating-uuid-001')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({ reason: 'Contenu inapproprié et abusif' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('devrait rejeter la modération sans raison', async () => {
        const res = await request(app)
            .delete('/api/admin/ratings/rating-uuid-001')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter la modération avec raison trop courte', async () => {
        const res = await request(app)
            .delete('/api/admin/ratings/rating-uuid-001')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({ reason: 'ab' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter si le rôle n\'est pas admin', async () => {
        const res = await request(app)
            .delete('/api/admin/ratings/rating-uuid-001')
            .set('x-test-user', JSON.stringify(clientUser))
            .send({ reason: 'Contenu inapproprié' });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });
});

// ============================================================================
// TESTS : GET /api/admin/ratings
// ============================================================================

describe('GET /api/admin/ratings', () => {
    it('devrait récupérer les notations pour modération (admin)', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'ratings') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        gte: jest.fn().mockReturnThis(),
                        lte: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        range: jest.fn().mockResolvedValue({
                            data: [{ id: 'r1', score: 1, comment: 'Horrible', is_visible: true }],
                            error: null,
                            count: 1
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/admin/ratings')
            .set('x-test-user', JSON.stringify(adminUser))
            .query({ page: 1, limit: 10, include_hidden: 'true' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.ratings).toHaveLength(1);
    });

    it('devrait rejeter si le rôle n\'est pas admin', async () => {
        const res = await request(app)
            .get('/api/admin/ratings')
            .set('x-test-user', JSON.stringify(clientUser));

        expect(res.status).toBe(403);
    });
});
