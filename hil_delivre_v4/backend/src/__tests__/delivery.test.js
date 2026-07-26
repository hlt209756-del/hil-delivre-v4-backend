/**
 * @file delivery.test.js
 * @description Tests d'intégration pour les endpoints de livraison (Sprint 5).
 * Couvre : estimation, calcul, assignation, tracking, géolocalisation.
 */

'use strict';

const request = require('supertest');
const app = require('../app');

// ============================================================================
// MOCKS
// ============================================================================

// Mock Supabase
jest.mock('../services/supabaseService', () => ({
  supabaseAdmin: {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    rpc: jest.fn().mockResolvedValue({ data: [], error: null })
  },
  supabaseClient: {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@test.com' } },
        error: null
      })
    }
  }
}));

// Mock OSRM (fetch global)
global.fetch = jest.fn();

// Mock auditService
jest.mock('../services/auditService', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(true)
}));

// Mock platformConfigService
jest.mock('../services/platformConfigService', () => ({
  getOrderCalculationRates: jest.fn().mockResolvedValue({
    delivery_base_fee: 250,
    delivery_rate_per_km_tier1: 120,
    delivery_rate_per_km_tier2: 90,
    delivery_tier1_max_km: 5,
    delivery_min_guaranteed: 500,
    surge_platform_share: 0.30
  })
}));

// ============================================================================
// HELPERS
// ============================================================================

const VALID_TOKEN = 'Bearer test-jwt-token';
const TEST_DELIVERER_ID = 'deliverer-uuid-123';
const TEST_CLIENT_ID = 'client-uuid-456';
const TEST_ORDER_ID = 'order-uuid-789';
const TEST_ASSIGNMENT_ID = 'assignment-uuid-012';

// Helper pour simuler l'authentification
function mockAuth(userId, role = 'client') {
  const { supabaseClient } = require('../services/supabaseService');
  supabaseClient.auth.getUser.mockResolvedValue({
    data: { user: { id: userId, email: `${role}@test.com` } },
    error: null
  });

  const { supabaseAdmin } = require('../services/supabaseService');
  supabaseAdmin.from.mockImplementation((table) => {
    if (table === 'profiles_data') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { user_id: userId, role, kyc_status: 'approved' },
          error: null
        })
      };
    }
    return supabaseAdmin;
  });
}

function mockOSRMSuccess(distance = 3500, duration = 600) {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      code: 'Ok',
      routes: [{
        distance,
        duration,
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }
      }]
    })
  });
}

function mockOSRMFailure() {
  global.fetch.mockRejectedValueOnce(new Error('OSRM unavailable'));
}

// ============================================================================
// TESTS — ESTIMATION DES FRAIS
// ============================================================================

describe('POST /api/delivery/estimate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_CLIENT_ID, 'client');
  });

  it('should estimate delivery fee with OSRM', async () => {
    mockOSRMSuccess(3500, 600);

    const res = await request(app)
      .post('/api/delivery/estimate')
      .set('Authorization', VALID_TOKEN)
      .send({
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197,
        delivery_latitude: 12.3900,
        delivery_longitude: -1.5100
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('estimated_fee');
    expect(res.body.data).toHaveProperty('distance_km');
    expect(res.body.data).toHaveProperty('min_fee');
    expect(res.body.data).toHaveProperty('max_fee');
    expect(res.body.data.distance_km).toBeGreaterThan(0);
  });

  it('should fallback to Haversine when OSRM is unavailable', async () => {
    mockOSRMFailure();

    const res = await request(app)
      .post('/api/delivery/estimate')
      .set('Authorization', VALID_TOKEN)
      .send({
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197,
        delivery_latitude: 12.3900,
        delivery_longitude: -1.5100
      });

    expect(res.status).toBe(200);
    expect(res.body.data.route_source).toBe('haversine_fallback');
  });

  it('should reject invalid coordinates', async () => {
    const res = await request(app)
      .post('/api/delivery/estimate')
      .set('Authorization', VALID_TOKEN)
      .send({
        merchant_latitude: 200, // Invalid
        merchant_longitude: -1.5197,
        delivery_latitude: 12.3900,
        delivery_longitude: -1.5100
      });

    expect(res.status).toBe(400);
  });

  it('should reject request without auth', async () => {
    const res = await request(app)
      .post('/api/delivery/estimate')
      .send({
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197,
        delivery_latitude: 12.3900,
        delivery_longitude: -1.5100
      });

    expect(res.status).toBe(401);
  });

  it('should reject if distance exceeds maximum', async () => {
    // Simuler une très grande distance (50 km)
    mockOSRMSuccess(50000, 3600);

    const res = await request(app)
      .post('/api/delivery/estimate')
      .set('Authorization', VALID_TOKEN)
      .send({
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197,
        delivery_latitude: 12.8000,
        delivery_longitude: -1.0000
      });

    expect(res.status).toBe(422);
  });
});

