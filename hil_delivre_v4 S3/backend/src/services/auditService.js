'use strict';

/**
 * @fileoverview Service d'audit pour Hil_Delivre v4.
 * Enregistre les actions critiques dans la table audit_logs
 * pour la conformité CIL et la résolution de litiges.
 *
 * @module services/auditService
 */

const { supabaseAdmin } = require('./supabaseService');

/**
 * Enregistre une action dans le journal d'audit.
 * Utilise supabaseAdmin (service_role) pour bypass RLS.
 *
 * @param {object} params - Paramètres de l'entrée d'audit
 * @param {string} [params.userId] - ID de l'utilisateur ayant effectué l'action
 * @param {string} params.actionType - Type d'action (ex: 'auth.register', 'kyc.submit')
 * @param {string} [params.entityType] - Type d'entité affectée (ex: 'user', 'profile')
 * @param {string} [params.entityId] - ID de l'entité affectée
 * @param {object} [params.oldValue] - Valeur avant modification
 * @param {object} [params.newValue] - Valeur après modification
 * @param {string} [params.ipAddress] - Adresse IP de l'utilisateur
 * @param {string} [params.userAgent] - User-Agent du client
 * @returns {Promise<void>}
 */
async function logAudit({
  userId = null,
  actionType,
  entityType = null,
  entityId = null,
  oldValue = null,
  newValue = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    if (!actionType) {
      console.warn('[auditService] actionType requis pour l\'audit log');
      return;
    }

    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        user_id: userId,
        action_type: actionType,
        entity_type: entityType,
        entity_id: entityId,
        old_value: oldValue,
        new_value: newValue,
        ip_address: ipAddress,
        user_agent: userAgent,
      });

    if (error) {
      // Ne pas bloquer l'opération principale si l'audit échoue
      console.error('[auditService] Erreur insertion audit_log:', error.message);
    }
  } catch (error) {
    // L'audit ne doit JAMAIS bloquer l'opération principale
    console.error('[auditService] Erreur inattendue:', error.message);
  }
}

/**
 * Enregistre un événement d'authentification.
 *
 * @param {string} action - Type d'action auth (register, login, logout, password_reset)
 * @param {string} userId - ID de l'utilisateur
 * @param {import('express').Request} req - Requête Express (pour IP et User-Agent)
 * @param {object} [metadata] - Données supplémentaires
 */
async function logAuthEvent(action, userId, req, metadata = {}) {
  await logAudit({
    userId,
    actionType: `auth.${action}`,
    entityType: 'user',
    entityId: userId,
    newValue: metadata,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
  });
}

/**
 * Enregistre une modification de profil.
 *
 * @param {string} userId - ID de l'utilisateur
 * @param {object} oldProfile - Profil avant modification
 * @param {object} newProfile - Profil après modification
 * @param {import('express').Request} req - Requête Express
 */
async function logProfileUpdate(userId, oldProfile, newProfile, req) {
  await logAudit({
    userId,
    actionType: 'profile.update',
    entityType: 'profile',
    entityId: userId,
    oldValue: oldProfile,
    newValue: newProfile,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
  });
}

/**
 * Enregistre un événement KYC.
 *
 * @param {string} action - Type d'action KYC (submit, approve, reject)
 * @param {string} targetUserId - ID de l'utilisateur concerné
 * @param {string} [adminId] - ID de l'admin (pour approve/reject)
 * @param {import('express').Request} req - Requête Express
 * @param {object} [metadata] - Données supplémentaires
 */
async function logKYCEvent(action, targetUserId, adminId, req, metadata = {}) {
  await logAudit({
    userId: adminId || targetUserId,
    actionType: `kyc.${action}`,
    entityType: 'kyc_request',
    entityId: targetUserId,
    newValue: metadata,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers?.['user-agent'],
  });
}

module.exports = {
  logAudit,
  logAuthEvent,
  logProfileUpdate,
  logKYCEvent,
};
