/**
 * @file notification.test.js
 * @description Tests d'intégration pour les endpoints de notifications (Sprint 6).
 */

'use strict';

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
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@test.com' } },
        error: null
      })
    }
  }
}));

// Mock Socket.IO
jest.mock('../config/socketio', () => ({
  emitToUser: jest.fn(),
  emitToOrder: jest.fn(),
  emitToRole: jest.fn(),
  broadcast: jest.fn(),
  getActiveConnectionsCount: jest.fn().mockReturnValue(0)
}));

// Mock FCM
jest.mock('../services/fcmService', () => ({
  sendToUser: jest.fn().mockResolvedValue({ success: true, sent: 1 }),
  sendToUsers: jest.fn().mockResolvedValue({ success: true, sent: 2 }),
  registerToken: jest.fn().mockResolvedValue({ success: true, device: { id: 'dev-1' } }),
  unregisterToken: jest.fn().mockResolvedValue({ success: true })
}));

// Mock Audit
jest.mock('../services/auditService', () => ({
  logAuditEvent: jest.fn().mockResolvedValue(undefined)
}));

const { supabaseAdmin } = require('../services/supabaseService');
const fcmService = require('../services/fcmService');
const { emitToUser } = require('../config/socketio');

// ============================================================================
// TESTS — NOTIFICATION SERVICE
// ============================================================================

describe('Notification Service', () => {
  const notificationService = require('../services/notificationService');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendNotification', () => {
    it('should send notification to client via socket, push, and in-app', async () => {
      // Mock getUserPreferences
      supabaseAdmin.single.mockResolvedValueOnce({
        data: { push_enabled: true, sms_enabled: true, in_app_enabled: true },
        error: null
      });

      // Mock push_notifications_enabled
      supabaseAdmin.single.mockResolvedValueOnce({
        data: { push_notifications_enabled: true },
        error: null
      });

      const result = await notificationService.sendNotification({
        type: 'order_accepted',
        recipients: { client_id: 'client-123' },
        data: { order_ref: 'ORD-001', amount: 5000 },
        orderId: 'order-456'
      });

      expect(result.success).toBe(true);
      expect(result.type).toBe('order_accepted');
      expect(result.recipients_count).toBe(1);
      expect(emitToUser).toHaveBeenCalledWith(
        'client-123',
        'notification',
        expect.objectContaining({ type: 'order_accepted' })
      );
    });

    it('should throw for unknown notification type', async () => {
      await expect(
        notificationService.sendNotification({
          type: 'invalid_type',
          recipients: { client_id: 'client-123' },
          data: {}
        })
      ).rejects.toThrow('Unknown notification type');
    });

    it('should handle multiple recipients', async () => {
      // Mock for each recipient
      supabaseAdmin.single
        .mockResolvedValueOnce({ data: { push_enabled: true, in_app_enabled: true }, error: null })
        .mockResolvedValueOnce({ data: { push_notifications_enabled: true }, error: null })
        .mockResolvedValueOnce({ data: { push_enabled: true, in_app_enabled: true }, error: null })
        .mockResolvedValueOnce({ data: { push_notifications_enabled: true }, error: null });

      const result = await notificationService.sendNotification({
        type: 'order_delivered',
        recipients: { client_id: 'client-123', merchant_id: 'merchant-456' },
        data: { order_ref: 'ORD-002' }
      });

      expect(result.recipients_count).toBe(2);
    });
  });

  describe('getUserNotifications', () => {
    it('should return paginated notifications', async () => {
      const mockNotifications = [
        { id: 'n1', title: 'Test', body: 'Body', is_read: false },
        { id: 'n2', title: 'Test2', body: 'Body2', is_read: true }
      ];

      supabaseAdmin.range = jest.fn().mockResolvedValueOnce({
        data: mockNotifications,
        count: 2,
        error: null
      });

      // Mock unread count
      supabaseAdmin.single.mockResolvedValueOnce({ count: 1, error: null });

      const result = await notificationService.getUserNotifications('user-123', {
        page: 1,
        limit: 20
      });

      expect(result.notifications).toHaveLength(2);
      expect(result.page).toBe(1);
    });
  });

  describe('markAsRead', () => {
    it('should mark specific notifications as read', async () => {
      supabaseAdmin.eq.mockResolvedValueOnce({ error: null });

      const result = await notificationService.markAsRead('user-123', ['n1', 'n2']);

      expect(result.success).toBe(true);
      expect(result.marked).toBe(2);
    });

    it('should mark all as read when no IDs provided', async () => {
      supabaseAdmin.eq.mockResolvedValueOnce({ error: null });

      const result = await notificationService.markAsRead('user-123', []);

      expect(result.success).toBe(true);
      expect(result.message).toContain('All notifications');
    });
  });
});