// ============================================================================
// TESTS — CALCUL DES FRAIS
// ============================================================================

describe('POST /api/delivery/calculate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_CLIENT_ID, 'client');
  });

  it('should calculate delivery fee with surge', async () => {
    mockOSRMSuccess(5000, 900);

    // Mock surge config
    const { supabaseAdmin } = require('../services/supabaseService');
    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'surge_pricing_config') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [{ day_of_week: [0,1,2,3,4,5,6], start_time: '00:00', end_time: '23:59', multiplier: 1.3, is_active: true, name: 'Test surge' }],
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_CLIENT_ID, role: 'client', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .post('/api/delivery/calculate')
      .set('Authorization', VALID_TOKEN)
      .send({
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197,
        delivery_latitude: 12.3900,
        delivery_longitude: -1.5100
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('delivery_fee');
    expect(res.body.data).toHaveProperty('surge_multiplier');
    expect(res.body.data).toHaveProperty('breakdown');
    expect(res.body.data.delivery_fee).toBeGreaterThan(0);
  });

  it('should apply minimum guaranteed fee', async () => {
    // Distance très courte (200m)
    mockOSRMSuccess(200, 30);

    const res = await request(app)
      .post('/api/delivery/calculate')
      .set('Authorization', VALID_TOKEN)
      .send({
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197,
        delivery_latitude: 12.3716,
        delivery_longitude: -1.5195
      });

    expect(res.status).toBe(200);
    expect(res.body.data.delivery_fee).toBeGreaterThanOrEqual(500); // Min garanti
  });
});

// ============================================================================
// TESTS — ASSIGNATION
// ============================================================================

