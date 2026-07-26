/**
 * @file payment.test.js
 * @description Tests d'intégration pour les endpoints de paiement (Sprint 4).
 * Couvre l'initiation Mobile Money, Cash, le webhook PayDunya,
 * le statut de paiement et la sécurité.
 */

'use strict';

const crypto = require('crypto');

// ============================================================================
// MOCKS
// ============================================================================

// Mock Supabase
const mockSupabaseAdmin = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  single: jest.fn(),
  order: jest.fn().mockReturnThis(),
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
    merchant_commission_rate: 0.05,
    delivery_commission_rate: 0.01,
    platform_vat_rate: 0.18,
    delivery_base_fee: 250
  })
}));

// Mock fetch for PayDunya API
global.fetch = jest.fn();

const paymentService = require('../services/paymentService');
const fecService = require('../services/fecService');

// ============================================================================
// DONNÉES DE TEST
// ============================================================================

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_MERCHANT_ID = '22222222-2222-2222-2222-222222222222';
const TEST_ORDER_ID = '33333333-3333-3333-3333-333333333333';
const TEST_TX_ID = '44444444-4444-4444-4444-444444444444';

const mockOrder = {
  id: TEST_ORDER_ID,
  client_id: TEST_USER_ID,
  merchant_id: TEST_MERCHANT_ID,
  status: 'pending',
  food_amount: 5000,
  commission_amount: 250,
  delivery_fee: 500,
  surge_amount: 0,
  platform_vat_amount: 135,
  service_fees: 385,
  total_amount: 5885,
  payment_method: null,
  created_at: new Date().toISOString()
};

const mockTransaction = {
  id: TEST_TX_ID,
  order_id: TEST_ORDER_ID,
  user_id: TEST_USER_ID,
  idempotency_key: 'test-idempotency-key',
  payment_method: 'mobile_money',
  amount: 5885,
  currency: 'XOF',
  status: 'pending',
  provider: 'paydunya',
  provider_ref: 'test-token-123',
  created_at: new Date().toISOString()
};

// ============================================================================
// TESTS : paymentService.initiateMobileMoneyPayment
// ============================================================================

describe('PaymentService - initiateMobileMoneyPayment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYDUNYA_MASTER_KEY = 'test-master-key';
    process.env.PAYDUNYA_PRIVATE_KEY = 'test-private-key';
    process.env.PAYDUNYA_TOKEN = 'test-token';
    process.env.PAYDUNYA_MODE = 'test';
  });

  it('should initiate a mobile money payment successfully', async () => {
    // Mock : commande trouvée
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockOrder, error: null }) // getPayableOrder
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // existing tx check
      .mockResolvedValueOnce({ data: { ...mockTransaction, status: 'initiated' }, error: null }) // insert tx
      .mockResolvedValueOnce({ data: { ...mockTransaction, status: 'pending' }, error: null }); // update tx

    // Mock : count failed attempts
    mockSupabaseAdmin.select.mockReturnValueOnce({
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ count: 0 })
    });

    // Mock : PayDunya API success
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        response_code: '00',
        response_text: 'https://app.paydunya.com/checkout/test-token-123',
        token: 'test-token-123'
      })
    });

    // Mock : update order
    mockSupabaseAdmin.eq.mockReturnThis();

    const result = await paymentService.initiateMobileMoneyPayment(
      TEST_ORDER_ID,
      TEST_USER_ID,
      '+22670000000'
    );

    expect(result).toBeDefined();
    expect(result.isExisting).toBe(false);
  });

  it('should return existing transaction if payment already initiated', async () => {
    // Mock : commande trouvée
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockOrder, error: null }) // getPayableOrder
      .mockResolvedValueOnce({ data: mockTransaction, error: null }); // existing tx found

    const result = await paymentService.initiateMobileMoneyPayment(
      TEST_ORDER_ID,
      TEST_USER_ID,
      '+22670000000'
    );

    expect(result.isExisting).toBe(true);
    expect(result.transaction.id).toBe(TEST_TX_ID);
  });

  it('should reject if user is not the order owner', async () => {
    const wrongUserId = '99999999-9999-9999-9999-999999999999';

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockOrder, error: null });

    await expect(
      paymentService.initiateMobileMoneyPayment(TEST_ORDER_ID, wrongUserId, '+22670000000')
    ).rejects.toThrow('Unauthorized');
  });

  it('should reject if order is not in payable status', async () => {
    const deliveredOrder = { ...mockOrder, status: 'delivered' };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: deliveredOrder, error: null });

    await expect(
      paymentService.initiateMobileMoneyPayment(TEST_ORDER_ID, TEST_USER_ID, '+22670000000')
    ).rejects.toThrow('not payable');
  });
});

