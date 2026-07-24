/**
 * @file deliveryFeeService.js
 * @description Service de calcul des frais de livraison.
 * Implémente la tarification dégressive par paliers de distance
 * et le surge pricing basé sur les créneaux horaires et la demande.
 *
 * Tarification (Plan v4 section 9.5) :
 * - Base fixe : 250 FCFA
 * - 0-5 km : 120 FCFA/km
 * - >5 km : 90 FCFA/km (dégressif)
 * - Minimum garanti livreur : 500 FCFA
 * - Surge pricing : multiplicateur 1.0 à 3.0
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { getOrderCalculationRates } = require('./platformConfigService');

// ============================================================================
// FONCTIONS UTILITAIRES INTERNES
// ============================================================================

/**
 * Récupère le multiplicateur de surge pricing actif.
 * Basé sur le jour de la semaine, l'heure actuelle et la demande.
 * @returns {Promise<Object>} {multiplier, surge_name, is_surge_active}
 */
async function getCurrentSurgeMultiplier() {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 = dimanche
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM

    // Récupérer les configs de surge actives
    const { data: surgeConfigs, error } = await supabaseAdmin
      .from('surge_pricing_config')
      .select('*')
      .eq('is_active', true);

    if (error || !surgeConfigs || surgeConfigs.length === 0) {
      return { multiplier: 1.0, surge_name: null, is_surge_active: false };
    }

    // Trouver le surge applicable
    let highestMultiplier = 1.0;
    let activeSurgeName = null;

    for (const config of surgeConfigs) {
      // Vérifier le jour de la semaine
      if (!config.day_of_week.includes(dayOfWeek)) {
        continue;
      }

      // Vérifier l'heure
      if (currentTime >= config.start_time && currentTime <= config.end_time) {
        if (config.multiplier > highestMultiplier) {
          highestMultiplier = config.multiplier;
          activeSurgeName = config.name;
        }
      }
    }

    // Vérifier la demande (nombre de commandes en attente vs livreurs disponibles)
    const demandMultiplier = await calculateDemandSurge();

    // Prendre le plus élevé entre le surge horaire et le surge de demande
    const finalMultiplier = Math.max(highestMultiplier, demandMultiplier);

    return {
      multiplier: Math.min(finalMultiplier, 3.0), // Cap à 3.0
      surge_name: activeSurgeName || (demandMultiplier > 1.0 ? 'Forte demande' : null),
      is_surge_active: finalMultiplier > 1.0
    };
  } catch (err) {
    console.error(`[SURGE] Error calculating surge: ${err.message}`);
    return { multiplier: 1.0, surge_name: null, is_surge_active: false };
  }
}

/**
 * Calcule le surge basé sur le ratio demande/offre.
 * @returns {Promise<number>} Multiplicateur de demande (1.0 à 2.0)
 */
async function calculateDemandSurge() {
  try {
    // Compter les commandes en attente de livreur
    const { count: pendingOrders } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['accepted', 'ready'])
      .is('delivery_id', null);

    // Compter les livreurs disponibles
    const { count: availableDeliverers } = await supabaseAdmin
      .from('deliverer_locations')
      .select('id', { count: 'exact', head: true })
      .eq('availability', 'online');

    if (!availableDeliverers || availableDeliverers === 0) {
      // Pas de livreurs disponibles : surge maximum
      return pendingOrders > 0 ? 2.0 : 1.0;
    }

    const ratio = (pendingOrders || 0) / availableDeliverers;

    // Ratio > 3 commandes par livreur : surge progressif
    if (ratio > 5) return 2.0;
    if (ratio > 3) return 1.5;
    if (ratio > 2) return 1.2;

    return 1.0;
  } catch {
    return 1.0;
  }
}

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Calcule les frais de livraison complets pour une commande.
 *
 * Formule :
 * delivery_fee = max(
 *   (base_fee + distance_fee) × surge_multiplier,
 *   min_guaranteed
 * )
 *
 * Où distance_fee :
 * - 0-5 km : km × 120 FCFA
 * - >5 km : (5 × 120) + ((km - 5) × 90) FCFA
 *
 * @param {number} distanceKm - Distance en km (calculée par OSRM)
 * @param {Object} [options] - Options supplémentaires
 * @param {boolean} [options.includeSurge=true] - Inclure le surge pricing
 * @param {number} [options.forcedMultiplier] - Forcer un multiplicateur (tests)
 * @returns {Promise<Object>} Détail complet des frais de livraison
 */
