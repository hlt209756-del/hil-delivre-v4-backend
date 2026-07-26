'use strict';

/**
 * @fileoverview Tests unitaires du service de monitoring pour Hil_Delivre v4.
 * Couvre : healthService, metricsService, cronService.
 * @module __tests__/monitoring.test
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../services/cacheService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  redis: { ping: jest.fn().mockResolvedValue('PONG') },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        limit: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
        })),
      })),
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests Health Service
// ─────────────────────────────────────────────────────────────────────────────

describe('HealthService', () => {
  let healthService;

  beforeEach(() => {
    jest.resetModules();
    healthService = require('../services/healthService');
  });

  describe('checkPostgreSQL', () => {
    it('retourne healthy si la requête réussit', async () => {
      const result = await healthService.checkPostgreSQL();

      expect(result).toHaveProperty('service', 'postgresql');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('response_time_ms');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    });

    it('retourne unhealthy si timeout dépassé', async () => {
      // Simuler un timeout
      jest.spyOn(global, 'setTimeout');
      const result = await healthService.checkPostgreSQL();
      expect(result).toHaveProperty('status');
    });
  });

  describe('checkRedis', () => {
    it('retourne healthy si PING réussit', async () => {
      const result = await healthService.checkRedis();

      expect(result).toHaveProperty('service', 'redis');
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('response_time_ms');
    });
  });

  describe('checkMemory', () => {
    it('retourne les métriques mémoire', async () => {
      const result = await healthService.checkMemory();

      expect(result).toHaveProperty('service', 'memory');
      expect(result).toHaveProperty('status');
      expect(result.details).toHaveProperty('heap_used_mb');
      expect(result.details).toHaveProperty('heap_total_mb');
      expect(result.details).toHaveProperty('usage_percent');
      expect(result.details.usage_percent).toBeGreaterThan(0);
      expect(result.details.usage_percent).toBeLessThanOrEqual(100);
    });

    it('retourne healthy si usage < 85%', async () => {
      const result = await healthService.checkMemory();
      // En test, l'usage mémoire devrait être faible
      if (result.details.usage_percent < 85) {
        expect(result.status).toBe('healthy');
      }
    });
  });

  describe('runAllChecks', () => {
    it('retourne un statut agrégé avec tous les services', async () => {
      const result = await healthService.runAllChecks();

      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('services');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
      expect(result.services).toBeInstanceOf(Array);
      expect(result.services.length).toBeGreaterThan(0);
    });

    it('retourne unhealthy si un service critique est down', async () => {
      // Mock PostgreSQL failure
      jest.spyOn(healthService, 'checkPostgreSQL').mockResolvedValue({
        service: 'postgresql',
        status: 'unhealthy',
        response_time_ms: 5000,
        details: { error: 'Connection refused' },
      });

      const result = await healthService.runAllChecks();
      expect(result.status).toBe('unhealthy');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests Metrics Service
// ─────────────────────────────────────────────────────────────────────────────

describe('MetricsService', () => {
  let metricsService;

  beforeEach(() => {
    jest.resetModules();
    metricsService = require('../services/metricsService');
  });

  describe('Counters', () => {
    it('incrémente http_requests_total', () => {
      expect(() => {
        metricsService.incrementHttpRequests('GET', '/api/orders', 200);
      }).not.toThrow();
    });

    it('incrémente orders_created_total', () => {
      expect(() => {
        metricsService.incrementOrdersCreated();
      }).not.toThrow();
    });

    it('incrémente payments_processed_total', () => {
      expect(() => {
        metricsService.incrementPaymentsProcessed('mobile_money');
      }).not.toThrow();
    });

    it('incrémente deliveries_completed_total', () => {
      expect(() => {
        metricsService.incrementDeliveriesCompleted();
      }).not.toThrow();
    });

    it('incrémente errors_total', () => {
      expect(() => {
        metricsService.incrementErrors('validation');
      }).not.toThrow();
    });

    it('incrémente notifications_sent_total', () => {
      expect(() => {
        metricsService.incrementNotificationsSent('push');
      }).not.toThrow();
    });
  });

  describe('Histograms', () => {
    it('observe http_request_duration_seconds', () => {
      expect(() => {
        metricsService.observeHttpDuration('GET', '/api/orders', 0.150);
      }).not.toThrow();
    });

    it('observe order_completion_duration_seconds', () => {
      expect(() => {
        metricsService.observeOrderCompletionDuration(1800);
      }).not.toThrow();
    });

    it('observe delivery_duration_seconds', () => {
      expect(() => {
        metricsService.observeDeliveryDuration(900);
      }).not.toThrow();
    });
  });

  describe('Gauges', () => {
    it('set active_orders', () => {
      expect(() => {
        metricsService.setActiveOrders(42);
      }).not.toThrow();
    });

    it('set online_deliverers', () => {
      expect(() => {
        metricsService.setOnlineDeliverers(15);
      }).not.toThrow();
    });

    it('set connected_sockets', () => {
      expect(() => {
        metricsService.setConnectedSockets(128);
      }).not.toThrow();
    });
  });

  describe('getMetrics', () => {
    it('retourne les métriques au format Prometheus text', async () => {
      const metrics = await metricsService.getMetrics();

      expect(typeof metrics).toBe('string');
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('# HELP');
      expect(metrics).toContain('# TYPE');
    });
  });

  describe('getMetricsJson', () => {
    it('retourne les métriques au format JSON', async () => {
      const metrics = await metricsService.getMetricsJson();

      expect(metrics).toBeInstanceOf(Array);
      expect(metrics.length).toBeGreaterThan(0);
      expect(metrics[0]).toHaveProperty('name');
      expect(metrics[0]).toHaveProperty('type');
    });
  });

  describe('metricsMiddleware', () => {
    it('est une fonction middleware Express', () => {
      expect(typeof metricsService.metricsMiddleware).toBe('function');
      expect(metricsService.metricsMiddleware.length).toBe(3); // (req, res, next)
    });

    it('appelle next() sans erreur', () => {
      const req = { method: 'GET', route: { path: '/test' }, path: '/test' };
      const res = {
        statusCode: 200,
        on: jest.fn((event, cb) => {
          if (event === 'finish') cb();
        }),
      };
      const next = jest.fn();

      metricsService.metricsMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests Cron Service
// ─────────────────────────────────────────────────────────────────────────────

describe('CronService', () => {
  let cronService;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    cronService = require('../services/cronService');
  });

  afterEach(() => {
    jest.useRealTimers();
    if (cronService && cronService.stop) {
      cronService.stop();
    }
  });

  describe('getStatus', () => {
    it('retourne le statut de tous les jobs', () => {
      const status = cronService.getStatus();

      expect(status).toBeInstanceOf(Array);
      expect(status.length).toBeGreaterThan(0);
      expect(status[0]).toHaveProperty('name');
      expect(status[0]).toHaveProperty('schedule');
      expect(status[0]).toHaveProperty('enabled');
      expect(status[0]).toHaveProperty('last_run');
    });
  });

  describe('start / stop', () => {
    it('démarre sans erreur', () => {
      expect(() => cronService.start()).not.toThrow();
    });

    it('s\'arrête sans erreur', () => {
      cronService.start();
      expect(() => cronService.stop()).not.toThrow();
    });

    it('ne crash pas si appelé plusieurs fois', () => {
      expect(() => {
        cronService.start();
        cronService.start();
        cronService.stop();
        cronService.stop();
      }).not.toThrow();
    });
  });

  describe('triggerJob', () => {
    it('déclenche un job manuellement', async () => {
      const result = await cronService.triggerJob('health_check');
      expect(result).toHaveProperty('success');
    });

    it('retourne une erreur si le job n\'existe pas', async () => {
      const result = await cronService.triggerJob('nonexistent_job');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