describe('POST /api/delivery/assign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth('admin-uuid', 'admin');
  });

  it('should propose delivery to nearest deliverer', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: TEST_ORDER_ID, status: 'accepted', delivery_id: null, merchant_id: 'merchant-1' },
            error: null
          })
        };
      }
      if (table === 'delivery_assignments') {
        return {
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({ data: [], error: null }),
          single: jest.fn().mockResolvedValue({
            data: { id: TEST_ASSIGNMENT_ID, order_id: TEST_ORDER_ID, deliverer_id: TEST_DELIVERER_ID, status: 'proposed' },
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockResolvedValue({
            data: [{ user_id: TEST_DELIVERER_ID, role: 'deliverer', kyc_status: 'approved' }],
            error: null
          }),
          single: jest.fn().mockResolvedValue({
            data: { user_id: 'admin-uuid', role: 'admin', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    supabaseAdmin.rpc.mockResolvedValue({
      data: [{ deliverer_id: TEST_DELIVERER_ID, distance_meters: 1500, latitude: 12.37, longitude: -1.52, availability: 'online' }],
      error: null
    });

    const res = await request(app)
      .post('/api/delivery/assign')
      .set('Authorization', VALID_TOKEN)
      .send({
        order_id: TEST_ORDER_ID,
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('assignment');
    expect(res.body.data).toHaveProperty('deliverer');
  });

  it('should reject non-admin/merchant users', async () => {
    mockAuth(TEST_CLIENT_ID, 'client');

    const res = await request(app)
      .post('/api/delivery/assign')
      .set('Authorization', VALID_TOKEN)
      .send({
        order_id: TEST_ORDER_ID,
        merchant_latitude: 12.3714,
        merchant_longitude: -1.5197
      });

    expect(res.status).toBe(403);
  });
});

describe('POST /api/delivery/assignments/:assignmentId/accept', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_DELIVERER_ID, 'deliverer');
  });

  it('should accept assignment and update order', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'delivery_assignments') {
        return {
          select: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          neq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              id: TEST_ASSIGNMENT_ID,
              order_id: TEST_ORDER_ID,
              deliverer_id: TEST_DELIVERER_ID,
              status: 'proposed',
              expires_at: new Date(Date.now() + 60000).toISOString()
            },
            error: null
          })
        };
      }
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: TEST_ORDER_ID, delivery_id: null, status: 'accepted' },
            error: null
          })
        };
      }
      if (table === 'deliverer_locations') {
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({ error: null })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_DELIVERER_ID, role: 'deliverer', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .post(`/api/delivery/assignments/${TEST_ASSIGNMENT_ID}/accept`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('assignment');
    expect(res.body.data.message).toBe('Delivery assignment accepted');
  });
});

describe('POST /api/delivery/assignments/:assignmentId/reject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_DELIVERER_ID, 'deliverer');
  });

  it('should reject assignment with reason', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'delivery_assignments') {
        return {
          select: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              id: TEST_ASSIGNMENT_ID,
              order_id: TEST_ORDER_ID,
              deliverer_id: TEST_DELIVERER_ID,
              status: 'proposed',
              assignment_round: 1
            },
            error: null
          })
        };
      }
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { merchant_latitude: 12.37, merchant_longitude: -1.52, delivery_id: null },
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_DELIVERER_ID, role: 'deliverer', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .post(`/api/delivery/assignments/${TEST_ASSIGNMENT_ID}/reject`)
      .set('Authorization', VALID_TOKEN)
      .send({ reason: 'Trop loin' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBe('Assignment rejected');
  });
});

// ============================================================================
// TESTS — GÉOLOCALISATION
// ============================================================================

describe('PUT /api/delivery/location', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_DELIVERER_ID, 'deliverer');
  });

  it('should update deliverer location', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'deliverer_locations') {
        return {
          select: jest.fn().mockReturnThis(),
          upsert: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { deliverer_id: TEST_DELIVERER_ID, latitude: 12.37, longitude: -1.52, last_updated_at: new Date(Date.now() - 10000).toISOString() },
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_DELIVERER_ID, role: 'deliverer', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .put('/api/delivery/location')
      .set('Authorization', VALID_TOKEN)
      .send({
        latitude: 12.3714,
        longitude: -1.5197,
        heading: 180,
        speed: 25.5,
        accuracy: 10
      });

    expect(res.status).toBe(200);
  });

  it('should reject invalid latitude', async () => {
    const res = await request(app)
      .put('/api/delivery/location')
      .set('Authorization', VALID_TOKEN)
      .send({
        latitude: 100, // Invalid
        longitude: -1.5197
      });

    expect(res.status).toBe(400);
  });

  it('should reject non-deliverer role', async () => {
    mockAuth(TEST_CLIENT_ID, 'client');

    const res = await request(app)
      .put('/api/delivery/location')
      .set('Authorization', VALID_TOKEN)
      .send({
        latitude: 12.3714,
        longitude: -1.5197
      });

    expect(res.status).toBe(403);
  });
});

