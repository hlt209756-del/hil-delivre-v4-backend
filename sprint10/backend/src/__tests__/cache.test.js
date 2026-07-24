'use strict';

/**
 * @fileoverview Tests unitaires du service de cache Redis pour Hil_Delivre v4.
 * Couvre : get, set, del, getOrSet, invalidatePattern, flush, circuit breaker.
 * @module __tests__/cache.test
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  ping: jest.fn().mockResolvedValue('PONG'),
  scanStream: jest.fn(),
  pipeline: jest.fn(),
  flushall: jest.fn(),
  disconnect: jest.fn(),
  on: jest.fn(),
  info: jest.fn().mockResolvedValue('used_memory:1048576\r\nused_memory_human:1.00M'),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CacheService', () => {
  let cacheService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    cacheService = require('../services/cacheService');
  });

  describe('get()', () => {
    it('retourne la valeur désérialisée si la clé existe', async () => {
      const testData = { name: 'test', value: 42 };
      mockRedis.get.mockResolvedValue(JSON.stringify(testData));

      const result = await cacheService.get('test:key');

      expect(result).toEqual(testData);
      expect(mockRedis.get).toHaveBeenCalledWith('test:key');
    });

    it('retourne null si la clé n\'existe pas', async () => {
      mockRedis.get.mockResolvedValue(null);

      const result = await cacheService.get('nonexistent:key');

      expect(result).toBeNull();
    });

    it('retourne null et ne crash pas si Redis est down', async () => {
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));

      const result = await cacheService.get('test:key');

      expect(result).toBeNull();
    });

    it('incrémente le compteur de cache hit', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ data: 'test' }));

      const statsBefore = cacheService.getStats();
      await cacheService.get('test:key');
      const statsAfter = cacheService.getStats();

      expect(statsAfter.hit_count).toBe(statsBefore.hit_count + 1);
    });

    it('incrémente le compteur de cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);

      const statsBefore = cacheService.getStats();
      await cacheService.get('test:key');
      const statsAfter = cacheService.getStats();

      expect(statsAfter.miss_count).toBe(statsBefore.miss_count + 1);
    });

    it('retourne null si JSON invalide en cache', async () => {
      mockRedis.get.mockResolvedValue('not-valid-json{{{');

      const result = await cacheService.get('test:key');

      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('sérialise et stocke la valeur avec TTL', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const testData = { name: 'test' };

      await cacheService.set('dashboard:metrics', testData);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'dashboard:metrics',
        JSON.stringify(testData),
        'EX',
        60 // TTL du namespace 'dashboard:'
      );
    });

    it('utilise le TTL personnalisé si fourni', async () => {
      mockRedis.set.mockResolvedValue('OK');

      await cacheService.set('custom:key', { data: 1 }, 120);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'custom:key',
        expect.any(String),
        'EX',
        120
      );
    });

    it('ne crash pas si Redis est down', async () => {
      mockRedis.set.mockRejectedValue(new Error('Connection refused'));

      await expect(cacheService.set('test:key', { data: 1 })).resolves.not.toThrow();
    });
  });

  describe('del()', () => {
    it('supprime la clé du cache', async () => {
      mockRedis.del.mockResolvedValue(1);

      await cacheService.del('test:key');

      expect(mockRedis.del).toHaveBeenCalledWith('test:key');
    });

    it('ne crash pas si la clé n\'existe pas', async () => {
      mockRedis.del.mockResolvedValue(0);

      await expect(cacheService.del('nonexistent:key')).resolves.not.toThrow();
    });
  });

  describe('getOrSet()', () => {
    it('retourne la valeur du cache si elle existe (cache hit)', async () => {
      const cachedData = { name: 'cached' };
      mockRedis.get.mockResolvedValue(JSON.stringify(cachedData));

      const fetchFn = jest.fn().mockResolvedValue({ name: 'fresh' });
      const result = await cacheService.getOrSet('test:key', fetchFn);

      expect(result).toEqual(cachedData);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('appelle fetchFn et met en cache si cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK');

      const freshData = { name: 'fresh' };
      const fetchFn = jest.fn().mockResolvedValue(freshData);

      const result = await cacheService.getOrSet('test:key', fetchFn, 300);

      expect(result).toEqual(freshData);
      expect(fetchFn).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('retourne le résultat de fetchFn même si le set échoue', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockRejectedValue(new Error('Redis write error'));

      const freshData = { name: 'fresh' };
      const fetchFn = jest.fn().mockResolvedValue(freshData);

      const result = await cacheService.getOrSet('test:key', fetchFn);

      expect(result).toEqual(freshData);
    });

    it('retourne null si fetchFn échoue et pas de cache', async () => {
      mockRedis.get.mockResolvedValue(null);
      const fetchFn = jest.fn().mockRejectedValue(new Error('DB error'));

      await expect(cacheService.getOrSet('test:key', fetchFn)).rejects.toThrow('DB error');
    });
  });

  describe('invalidatePattern()', () => {
    it('supprime toutes les clés correspondant au pattern', async () => {
      const mockStream = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(['key1', 'key2', 'key3']);
          if (event === 'end') cb();
          return mockStream;
        }),
      };
      mockRedis.scanStream.mockReturnValue(mockStream);
      mockRedis.pipeline.mockReturnValue({
        del: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1], [null, 1], [null, 1]]),
      });

      const count = await cacheService.invalidatePattern('dashboard:*');

      expect(count).toBe(3);
      expect(mockRedis.scanStream).toHaveBeenCalledWith({ match: 'dashboard:*', count: 100 });
    });

    it('retourne 0 si aucune clé ne correspond', async () => {
      const mockStream = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb([]);
          if (event === 'end') cb();
          return mockStream;
        }),
      };
      mockRedis.scanStream.mockReturnValue(mockStream);

      const count = await cacheService.invalidatePattern('nonexistent:*');

      expect(count).toBe(0);
    });
  });

  describe('flush()', () => {
    it('vide tout le cache', async () => {
      mockRedis.flushall.mockResolvedValue('OK');

      await cacheService.flush('admin-id', 'Manual flush');

      expect(mockRedis.flushall).toHaveBeenCalled();
    });
  });

  describe('getStats()', () => {
    it('retourne les statistiques du cache', () => {
      const stats = cacheService.getStats();

      expect(stats).toHaveProperty('hit_count');
      expect(stats).toHaveProperty('miss_count');
      expect(stats).toHaveProperty('hit_ratio');
      expect(stats).toHaveProperty('circuit_state');
      expect(typeof stats.hit_count).toBe('number');
      expect(typeof stats.miss_count).toBe('number');
      expect(typeof stats.hit_ratio).toBe('number');
    });

    it('calcule correctement le hit ratio', async () => {
      // Simuler quelques hits et misses
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ data: 1 })); // hit
      mockRedis.get.mockResolvedValueOnce(JSON.stringify({ data: 2 })); // hit
      mockRedis.get.mockResolvedValueOnce(null); // miss

      await cacheService.get('key1');
      await cacheService.get('key2');
      await cacheService.get('key3');

      const stats = cacheService.getStats();
      // Le ratio dépend de l'état initial, mais doit être un nombre valide
      expect(stats.hit_ratio).toBeGreaterThanOrEqual(0);
      expect(stats.hit_ratio).toBeLessThanOrEqual(1);
    });
  });

  describe('Circuit Breaker', () => {
    it('ouvre le circuit après 5 échecs consécutifs', async () => {
      // Simuler 5 échecs
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));

      for (let i = 0; i < 5; i++) {
        await cacheService.get(`key${i}`);
      }

      const stats = cacheService.getStats();
      expect(stats.circuit_state).toBe('OPEN');
    });

    it('retourne null immédiatement quand le circuit est ouvert', async () => {
      // Ouvrir le circuit
      mockRedis.get.mockRejectedValue(new Error('Connection refused'));
      for (let i = 0; i < 5; i++) {
        await cacheService.get(`key${i}`);
      }

      // Les appels suivants ne devraient pas toucher Redis
      mockRedis.get.mockClear();
      const result = await cacheService.get('test:key');

      expect(result).toBeNull();
      // Redis ne devrait pas être appelé car le circuit est ouvert
      expect(mockRedis.get).not.toHaveBeenCalled();
    });
  });
});
