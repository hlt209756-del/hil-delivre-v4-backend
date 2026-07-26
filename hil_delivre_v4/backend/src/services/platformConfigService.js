/**
 * @file platformConfigService.js
 * @description Service de gestion de la configuration plateforme.
 * Fournit un accès aux paramètres configurables (taux de commission, TVA, frais)
 * avec un cache en mémoire (TTL 5 min) pour éviter les requêtes répétées.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');

// ============================================================================
// CACHE EN MÉMOIRE
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let configCache = null;
let cacheTimestamp = 0;

/**
 * Vérifie si le cache est encore valide
 * @returns {boolean}
 */
function isCacheValid() {
  return configCache !== null && (Date.now() - cacheTimestamp) < CACHE_TTL_MS;
}

/**
 * Invalide le cache manuellement
 */
function invalidateCache() {
  configCache = null;
  cacheTimestamp = 0;
}

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Récupère toutes les configurations de la plateforme.
 * Utilise le cache si disponible et valide.
 * @returns {Promise<Object>} Map clé → valeur numérique
 */
async function getAllConfigs() {
  try {
    if (isCacheValid()) {
      return { ...configCache };
    }

    const { data, error } = await supabaseAdmin
      .from('platform_config')
      .select('config_key, config_value, description');

    if (error) {
      throw new Error(`Failed to fetch platform config: ${error.message}`);
    }

    // Construire le cache sous forme de map
    const configMap = {};
    for (const row of data) {
      configMap[row.config_key] = {
        value: parseFloat(row.config_value),
        description: row.description
      };
    }

    configCache = configMap;
    cacheTimestamp = Date.now();

    return { ...configCache };
  } catch (err) {
    // Si le cache existe mais est expiré, le retourner quand même en cas d'erreur DB
    if (configCache !== null) {
      return { ...configCache };
    }
    throw err;
  }
}

/**
 * Récupère une valeur de configuration spécifique.
 * @param {string} key - Clé de configuration
 * @returns {Promise<number>} Valeur numérique de la configuration
 * @throws {Error} Si la clé n'existe pas
 */
async function getConfig(key) {
  try {
    const configs = await getAllConfigs();

    if (!configs[key]) {
      throw new Error(`Configuration key not found: ${key}`);
    }

    return configs[key].value;
  } catch (err) {
    throw new Error(`getConfig(${key}) failed: ${err.message}`);
  }
}

/**
 * Récupère plusieurs valeurs de configuration en une seule fois.
 * @param {string[]} keys - Liste des clés à récupérer
 * @returns {Promise<Object>} Map clé → valeur numérique
 */
async function getConfigs(keys) {
  try {
    const configs = await getAllConfigs();
    const result = {};

    for (const key of keys) {
      if (configs[key]) {
        result[key] = configs[key].value;
      }
    }

    return result;
  } catch (err) {
    throw new Error(`getConfigs failed: ${err.message}`);
  }
}

/**
 * Met à jour une valeur de configuration (admin uniquement).
 * @param {string} key - Clé de configuration
 * @param {number} value - Nouvelle valeur
 * @param {string} adminId - UUID de l'administrateur effectuant la modification
 * @returns {Promise<Object>} Configuration mise à jour
 * @throws {Error} Si la clé n'existe pas ou si la mise à jour échoue
 */
async function updateConfig(key, value, adminId) {
  try {
    // Vérifier que la clé existe
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('platform_config')
      .select('id, config_value')
      .eq('config_key', key)
      .single();

    if (fetchError || !existing) {
      throw new Error(`Configuration key not found: ${key}`);
    }

    const oldValue = existing.config_value;

    // Mettre à jour
    const { data, error } = await supabaseAdmin
      .from('platform_config')
      .update({
        config_value: value,
        updated_by: adminId,
        updated_at: new Date().toISOString()
      })
      .eq('config_key', key)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update config ${key}: ${error.message}`);
    }

    // Invalider le cache
    invalidateCache();

    // Audit trail
    await logAuditEvent({
      userId: adminId,
      actionType: 'platform_config_update',
      entityType: 'platform_config',
      entityId: data.id,
      oldValue: { config_key: key, config_value: oldValue },
      newValue: { config_key: key, config_value: value }
    });

    return data;
  } catch (err) {
    throw new Error(`updateConfig(${key}) failed: ${err.message}`);
  }
}

/**
 * Récupère les taux nécessaires au calcul des montants de commande.
 * Méthode utilitaire pour le service de paiement.
 * @returns {Promise<Object>} Taux de commission, TVA, etc.
 */
async function getOrderCalculationRates() {
  try {
    const keys = [
      'merchant_commission_rate',
      'delivery_commission_rate',
      'platform_vat_rate',
      'delivery_base_fee',
      'delivery_rate_per_km_tier1',
      'delivery_rate_per_km_tier2',
      'delivery_tier1_max_km',
      'delivery_min_guaranteed',
      'cash_reconciliation_fee_rate',
      'service_fee_rate'
    ];

    return await getConfigs(keys);
  } catch (err) {
    // Retourner les valeurs par défaut en cas d'erreur
    return {
      merchant_commission_rate: 0.05,
      delivery_commission_rate: 0.01,
      platform_vat_rate: 0.18,
      delivery_base_fee: 250,
      delivery_rate_per_km_tier1: 120,
      delivery_rate_per_km_tier2: 90,
      delivery_tier1_max_km: 5,
      delivery_min_guaranteed: 500,
      cash_reconciliation_fee_rate: 0.05,
      service_fee_rate: 0.02
    };
  }
}

module.exports = {
  getAllConfigs,
  getConfig,
  getConfigs,
  updateConfig,
  getOrderCalculationRates,
  invalidateCache
};
