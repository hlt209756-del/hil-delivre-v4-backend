'use strict';

/**
 * @fileoverview Tests d'intégration pour le système de certification hygiène.
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
        req.user = req.headers['x-test-user'] ? JSON.parse(req.headers['x-test-user']) : merchantUser;
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
// TESTS : POST /api/merchant/certify
// ============================================================================

describe('POST /api/merchant/certify', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait créer une demande de certification avec succès', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'users') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        single: jest.fn().mockResolvedValue({
                            data: { id: 'merchant-uuid-001', role: 'merchant' },
                            error: null
                        })
                    })
                };
            }
            if (table === 'profiles_data') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { kyc_status: 'approved', wallet_balance: 10000, is_certified: false },
                                error: null
                            })
                        })
                    }),
                    update: jest.fn().mockReturnValue({
                        eq: jest.fn().mockResolvedValue({ error: null })
                    })
                };
            }
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        in: jest.fn().mockReturnThis(),
                        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
                    }),
                    insert: jest.fn().mockReturnValue({
                        select: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: {
                                    id: 'cert-uuid-001',
                                    merchant_id: 'merchant-uuid-001',
                                    status: 'pending',
                                    fee_amount: 5000,
                                    fee_paid: true,
                                    payment_reference: 'CERT-123-merchant',
                                    created_at: new Date().toISOString()
                                },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { config_value: 5000 },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'admin_wallet_transactions') {
                return {
                    insert: jest.fn().mockResolvedValue({ error: null })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/merchant/certify')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('pending');
        expect(res.body.data.fee_paid).toBe(true);
    });

    it('devrait rejeter si le KYC n\'est pas approuvé', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'users') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        single: jest.fn().mockResolvedValue({
                            data: { id: 'merchant-uuid-001', role: 'merchant' },
                            error: null
                        })
                    })
                };
            }
            if (table === 'profiles_data') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { kyc_status: 'pending', wallet_balance: 10000, is_certified: false },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { config_value: 5000 },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/merchant/certify')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('KYC');
    });

    it('devrait rejeter si le solde est insuffisant', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'users') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        single: jest.fn().mockResolvedValue({
                            data: { id: 'merchant-uuid-001', role: 'merchant' },
                            error: null
                        })
                    })
                };
            }
            if (table === 'profiles_data') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { kyc_status: 'approved', wallet_balance: 2000, is_certified: false },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        in: jest.fn().mockReturnThis(),
                        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { config_value: 5000 },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/merchant/certify')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('insuffisant');
    });

    it('devrait rejeter si le rôle n\'est pas merchant', async () => {
        const res = await request(app)
            .post('/api/merchant/certify')
            .set('x-test-user', JSON.stringify(clientUser));

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter si une certification est déjà en attente', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'users') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        single: jest.fn().mockResolvedValue({
                            data: { id: 'merchant-uuid-001', role: 'merchant' },
                            error: null
                        })
                    })
                };
            }
            if (table === 'profiles_data') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { kyc_status: 'approved', wallet_balance: 10000, is_certified: false },
                                error: null
                            })
                        })
                    })
                };
            }
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        in: jest.fn().mockReturnThis(),
                        maybeSingle: jest.fn().mockResolvedValue({
                            data: { id: 'cert-existing', status: 'pending' },
                            error: null
                        })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { config_value: 5000 },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .post('/api/merchant/certify')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toContain('attente');
    });
});

// ============================================================================
// TESTS : GET /api/merchant/certification
// ============================================================================

describe('GET /api/merchant/certification', () => {
    it('devrait récupérer le statut de certification', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        limit: jest.fn().mockReturnThis(),
                        maybeSingle: jest.fn().mockResolvedValue({
                            data: {
                                id: 'cert-uuid-001',
                                status: 'certified',
                                certification_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                                expiration_date: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000).toISOString(),
                                fee_amount: 5000,
                                fee_paid: true,
                                created_at: new Date().toISOString()
                            },
                            error: null
                        })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { config_value: 5000 },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/merchant/certification')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.is_certified).toBe(true);
        expect(res.body.data.days_remaining).toBeGreaterThan(300);
    });

    it('devrait retourner "none" si aucune certification', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        limit: jest.fn().mockReturnThis(),
                        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
                    })
                };
            }
            if (table === 'platform_config') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { config_value: 5000 },
                                error: null
                            })
                        })
                    })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .get('/api/merchant/certification')
            .set('x-test-user', JSON.stringify(merchantUser));

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('none');
        expect(res.body.data.is_certified).toBe(false);
    });
});

// ============================================================================
// TESTS : PUT /api/admin/certification-hygiene/:certificationId/approve
// ============================================================================

describe('PUT /api/admin/certification-hygiene/:certificationId/approve', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait approuver une certification (admin)', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: 'cert-uuid-001', merchant_id: 'merchant-uuid-001', status: 'pending' },
                                error: null
                            })
                        })
                    }),
                    update: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            select: jest.fn().mockReturnValue({
                                single: jest.fn().mockResolvedValue({
                                    data: {
                                        id: 'cert-uuid-001',
                                        status: 'certified',
                                        certification_date: new Date().toISOString(),
                                        expiration_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                                    },
                                    error: null
                                })
                            })
                        })
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
            if (table === 'admin_actions') {
                return {
                    insert: jest.fn().mockResolvedValue({ error: null })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .put('/api/admin/certification-hygiene/cert-uuid-001/approve')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({ notes: 'Inspection validée' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('certified');
    });

    it('devrait rejeter si le rôle n\'est pas admin', async () => {
        const res = await request(app)
            .put('/api/admin/certification-hygiene/cert-uuid-001/approve')
            .set('x-test-user', JSON.stringify(merchantUser))
            .send({});

        expect(res.status).toBe(403);
    });

    it('devrait rejeter un certificationId non UUID', async () => {
        const res = await request(app)
            .put('/api/admin/certification-hygiene/not-a-uuid/approve')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({});

        expect(res.status).toBe(400);
    });
});

// ============================================================================
// TESTS : PUT /api/admin/certification-hygiene/:certificationId/revoke
// ============================================================================

describe('PUT /api/admin/certification-hygiene/:certificationId/revoke', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('devrait révoquer une certification (admin)', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            single: jest.fn().mockResolvedValue({
                                data: { id: 'cert-uuid-001', merchant_id: 'merchant-uuid-001', status: 'certified' },
                                error: null
                            })
                        })
                    }),
                    update: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnValue({
                            select: jest.fn().mockReturnValue({
                                single: jest.fn().mockResolvedValue({
                                    data: { id: 'cert-uuid-001', status: 'revoked', rejection_reason: 'Inspection échouée' },
                                    error: null
                                })
                            })
                        })
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
            if (table === 'admin_actions') {
                return {
                    insert: jest.fn().mockResolvedValue({ error: null })
                };
            }
            return { select: jest.fn().mockReturnThis() };
        });

        const res = await request(app)
            .put('/api/admin/certification-hygiene/cert-uuid-001/revoke')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({ reason: 'Inspection échouée - conditions non conformes' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('revoked');
    });

    it('devrait rejeter sans raison', async () => {
        const res = await request(app)
            .put('/api/admin/certification-hygiene/cert-uuid-001/revoke')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('devrait rejeter avec raison trop courte', async () => {
        const res = await request(app)
            .put('/api/admin/certification-hygiene/cert-uuid-001/revoke')
            .set('x-test-user', JSON.stringify(adminUser))
            .send({ reason: 'ab' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});

// ============================================================================
// TESTS : GET /api/admin/certification-hygiene
// ============================================================================

describe('GET /api/admin/certification-hygiene', () => {
    it('devrait lister les certifications (admin)', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'certification_hygiene') {
                return {
                    select: jest.fn().mockReturnValue({
                        eq: jest.fn().mockReturnThis(),
                        lte: jest.fn().mockReturnThis(),
                        gte: jest.fn().mockReturnThis(),
                        order: jest.fn().mockReturnThis(),
                        range: jest.fn().mockResolvedValue({
                            data: [
                                { id: 'cert-1', status: 'pending', merchant_id: 'merchant-uuid-001' },
                                { id: 'cert-2', status: 'certified', merchant_id: 'merchant-uuid-002' }
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
            .get('/api/admin/certification-hygiene')
            .set('x-test-user', JSON.stringify(adminUser))
            .query({ page: 1, limit: 10 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.certifications).toHaveLength(2);
        expect(res.body.data.pagination.total).toBe(2);
    });

    it('devrait filtrer par statut', async () => {
        supabase.from.mockImplementation((table) => {
            if (table === 'certification_hygiene') {
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
            .get('/api/admin/certification-hygiene')
            .set('x-test-user', JSON.stringify(adminUser))
            .query({ status: 'pending' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('devrait rejeter un statut invalide', async () => {
        const res = await request(app)
            .get('/api/admin/certification-hygiene')
            .set('x-test-user', JSON.stringify(adminUser))
            .query({ status: 'invalid_status' });

        expect(res.status).toBe(400);
    });
});