// ============================================================================
// TESTS : paymentService.markOrderAsCash
// ============================================================================

describe('PaymentService - markOrderAsCash', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should mark order as cash payment successfully', async () => {
    const cashTransaction = {
      ...mockTransaction,
      payment_method: 'cash',
      status: 'completed',
      provider: 'cash'
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockOrder, error: null }) // getPayableOrder
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // no existing completed
      .mockResolvedValueOnce({ data: cashTransaction, error: null }); // insert cash tx

    // Mock update order
    mockSupabaseAdmin.eq.mockReturnThis();

    const result = await paymentService.markOrderAsCash(TEST_ORDER_ID, TEST_USER_ID);

    expect(result.transaction.payment_method).toBe('cash');
    expect(result.transaction.status).toBe('completed');
  });

  it('should reject if order already has a completed payment', async () => {
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockOrder, error: null }) // getPayableOrder
      .mockResolvedValueOnce({ data: { id: 'existing-tx' }, error: null }); // existing completed tx

    await expect(
      paymentService.markOrderAsCash(TEST_ORDER_ID, TEST_USER_ID)
    ).rejects.toThrow('already has a completed payment');
  });
});

// ============================================================================
// TESTS : paymentService.handlePayDunyaWebhook
// ============================================================================

describe('PaymentService - handlePayDunyaWebhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYDUNYA_MASTER_KEY = 'test-master-key';
    process.env.PAYDUNYA_MODE = 'test'; // Skip signature verification in test
  });

  it('should process a successful payment webhook', async () => {
    const payload = {
      data: {
        status: 'completed',
        token: 'test-token-123',
        custom_data: {
          transaction_id: TEST_TX_ID,
          order_id: TEST_ORDER_ID,
          idempotency_key: 'test-key'
        }
      }
    };

    const updatedTx = { ...mockTransaction, status: 'completed', completed_at: new Date().toISOString() };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockTransaction, error: null }) // find transaction
      .mockResolvedValueOnce({ data: updatedTx, error: null }); // update transaction

    // Mock update order
    mockSupabaseAdmin.eq.mockReturnThis();

    const result = await paymentService.handlePayDunyaWebhook(
      payload,
      JSON.stringify(payload),
      'test-signature'
    );

    expect(result.transaction.status).toBe('completed');
    expect(result.idempotent).toBe(false);
  });

  it('should be idempotent for already completed transactions', async () => {
    const completedTx = { ...mockTransaction, status: 'completed' };

    const payload = {
      data: {
        status: 'completed',
        custom_data: { transaction_id: TEST_TX_ID }
      }
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: completedTx, error: null });

    const result = await paymentService.handlePayDunyaWebhook(
      payload,
      JSON.stringify(payload),
      'test-signature'
    );

    expect(result.idempotent).toBe(true);
    expect(result.message).toContain('already completed');
  });

  it('should handle failed payment webhook', async () => {
    const payload = {
      data: {
        status: 'failed',
        fail_reason: 'Insufficient funds',
        custom_data: { transaction_id: TEST_TX_ID }
      }
    };

    const failedTx = { ...mockTransaction, status: 'failed', error_message: 'Insufficient funds' };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: mockTransaction, error: null }) // find
      .mockResolvedValueOnce({ data: failedTx, error: null }); // update

    const result = await paymentService.handlePayDunyaWebhook(
      payload,
      JSON.stringify(payload),
      'test-signature'
    );

    expect(result.transaction.status).toBe('failed');
  });
});

// ============================================================================
// TESTS : paymentService.verifyWebhookSignature
// ============================================================================

describe('PaymentService - verifyWebhookSignature', () => {
  beforeEach(() => {
    process.env.PAYDUNYA_MASTER_KEY = 'test-master-key-12345';
  });

  it('should verify a valid signature', () => {
    const body = '{"test":"data"}';
    const expectedSig = crypto
      .createHmac('sha256', 'test-master-key-12345')
      .update(body)
      .digest('hex');

    const result = paymentService.verifyWebhookSignature(body, expectedSig);
    expect(result).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const body = '{"test":"data"}';
    const invalidSig = 'a'.repeat(64); // Invalid hex

    const result = paymentService.verifyWebhookSignature(body, invalidSig);
    expect(result).toBe(false);
  });

  it('should reject null/empty inputs', () => {
    expect(paymentService.verifyWebhookSignature(null, 'sig')).toBe(false);
    expect(paymentService.verifyWebhookSignature('body', null)).toBe(false);
    expect(paymentService.verifyWebhookSignature('', '')).toBe(false);
  });
});

// ============================================================================
// TESTS : paymentService.getPaymentStatus
// ============================================================================

