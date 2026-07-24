/**
 * @file osrmService.js
 * @description Service de calcul de distance et durée via OSRM (Open Source Routing Machine).
 * Utilise l'instance publique OSRM ou une instance self-hosted pour le calcul
 * d'itinéraires routiers au Burkina Faso.
 * 
 * Documentation OSRM : http://project-osrm.org/docs/v5.24.0/api/
 */

'use strict';

// ============================================================================
// CONFIGURATION
// ============================================================================

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const OSRM_PROFILE = 'driving'; // driving, cycling, walking
const REQUEST_TIMEOUT_MS = 10000; // 10 secondes

// Facteur de correction pour Ouagadougou (routes non optimales, trafic)
const DISTANCE_CORRECTION_FACTOR = 1.15;
const DURATION_CORRECTION_FACTOR = 1.3;

// Limites de sécurité
const MAX_DISTANCE_KM = 30;
const MIN_DISTANCE_KM = 0.1;

// Cache simple en mémoire pour les routes fréquentes (TTL 10 min)
const routeCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

// ============================================================================
// FONCTIONS UTILITAIRES INTERNES
// ============================================================================

/**
 * Génère une clé de cache basée sur les coordonnées (arrondi à 4 décimales).
 * @param {number} originLat
 * @param {number} originLng
 * @param {number} destLat
 * @param {number} destLng
 * @returns {string}
 */
function getCacheKey(originLat, originLng, destLat, destLng) {
  return `${originLat.toFixed(4)},${originLng.toFixed(4)}-${destLat.toFixed(4)},${destLng.toFixed(4)}`;
}

/**
 * Vérifie si une entrée de cache est encore valide.
 * @param {Object} entry
 * @returns {boolean}
 */
function isCacheValid(entry) {
  return entry && (Date.now() - entry.timestamp) < CACHE_TTL_MS;
}

/**
 * Valide les coordonnées GPS.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean}
 */
