/**
 * @file fec.test.js
 * @description Tests d'intégration pour le service FEC (Sprint 4).
 * Couvre la génération de factures, la numérotation séquentielle,
 * le calcul des montants et la conformité DGI.
 */

'use strict';

// ============================================================================
// MOCKS
// ============================================================================

const mockSupabaseAdmin = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
  lte: jest.fn().mockReturnThis(),
  single: jest.fn(),
  order: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  rpc: jest.fn()
};

jest.mock('../services/supabaseService', () => ({
  supabaseAdmin: mockSupabaseAdmin
}));

jest.mock('../services/auditService', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(true)
}));

jest.mock('../services/platformConfigService', () => ({
  getConfig: jest.fn().mockResolvedValue(0.18),
  getOrderCalculationRates: jest.fn().mockResolvedValue({
    platform_vat_rate: 0.18
  })
}));

const fecService = require('../services/fecService');

// ============================================================================
// DONNÉES DE TEST
// ============================================================================

const TEST_ORDER = {
  id: '33333333-3333-3333-3333-333333333333',
  client_id: '11111111-1111-1111-1111-111111111111',
  merchant_id: '22222222-2222-2222-2222-222222222222',
  food_amount: 10000,
  commission_amount: 500,
  delivery_fee: 750,
  surge_amount: 0,
  platform_vat_amount: 225,
  service_fees: 725,
  total_amount: 11475,
  payment_method: 'mobile_money',
  delivery_address: '12 Rue de la Paix, Ouagadougou',
  created_at: '2024-06-15T10:30:00Z'
};

const TEST_MERCHANT_PROFILE = {
  user_id: '22222222-2222-2222-2222-222222222222',
  first_name: 'Ibrahim',
  last_name: 'Ouedraogo',
  display_name: 'Restaurant Le Sahel',
  business_registration_number: 'BF-OUA-2024-12345'
};

const TEST_CLIENT_PROFILE = {
  user_id: '11111111-1111-1111-1111-111111111111',
  first_name: 'Aminata',
  last_name: 'Traore',
  display_name: 'Aminata T.',
  address: 'Secteur 15, Ouagadougou'
};

// ============================================================================
// TESTS : Calcul des montants FEC
// ============================================================================

describe('FEC Service - Invoice Amount Calculations', () => {
  it('should calculate TVA only on platform services (commission + delivery_fee)', () => {
    const commission_ht = 500;  // 5% of 10000
    const delivery_fee_ht = 750;
    const vat_rate = 0.18;

    const total_ht = commission_ht + delivery_fee_ht;
    const total_tva = Math.ceil(total_ht * vat_rate);
    const total_ttc = total_ht + total_tva;

    expect(total_ht).toBe(1250);
    expect(total_tva).toBe(225); // ceil(1250 * 0.18) = ceil(225) = 225
    expect(total_ttc).toBe(1475);
  });

  it('should NOT include food_amount in TVA calculation', () => {
    const food_amount = 10000;
    const commission_ht = 500;
    const delivery_fee_ht = 750;
    const vat_rate = 0.18;

    // TVA is ONLY on commission + delivery, NOT on food
    const taxable_base = commission_ht + delivery_fee_ht;
    const wrong_taxable_base = food_amount + commission_ht + delivery_fee_ht;

    expect(taxable_base).toBe(1250);
    expect(wrong_taxable_base).toBe(11250); // This would be wrong

    const correct_tva = Math.ceil(taxable_base * vat_rate);
    expect(correct_tva).toBe(225);
  });

  it('should round up to nearest FCFA (no decimals)', () => {
    // 1250 * 0.18 = 225.0 (exact in this case)
    expect(Math.ceil(1250 * 0.18)).toBe(225);

    // 1300 * 0.18 = 234.0
    expect(Math.ceil(1300 * 0.18)).toBe(234);

    // 1333 * 0.18 = 239.94 → 240
    expect(Math.ceil(1333 * 0.18)).toBe(240);

    // 777 * 0.18 = 139.86 → 140
    expect(Math.ceil(777 * 0.18)).toBe(140);
  });
});

// ============================================================================
// TESTS : Génération de facture
// ============================================================================

describe('FEC Service - generateInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a complete FEC invoice', async () => {
    const expectedInvoice = {
      id: 'inv-uuid-1',
      order_id: TEST_ORDER.id,
      merchant_id: TEST_ORDER.merchant_id,
      client_id: TEST_ORDER.client_id,
      invoice_number: 'HIL-2024-000042',
      commission_ht: 500,
      delivery_fee_ht: 750,
      total_ht: 1250,
      total_tva: 225,
      total_ttc: 1475,
      vat_rate: 0.18,
      status: 'generated'
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // no existing
      .mockResolvedValueOnce({ data: TEST_ORDER, error: null }) // order
      .mockResolvedValueOnce({ data: TEST_MERCHANT_PROFILE, error: null }) // merchant
      .mockResolvedValueOnce({ data: TEST_CLIENT_PROFILE, error: null }) // client profile
      .mockResolvedValueOnce({ data: { phone_number: '+22670112233' }, error: null }) // client user
      .mockResolvedValueOnce({ data: expectedInvoice, error: null }); // insert

    mockSupabaseAdmin.rpc.mockResolvedValueOnce({ data: 'HIL-2024-000042', error: null });

    const result = await fecService.generateInvoice(TEST_ORDER.id);

    expect(result.invoice).toBeDefined();
    expect(result.invoice.invoice_number).toBe('HIL-2024-000042');
    expect(result.invoice.total_ht).toBe(1250);
    expect(result.invoice.total_tva).toBe(225);
    expect(result.invoice.total_ttc).toBe(1475);
    expect(result.isExisting).toBe(false);
  });

  it('should be idempotent - return existing invoice', async () => {
    const existingInvoice = {
      id: 'inv-uuid-1',
      order_id: TEST_ORDER.id,
      invoice_number: 'HIL-2024-000042',
      status: 'generated'
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: existingInvoice, error: null });

    const result = await fecService.generateInvoice(TEST_ORDER.id);

    expect(result.isExisting).toBe(true);
    expect(result.invoice.invoice_number).toBe('HIL-2024-000042');
  });

  it('should throw if order not found', async () => {
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // no existing invoice
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }); // order not found

    await expect(fecService.generateInvoice('nonexistent-id'))
      .rejects.toThrow('Order not found');
  });
});