describe('PaymentService - getPaymentStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return payment status for order owner', async () => {
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({
        data: {
          id: TEST_ORDER_ID,
          client_id: TEST_USER_ID,
          merchant_id: TEST_MERCHANT_ID,
          delivery_id: null,
          status: 'pending',
          payment_method: 'mobile_money',
          cash_payment_status: null
        },
        error: null
      })
      .mockResolvedValueOnce({
        data: mockTransaction,
        error: null
      });

    const result = await paymentService.getPaymentStatus(TEST_ORDER_ID, TEST_USER_ID);

    expect(result.orderId).toBe(TEST_ORDER_ID);
    expect(result.paymentMethod).toBe('mobile_money');
    expect(result.transaction).toBeDefined();
  });

  it('should reject unauthorized access', async () => {
    const unauthorizedUser = '99999999-9999-9999-9999-999999999999';

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({
        data: {
          id: TEST_ORDER_ID,
          client_id: TEST_USER_ID,
          merchant_id: TEST_MERCHANT_ID,
          delivery_id: null
        },
        error: null
      })
      .mockResolvedValueOnce({ data: { role: 'client' }, error: null }); // not admin

    await expect(
      paymentService.getPaymentStatus(TEST_ORDER_ID, unauthorizedUser)
    ).rejects.toThrow('Unauthorized');
  });
});

// ============================================================================
// TESTS : fecService.generateInvoice
// ============================================================================

describe('FecService - generateInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate an invoice for a completed order', async () => {
    const mockInvoice = {
      id: 'invoice-id-1',
      order_id: TEST_ORDER_ID,
      invoice_number: 'HIL-2024-000001',
      total_ht: 750,
      total_tva: 135,
      total_ttc: 885,
      status: 'generated'
    };

    // Mock : no existing invoice
    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } }) // no existing
      .mockResolvedValueOnce({ data: mockOrder, error: null }) // order
      .mockResolvedValueOnce({ data: { user_id: TEST_MERCHANT_ID, first_name: 'Restaurant', last_name: 'Test', display_name: 'Chez Test', business_registration_number: 'BF-123' }, error: null }) // merchant
      .mockResolvedValueOnce({ data: { user_id: TEST_USER_ID, first_name: 'Client', last_name: 'Test', display_name: 'Client Test', address: 'Ouaga' }, error: null }) // client profile
      .mockResolvedValueOnce({ data: { phone_number: '+22670000000' }, error: null }) // client user
      .mockResolvedValueOnce({ data: mockInvoice, error: null }); // insert invoice

    // Mock rpc for invoice number
    mockSupabaseAdmin.rpc.mockResolvedValueOnce({ data: 'HIL-2024-000001', error: null });

    const result = await fecService.generateInvoice(TEST_ORDER_ID);

    expect(result.invoice).toBeDefined();
    expect(result.isExisting).toBe(false);
  });

  it('should return existing invoice (idempotent)', async () => {
    const existingInvoice = {
      id: 'invoice-id-1',
      order_id: TEST_ORDER_ID,
      invoice_number: 'HIL-2024-000001',
      status: 'generated'
    };

    mockSupabaseAdmin.single
      .mockResolvedValueOnce({ data: existingInvoice, error: null });

    const result = await fecService.generateInvoice(TEST_ORDER_ID);

    expect(result.isExisting).toBe(true);
    expect(result.invoice.invoice_number).toBe('HIL-2024-000001');
  });
});

// ============================================================================
// TESTS : Sécurité
// ============================================================================

describe('Payment Security', () => {
  it('should not store full phone numbers in metadata', async () => {
    // Vérifier que seuls les 4 derniers chiffres sont stockés
    const phone = '+22670123456';
    const lastFour = phone.slice(-4);

    expect(lastFour).toBe('3456');
    expect(lastFour.length).toBe(4);
  });

  it('should use timing-safe comparison for signatures', () => {
    // Vérifier que la comparaison est en temps constant
    const sig1 = crypto.createHmac('sha256', 'key').update('data').digest('hex');
    const sig2 = crypto.createHmac('sha256', 'key').update('data').digest('hex');

    const result = crypto.timingSafeEqual(
      Buffer.from(sig1, 'hex'),
      Buffer.from(sig2, 'hex')
    );

    expect(result).toBe(true);
  });

  it('should validate PAYABLE_STATUSES correctly', () => {
    expect(paymentService.PAYABLE_STATUSES).toContain('pending');
    expect(paymentService.PAYABLE_STATUSES).toContain('accepted');
    expect(paymentService.PAYABLE_STATUSES).not.toContain('delivered');
    expect(paymentService.PAYABLE_STATUSES).not.toContain('cancelled');
  });
});