describe('PUT /api/delivery/availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_DELIVERER_ID, 'deliverer');
  });

  it('should update availability to online', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'deliverer_locations') {
        return {
          upsert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { deliverer_id: TEST_DELIVERER_ID, availability: 'online' },
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_DELIVERER_ID, role: 'deliverer', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .put('/api/delivery/availability')
      .set('Authorization', VALID_TOKEN)
      .send({ availability: 'online' });

    expect(res.status).toBe(200);
  });

  it('should reject invalid availability status', async () => {
    const res = await request(app)
      .put('/api/delivery/availability')
      .set('Authorization', VALID_TOKEN)
      .send({ availability: 'invalid_status' });

    expect(res.status).toBe(400);
  });
});

// ============================================================================
// TESTS — TRACKING
// ============================================================================

describe('POST /api/delivery/tracking/event', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_DELIVERER_ID, 'deliverer');
  });

  it('should record tracking event', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: TEST_ORDER_ID, delivery_id: TEST_DELIVERER_ID, status: 'ready' },
            error: null
          })
        };
      }
      if (table === 'delivery_tracking_events') {
        return {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: 'event-1', order_id: TEST_ORDER_ID, event_type: 'order_picked_up' },
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_DELIVERER_ID, role: 'deliverer', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .post('/api/delivery/tracking/event')
      .set('Authorization', VALID_TOKEN)
      .send({
        order_id: TEST_ORDER_ID,
        event_type: 'order_picked_up',
        latitude: 12.3714,
        longitude: -1.5197
      });

    expect(res.status).toBe(201);
  });

  it('should reject invalid event type', async () => {
    const res = await request(app)
      .post('/api/delivery/tracking/event')
      .set('Authorization', VALID_TOKEN)
      .send({
        order_id: TEST_ORDER_ID,
        event_type: 'invalid_event'
      });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/delivery/tracking/:orderId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_CLIENT_ID, 'client');
  });

  it('should return tracking history for order party', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: TEST_ORDER_ID, client_id: TEST_CLIENT_ID, merchant_id: 'merchant-1', delivery_id: TEST_DELIVERER_ID },
            error: null
          })
        };
      }
      if (table === 'delivery_tracking_events') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({
            data: [
              { id: '1', event_type: 'order_picked_up', created_at: '2024-01-01T12:00:00Z' },
              { id: '2', event_type: 'delivery_started', created_at: '2024-01-01T12:05:00Z' }
            ],
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_CLIENT_ID, role: 'client', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .get(`/api/delivery/tracking/${TEST_ORDER_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/delivery/position/:orderId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_CLIENT_ID, 'client');
  });

  it('should return deliverer position for active delivery', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'orders') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: TEST_ORDER_ID, client_id: TEST_CLIENT_ID, merchant_id: 'merchant-1', delivery_id: TEST_DELIVERER_ID, status: 'in_delivery' },
            error: null
          })
        };
      }
      if (table === 'deliverer_locations') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { latitude: 12.3714, longitude: -1.5197, heading: 90, speed: 25, last_updated_at: new Date().toISOString() },
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_CLIENT_ID, role: 'client', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .get(`/api/delivery/position/${TEST_ORDER_ID}`)
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('latitude');
    expect(res.body.data).toHaveProperty('longitude');
  });
});

// ============================================================================
// TESTS — SURGE PRICING
// ============================================================================

describe('GET /api/delivery/surge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth(TEST_CLIENT_ID, 'client');
  });

  it('should return current surge status', async () => {
    const { supabaseAdmin } = require('../services/supabaseService');

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'surge_pricing_config') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [],
            error: null
          })
        };
      }
      if (table === 'profiles_data') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { user_id: TEST_CLIENT_ID, role: 'client', kyc_status: 'approved' },
            error: null
          })
        };
      }
      return supabaseAdmin;
    });

    const res = await request(app)
      .get('/api/delivery/surge')
      .set('Authorization', VALID_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('multiplier');
    expect(res.body.data).toHaveProperty('is_surge_active');
  });
});