async function calculateDeliveryFee(distanceKm, options = {}) {
  const { includeSurge = true, forcedMultiplier } = options;

  try {
    // 1. Récupérer les taux de la plateforme
    const rates = await getOrderCalculationRates();

    const baseFee = rates.delivery_base_fee || 250;
    const rateTier1 = rates.delivery_rate_per_km_tier1 || 120;
    const rateTier2 = rates.delivery_rate_per_km_tier2 || 90;
    const tier1MaxKm = rates.delivery_tier1_max_km || 5;
    const minGuaranteed = rates.delivery_min_guaranteed || 500;

    // 2. Calculer les frais de distance (tarification dégressive)
    let distanceFee = 0;

    if (distanceKm <= 0) {
      distanceFee = 0;
    } else if (distanceKm <= tier1MaxKm) {
      distanceFee = distanceKm * rateTier1;
    } else {
      // Palier 1 : premiers 5 km
      distanceFee = tier1MaxKm * rateTier1;
      // Palier 2 : au-delà de 5 km
      distanceFee += (distanceKm - tier1MaxKm) * rateTier2;
    }

    // 3. Frais bruts (avant surge)
    const rawFee = baseFee + distanceFee;

    // 4. Surge pricing
    let surgeInfo = { multiplier: 1.0, surge_name: null, is_surge_active: false };

    if (includeSurge) {
      if (forcedMultiplier) {
        surgeInfo = {
          multiplier: forcedMultiplier,
          surge_name: 'Forced (test)',
          is_surge_active: forcedMultiplier > 1.0
        };
      } else {
        surgeInfo = await getCurrentSurgeMultiplier();
      }
    }

    // 5. Appliquer le surge
    const surgedFee = Math.ceil(rawFee * surgeInfo.multiplier);

    // 6. Appliquer le minimum garanti
    const finalFee = Math.max(surgedFee, minGuaranteed);

    // 7. Calculer le surge_amount (supplément dû au surge)
    const surgeAmount = surgeInfo.is_surge_active
      ? Math.ceil(rawFee * (surgeInfo.multiplier - 1))
      : 0;

    // 8. Part plateforme du surge (30% selon plan v4)
    const surgePlatformShare = Math.ceil(surgeAmount * (rates.surge_platform_share || 0.30));
    const surgeDelivererShare = surgeAmount - surgePlatformShare;

    return {
      delivery_fee: finalFee,
      base_fee: baseFee,
      distance_fee: Math.ceil(distanceFee),
      distance_km: distanceKm,
      surge_multiplier: surgeInfo.multiplier,
      surge_name: surgeInfo.surge_name,
      is_surge_active: surgeInfo.is_surge_active,
      surge_amount: surgeAmount,
      surge_platform_share: surgePlatformShare,
      surge_deliverer_share: surgeDelivererShare,
      min_guaranteed: minGuaranteed,
      min_guaranteed_applied: finalFee === minGuaranteed && surgedFee < minGuaranteed,
      breakdown: {
        tier1_km: Math.min(distanceKm, tier1MaxKm),
        tier1_rate: rateTier1,
        tier1_amount: Math.ceil(Math.min(distanceKm, tier1MaxKm) * rateTier1),
        tier2_km: Math.max(0, distanceKm - tier1MaxKm),
        tier2_rate: rateTier2,
        tier2_amount: Math.ceil(Math.max(0, distanceKm - tier1MaxKm) * rateTier2)
      }
    };
  } catch (err) {
    throw new Error(`calculateDeliveryFee failed: ${err.message}`);
  }
}

/**
 * Estime les frais de livraison pour l'affichage côté client (avant commande).
 * Version simplifiée sans surge pour l'estimation.
 *
 * @param {number} distanceKm - Distance estimée en km
 * @returns {Promise<Object>} Estimation {min_fee, max_fee, estimated_fee}
 */
async function estimateDeliveryFee(distanceKm) {
  try {
    // Calcul sans surge
    const baseFeeResult = await calculateDeliveryFee(distanceKm, { includeSurge: false });

    // Calcul avec surge actuel
    const surgedFeeResult = await calculateDeliveryFee(distanceKm, { includeSurge: true });

    return {
      estimated_fee: baseFeeResult.delivery_fee,
      min_fee: baseFeeResult.delivery_fee,
      max_fee: surgedFeeResult.delivery_fee,
      is_surge_active: surgedFeeResult.is_surge_active,
      surge_name: surgedFeeResult.surge_name,
      distance_km: distanceKm
    };
  } catch (err) {
    throw new Error(`estimateDeliveryFee failed: ${err.message}`);
  }
}

module.exports = {
  calculateDeliveryFee,
  estimateDeliveryFee,
  getCurrentSurgeMultiplier,
  calculateDemandSurge
};
