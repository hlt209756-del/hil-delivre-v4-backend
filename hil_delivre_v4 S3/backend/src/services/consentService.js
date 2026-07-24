'use strict';

/**
 * @fileoverview Service de gestion des consentements pour la conformité CIL.
 * Enregistre et vérifie les consentements utilisateurs (politique de confidentialité,
 * conditions d'utilisation, traitement des données).
 *
 * @module services/consentService
 */

const { supabaseAdmin } = require('./supabaseService');

/**
 * Version actuelle des documents de consentement.
 * À incrémenter à chaque modification substantielle des documents.
 */
const CONSENT_VERSIONS = {
  privacy_policy: '1.0',
  terms_of_service: '1.0',
  data_processing: '1.0',
  marketing: '1.0',
};

/**
 * Enregistre les consentements d'un utilisateur lors de l'inscription.
 *
 * @param {string} userId - ID de l'utilisateur
 * @param {object} consents - Consentements donnés
 * @param {boolean} consents.cil_consent - Consentement au traitement des données (CIL)
 * @param {boolean} consents.terms_accepted - Acceptation des CGU
 * @param {import('express').Request} req - Requête Express (pour IP et User-Agent)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function recordRegistrationConsents(userId, consents, req) {
  try {
    const ipAddress = req.ip || req.connection?.remoteAddress;
    const userAgent = req.headers?.['user-agent'];

    const consentRecords = [];

    // Consentement CIL (traitement des données) — OBLIGATOIRE
    if (consents.cil_consent) {
      consentRecords.push({
        user_id: userId,
        consent_type: 'data_processing',
        consent_given: true,
        consent_version: CONSENT_VERSIONS.data_processing,
        ip_address: ipAddress,
        user_agent: userAgent,
      });

      // La politique de confidentialité est incluse dans le consentement CIL
      consentRecords.push({
        user_id: userId,
        consent_type: 'privacy_policy',
        consent_given: true,
        consent_version: CONSENT_VERSIONS.privacy_policy,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
    }

    // Conditions d'utilisation — OBLIGATOIRE
    if (consents.terms_accepted) {
      consentRecords.push({
        user_id: userId,
        consent_type: 'terms_of_service',
        consent_given: true,
        consent_version: CONSENT_VERSIONS.terms_of_service,
        ip_address: ipAddress,
        user_agent: userAgent,
      });
    }

    if (consentRecords.length === 0) {
      return { success: false, error: 'Aucun consentement à enregistrer' };
    }

    const { error } = await supabaseAdmin
      .from('user_consents')
      .insert(consentRecords);

    if (error) {
      console.error('[consentService] Erreur enregistrement consentements:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[consentService] Erreur inattendue:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Vérifie si un utilisateur a donné tous les consentements obligatoires
 * dans leur version actuelle.
 *
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<{valid: boolean, missing: string[]}>}
 */
async function verifyConsents(userId) {
  try {
    const requiredTypes = ['data_processing', 'privacy_policy', 'terms_of_service'];

    const { data: consents, error } = await supabaseAdmin
      .from('user_consents')
      .select('consent_type, consent_version, consent_given, revoked_at')
      .eq('user_id', userId)
      .in('consent_type', requiredTypes)
      .is('revoked_at', null);

    if (error) {
      console.error('[consentService] Erreur vérification:', error.message);
      return { valid: false, missing: requiredTypes };
    }

    const missing = requiredTypes.filter((type) => {
      const consent = consents?.find(
        (c) => c.consent_type === type
          && c.consent_given === true
          && c.consent_version === CONSENT_VERSIONS[type]
      );
      return !consent;
    });

    return { valid: missing.length === 0, missing };
  } catch (error) {
    console.error('[consentService] Erreur inattendue:', error.message);
    return { valid: false, missing: ['data_processing', 'privacy_policy', 'terms_of_service'] };
  }
}

/**
 * Révoquer un consentement (droit d'opposition CIL).
 *
 * @param {string} userId - ID de l'utilisateur
 * @param {string} consentType - Type de consentement à révoquer
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function revokeConsent(userId, consentType) {
  try {
    const { error } = await supabaseAdmin
      .from('user_consents')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('consent_type', consentType)
      .is('revoked_at', null);

    if (error) {
      console.error('[consentService] Erreur révocation:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[consentService] Erreur inattendue:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  recordRegistrationConsents,
  verifyConsents,
  revokeConsent,
  CONSENT_VERSIONS,
};
