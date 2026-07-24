/**
 * @file osrm.test.js
 * @description Tests unitaires pour le service OSRM (calcul de distance/durée).
 */

'use strict';

const { haversineDistance, clearCache, MAX_DISTANCE_KM } = require('../services/osrmService');

// ============================================================================
// TESTS — HAVERSINE (FALLBACK)
// ============================================================================

describe('haversineDistance', () => {
  it('should calculate distance between two points in Ouagadougou', () => {
    // Ouagadougou centre → Aéroport (~5 km)
    const distance = haversineDistance(12.3714, -1.5197, 12.3532, -1.5120);
    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(10);
  });

  it('should return 0 for same point', () => {
    const distance = haversineDistance(12.3714, -1.5197, 12.3714, -1.5197);
    expect(distance).toBe(0);
  });

  it('should calculate correctly for known distance (Paris-Lyon ~392km)', () => {
    const distance = haversineDistance(48.8566, 2.3522, 45.7640, 4.8357);
    expect(distance).toBeGreaterThan(380);
    expect(distance).toBeLessThan(410);
  });

  it('should handle negative coordinates', () => {
    const distance = haversineDistance(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(distance).toBeGreaterThan(0);
  });
});

// ============================================================================
// TESTS — CACHE
// ============================================================================

describe('clearCache', () => {
  it('should clear route cache without error', () => {
    expect(() => clearCache()).not.toThrow();
  });
});

// ============================================================================
// TESTS — CONSTANTES
// ============================================================================

describe('Constants', () => {
  it('should have MAX_DISTANCE_KM set to 30', () => {
    expect(MAX_DISTANCE_KM).toBe(30);
  });
});