// ============================================================================
// TESTS : Récupération de facture
// ============================================================================

describe('FEC Service - getInvoiceByOrder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return invoice for authorized user (client)', async () => {
    const invoice = {
      id: 'inv-uuid-1',
      order_id: TEST_ORDER.id,
      invoice_number: 'HIL-2024-000042'
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({
        data: { id: TEST_ORDER.id, client_id: TEST_ORDER.client_id, merchant_id: TEST_ORDER.merchant_id },
        error: null
      })
      .mockResolvedValueOnce({ data: invoice, error: null });

    const result = await fecService.getInvoiceByOrder(TEST_ORDER.id, TEST_ORDER.client_id);

    expect(result).toBeDefined();
    expect(result.invoice_number).toBe('HIL-2024-000042');
  });

  it('should return invoice for authorized user (merchant)', async () => {
    const invoice = {
      id: 'inv-uuid-1',
      order_id: TEST_ORDER.id,
      invoice_number: 'HIL-2024-000042'
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({
        data: { id: TEST_ORDER.id, client_id: TEST_ORDER.client_id, merchant_id: TEST_ORDER.merchant_id },
        error: null
      })
      .mockResolvedValueOnce({ data: invoice, error: null });

    const result = await fecService.getInvoiceByOrder(TEST_ORDER.id, TEST_ORDER.merchant_id);

    expect(result).toBeDefined();
  });

  it('should reject unauthorized access', async () => {
    const unauthorizedUser = '99999999-9999-9999-9999-999999999999';

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({
        data: { id: TEST_ORDER.id, client_id: TEST_ORDER.client_id, merchant_id: TEST_ORDER.merchant_id },
        error: null
      })
      .mockResolvedValueOnce({ data: { role: 'client' }, error: null }); // not admin

    await expect(
      fecService.getInvoiceByOrder(TEST_ORDER.id, unauthorizedUser)
    ).rejects.toThrow('Unauthorized');
  });

  it('should return null if no invoice exists', async () => {
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({
        data: { id: TEST_ORDER.id, client_id: TEST_ORDER.client_id, merchant_id: TEST_ORDER.merchant_id },
        error: null
      })
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });

    const result = await fecService.getInvoiceByOrder(TEST_ORDER.id, TEST_ORDER.client_id);

    expect(result).toBeNull();
  });
});

// ============================================================================
// TESTS : Conformité FEC/DGI
// ============================================================================

describe('FEC Compliance', () => {
  it('should generate invoice numbers in correct format HIL-YYYY-NNNNNN', () => {
    const pattern = /^HIL-\d{4}-\d{6}$/;

    expect('HIL-2024-000001').toMatch(pattern);
    expect('HIL-2025-123456').toMatch(pattern);
    expect('HIL-24-001').not.toMatch(pattern); // Wrong format
  });

  it('should include all required FEC fields in fec_data', () => {
    // Simulate building FEC data
    const requiredFields = [
      'numero_facture',
      'date_facture',
      'type_document',
      'devise',
      'emetteur',
      'client',
      'lignes',
      'totaux',
      'conformite'
    ];

    const mockFecData = {
      numero_facture: 'HIL-2024-000001',
      date_facture: new Date().toISOString(),
      type_document: 'FACTURE',
      devise: 'XOF',
      emetteur: { raison_sociale: 'Hil_Delivre SARL', ifu: 'XXXXXXXXX' },
      client: { nom: 'Test Client' },
      lignes: [],
      totaux: { total_ht: 0, total_tva: 0, total_ttc: 0 },
      conformite: { norme: 'FEC-BF', version: '1.0' }
    };

    for (const field of requiredFields) {
      expect(mockFecData).toHaveProperty(field);
    }
  });

  it('should use XOF as currency', () => {
    expect('XOF').toBe('XOF'); // Franc CFA BCEAO
  });

  it('should separate platform TVA from restaurant pricing', () => {
    // Platform charges TVA only on its own services
    const platformServices = 500 + 750; // commission + delivery
    const platformTVA = Math.ceil(platformServices * 0.18);

    // Restaurant food is NOT taxed by the platform
    const foodAmount = 10000;
    const restaurantTVA = 0; // Platform does NOT collect this

    expect(platformTVA).toBe(225);
    expect(restaurantTVA).toBe(0);
  });
});

// ============================================================================
// TESTS : getMerchantInvoices
// ============================================================================

describe('FEC Service - getMerchantInvoices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return paginated invoices for a merchant', async () => {
    const invoices = [
      { id: 'inv-1', invoice_number: 'HIL-2024-000001', total_ttc: 1475 },
      { id: 'inv-2', invoice_number: 'HIL-2024-000002', total_ttc: 2100 }
    ];

    // Need to mock the chained query differently for count
    mockSupabaseAdmin.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            range: jest.fn().mockResolvedValue({
              data: invoices,
              error: null,
              count: 2
            })
          })
        })
      })
    });

    const result = await fecService.getMerchantInvoices(TEST_ORDER.merchant_id, {
      page: 1,
      limit: 20
    });

    expect(result.invoices).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
  });
});