function isValidCoordinate(lat, lng) {
  return (
    typeof lat === 'number' && !isNaN(lat) &&
    typeof lng === 'number' && !isNaN(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

/**
 * Calcul de distance Haversine (fallback si OSRM est indisponible).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance en km
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Rayon de la Terre en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Calcule la distance et la durée entre deux points via OSRM.
 * Utilise un cache en mémoire et un fallback Haversine si OSRM est indisponible.
 *
 * @param {Object} origin - Point d'origine {latitude, longitude}
 * @param {Object} destination - Point de destination {latitude, longitude}
 * @returns {Promise<Object>} {distance_km, duration_minutes, route_geometry, source}
 * @throws {Error} Si les coordonnées sont invalides
 */
async function calculateRoute(origin, destination) {
  // 1. Validation des coordonnées
  if (!isValidCoordinate(origin.latitude, origin.longitude)) {
    throw new Error('Invalid origin coordinates');
  }
  if (!isValidCoordinate(destination.latitude, destination.longitude)) {
    throw new Error('Invalid destination coordinates');
  }

  // 2. Vérifier le cache
  const cacheKey = getCacheKey(
    origin.latitude, origin.longitude,
    destination.latitude, destination.longitude
  );

  const cached = routeCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return { ...cached.data, source: 'cache' };
  }

  // 3. Appeler OSRM
  try {
    const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
    const url = `${OSRM_BASE_URL}/route/v1/${OSRM_PROFILE}/${coordinates}?overview=simplified&geometries=geojson&steps=false`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'HilDelivre/4.0'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error(`OSRM routing failed: ${data.code || 'no routes found'}`);
    }

    const route = data.routes[0];

    // Distance en km avec facteur de correction
    const distance_km = Math.round(
      (route.distance / 1000) * DISTANCE_CORRECTION_FACTOR * 100
    ) / 100;

    // Durée en minutes avec facteur de correction
    const duration_minutes = Math.ceil(
      (route.duration / 60) * DURATION_CORRECTION_FACTOR
    );

    // Vérifier les limites
    if (distance_km > MAX_DISTANCE_KM) {
      const err = new Error(`Delivery distance exceeds maximum (${MAX_DISTANCE_KM} km)`);
      err.statusCode = 422;
      throw err;
    }

    const result = {
      distance_km,
      duration_minutes,
      route_geometry: route.geometry || null,
      raw_distance_m: route.distance,
      raw_duration_s: route.duration,
      source: 'osrm'
    };

    // 4. Mettre en cache
    routeCache.set(cacheKey, { data: result, timestamp: Date.now() });

    // Nettoyage périodique du cache (max 1000 entrées)
    if (routeCache.size > 1000) {
      const oldestKey = routeCache.keys().next().value;
      routeCache.delete(oldestKey);
    }

    return result;
  } catch (err) {
    // 5. Fallback Haversine si OSRM est indisponible
    if (err.statusCode) throw err;

    console.warn(`[OSRM] Fallback to Haversine: ${err.message}`);

    const straightDistance = haversineDistance(
      origin.latitude, origin.longitude,
      destination.latitude, destination.longitude
    );

    // Facteur 1.4 pour approximer la distance routière depuis la distance à vol d'oiseau
    const distance_km = Math.round(straightDistance * 1.4 * 100) / 100;

    // Estimation : 25 km/h en moyenne à Ouagadougou
    const duration_minutes = Math.ceil((distance_km / 25) * 60);

    if (distance_km > MAX_DISTANCE_KM) {
      const error = new Error(`Delivery distance exceeds maximum (${MAX_DISTANCE_KM} km)`);
      error.statusCode = 422;
      throw error;
    }

    return {
      distance_km,
      duration_minutes,
      route_geometry: null,
      raw_distance_m: straightDistance * 1000,
      raw_duration_s: duration_minutes * 60,
      source: 'haversine_fallback'
    };
  }
}

/**
 * Calcule la matrice de distances entre un point et plusieurs destinations.
 * Utile pour trouver le livreur le plus proche.
 *
 * @param {Object} origin - Point d'origine {latitude, longitude}
 * @param {Array<Object>} destinations - Liste de destinations [{latitude, longitude, id}]
 * @returns {Promise<Array<Object>>} Liste triée par distance croissante
 */
async function calculateDistanceMatrix(origin, destinations) {
  if (!isValidCoordinate(origin.latitude, origin.longitude)) {
    throw new Error('Invalid origin coordinates');
  }

  if (!destinations || destinations.length === 0) {
    return [];
  }

  // Limiter à 25 destinations max par requête
  const limitedDestinations = destinations.slice(0, 25);

  try {
    // Construire les coordonnées pour l'API OSRM table
    const coords = [
      `${origin.longitude},${origin.latitude}`,
      ...limitedDestinations.map(d => `${d.longitude},${d.latitude}`)
    ].join(';');

    const url = `${OSRM_BASE_URL}/table/v1/${OSRM_PROFILE}/${coords}?sources=0&annotations=distance,duration`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'HilDelivre/4.0' }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM Table API returned ${response.status}`);
    }

    const data = await response.json();

    if (data.code !== 'Ok') {
      throw new Error(`OSRM table failed: ${data.code}`);
    }

    // Mapper les résultats
    const results = limitedDestinations.map((dest, index) => ({
      id: dest.id,
      deliverer_id: dest.deliverer_id || dest.id,
      latitude: dest.latitude,
      longitude: dest.longitude,
      distance_km: Math.round(
        (data.distances[0][index + 1] / 1000) * DISTANCE_CORRECTION_FACTOR * 100
      ) / 100,
      duration_minutes: Math.ceil(
        (data.durations[0][index + 1] / 60) * DURATION_CORRECTION_FACTOR
      )
    }));

    // Trier par distance croissante
    return results.sort((a, b) => a.distance_km - b.distance_km);
  } catch (err) {
    // Fallback : calcul Haversine pour chaque destination
    console.warn(`[OSRM] Matrix fallback to Haversine: ${err.message}`);

    const results = limitedDestinations.map(dest => {
      const straightDistance = haversineDistance(
        origin.latitude, origin.longitude,
        dest.latitude, dest.longitude
      );
      const distance_km = Math.round(straightDistance * 1.4 * 100) / 100;

      return {
        id: dest.id,
        deliverer_id: dest.deliverer_id || dest.id,
        latitude: dest.latitude,
        longitude: dest.longitude,
        distance_km,
        duration_minutes: Math.ceil((distance_km / 25) * 60)
      };
    });

    return results.sort((a, b) => a.distance_km - b.distance_km);
  }
}

/**
 * Vide le cache des routes.
 */
function clearCache() {
  routeCache.clear();
}

module.exports = {
  calculateRoute,
  calculateDistanceMatrix,
  haversineDistance,
  clearCache,
  MAX_DISTANCE_KM,
  MIN_DISTANCE_KM
};