// ============================================================================
// TESTS — OTP SERVICE
// ============================================================================

describe('OTP Service', () => {
  const otpService = require('../services/otpService');

  describe('normalizePhoneNumber', () => {
    it('should normalize +226XXXXXXXX format', () => {
      expect(otpService.normalizePhoneNumber('+22670123456')).toBe('+22670123456');
    });

    it('should normalize 8-digit format (local BF)', () => {
      expect(otpService.normalizePhoneNumber('70123456')).toBe('+22670123456');
    });

    it('should normalize 226XXXXXXXX without +', () => {
      expect(otpService.normalizePhoneNumber('22670123456')).toBe('+22670123456');
    });

    it('should normalize 0XXXXXXXXX format', () => {
      expect(otpService.normalizePhoneNumber('0701234567')).toBe('+226701234567');
    });

    it('should return null for invalid numbers', () => {
      expect(otpService.normalizePhoneNumber('123')).toBeNull();
      expect(otpService.normalizePhoneNumber('')).toBeNull();
      expect(otpService.normalizePhoneNumber(null)).toBeNull();
      expect(otpService.normalizePhoneNumber('+33612345678')).toBeNull();
    });

    it('should handle spaces and dashes', () => {
      expect(otpService.normalizePhoneNumber('+226 70 12 34 56')).toBe('+22670123456');
      expect(otpService.normalizePhoneNumber('70-12-34-56')).toBe('+22670123456');
    });
  });

  describe('sendOTP', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should reject invalid phone numbers', async () => {
      await expect(
        otpService.sendOTP('123', 'phone_verification')
      ).rejects.toThrow('Invalid phone number format');
    });

    it('should enforce rate limiting', async () => {
      // Mock: 3 OTP already sent in the last hour
      supabaseAdmin.single = jest.fn().mockResolvedValueOnce({ count: 3, error: null });

      await expect(
        otpService.sendOTP('+22670123456', 'phone_verification', 'user-123')
      ).rejects.toThrow('Too many OTP requests');
    });
  });

  describe('verifyOTP', () => {
    it('should reject invalid code format', async () => {
      await expect(
        otpService.verifyOTP('+22670123456', '12345', 'phone_verification')
      ).rejects.toThrow('OTP must be 6 digits');
    });

    it('should reject invalid phone number', async () => {
      await expect(
        otpService.verifyOTP('invalid', '123456', 'phone_verification')
      ).rejects.toThrow('Invalid phone number format');
    });
  });

  describe('Constants', () => {
    it('should have correct OTP length', () => {
      expect(otpService.OTP_LENGTH).toBe(6);
    });

    it('should have correct expiry time', () => {
      expect(otpService.OTP_EXPIRY_MINUTES).toBe(5);
    });

    it('should have correct max attempts', () => {
      expect(otpService.OTP_MAX_ATTEMPTS).toBe(3);
    });
  });
});

// ============================================================================
// TESTS — FCM SERVICE
// ============================================================================

describe('FCM Service', () => {
  describe('registerToken', () => {
    it('should register a valid token', async () => {
      const result = await fcmService.registerToken(
        'user-123',
        'fcm-token-abc',
        'android',
        'Samsung Galaxy S21'
      );

      expect(result.success).toBe(true);
    });
  });

  describe('unregisterToken', () => {
    it('should unregister a token', async () => {
      const result = await fcmService.unregisterToken('user-123', 'fcm-token-abc');
      expect(result.success).toBe(true);
    });
  });
});

// ============================================================================
// TESTS — NOTIFICATION TEMPLATES
// ============================================================================

describe('Notification Templates', () => {
  const { NOTIFICATION_TEMPLATES } = require('../services/notificationService');

  it('should have all required templates', () => {
    const requiredTypes = [
      'order_created', 'order_accepted', 'order_ready',
      'order_picked_up', 'order_in_delivery', 'order_delivered',
      'order_cancelled', 'delivery_proposed', 'delivery_accepted',
      'payment_received', 'payment_failed',
      'kyc_approved', 'kyc_rejected',
      'system_alert', 'promotion'
    ];

    for (const type of requiredTypes) {
      expect(NOTIFICATION_TEMPLATES[type]).toBeDefined();
      expect(NOTIFICATION_TEMPLATES[type].title).toBeInstanceOf(Function);
      expect(NOTIFICATION_TEMPLATES[type].body).toBeInstanceOf(Function);
      expect(NOTIFICATION_TEMPLATES[type].targets).toBeInstanceOf(Array);
    }
  });

  it('should generate correct title and body', () => {
    const template = NOTIFICATION_TEMPLATES.order_created;
    const data = { order_ref: 'ORD-001', amount: 5000 };

    expect(template.title(data)).toBe('Nouvelle commande');
    expect(template.body(data)).toContain('ORD-001');
    expect(template.body(data)).toContain('5000');
  });

  it('should target correct roles', () => {
    expect(NOTIFICATION_TEMPLATES.order_created.targets).toContain('merchant');
    expect(NOTIFICATION_TEMPLATES.order_accepted.targets).toContain('client');
    expect(NOTIFICATION_TEMPLATES.delivery_proposed.targets).toContain('deliverer');
  });
});

// ============================================================================
// TESTS — VALIDATION SCHEMAS
// ============================================================================

describe('Validation Schemas (Sprint 6)', () => {
  const {
    sendOTPSchema,
    verifyOTPSchema,
    registerDeviceSchema,
    updatePreferencesSchema,
    broadcastSchema
  } = require('../middlewares/validationSprint6');

  describe('sendOTPSchema', () => {
    it('should validate correct OTP send request', () => {
      const { error } = sendOTPSchema.validate({
        phone_number: '+22670123456',
        purpose: 'phone_verification'
      });
      expect(error).toBeUndefined();
    });

    it('should reject missing phone_number', () => {
      const { error } = sendOTPSchema.validate({ purpose: 'phone_verification' });
      expect(error).toBeDefined();
    });

    it('should reject invalid purpose', () => {
      const { error } = sendOTPSchema.validate({
        phone_number: '+22670123456',
        purpose: 'invalid'
      });
      expect(error).toBeDefined();
    });
  });

  describe('verifyOTPSchema', () => {
    it('should validate correct verify request', () => {
      const { error } = verifyOTPSchema.validate({
        phone_number: '+22670123456',
        code: '123456',
        purpose: 'phone_verification'
      });
      expect(error).toBeUndefined();
    });

    it('should reject code with wrong length', () => {
      const { error } = verifyOTPSchema.validate({
        phone_number: '+22670123456',
        code: '12345',
        purpose: 'phone_verification'
      });
      expect(error).toBeDefined();
    });

    it('should reject non-numeric code', () => {
      const { error } = verifyOTPSchema.validate({
        phone_number: '+22670123456',
        code: 'abcdef',
        purpose: 'phone_verification'
      });
      expect(error).toBeDefined();
    });
  });

  describe('registerDeviceSchema', () => {
    it('should validate correct device registration', () => {
      const { error } = registerDeviceSchema.validate({
        token: 'fcm-token-very-long-string-here',
        platform: 'android',
        device_name: 'Samsung Galaxy S21'
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid platform', () => {
      const { error } = registerDeviceSchema.validate({
        token: 'fcm-token-here',
        platform: 'windows'
      });
      expect(error).toBeDefined();
    });
  });

  describe('updatePreferencesSchema', () => {
    it('should validate correct preferences update', () => {
      const { error } = updatePreferencesSchema.validate({
        notification_type: 'order_created',
        push_enabled: true,
        sms_enabled: false
      });
      expect(error).toBeUndefined();
    });

    it('should reject invalid notification_type', () => {
      const { error } = updatePreferencesSchema.validate({
        notification_type: 'invalid_type',
        push_enabled: true
      });
      expect(error).toBeDefined();
    });
  });

  describe('broadcastSchema', () => {
    it('should validate correct broadcast request', () => {
      const { error } = broadcastSchema.validate({
        role: 'client',
        title: 'Maintenance',
        message: 'Service indisponible de 2h à 4h.'
      });
      expect(error).toBeUndefined();
    });

    it('should reject broadcast to admin role', () => {
      const { error } = broadcastSchema.validate({
        role: 'admin',
        title: 'Test',
        message: 'Test'
      });
      expect(error).toBeDefined();
    });
  });
});
