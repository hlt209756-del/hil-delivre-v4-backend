/**
 * @file fcmService.js
 * @description Service de notifications push via Firebase Cloud Messaging (FCM).
 * Gère l'envoi de notifications push aux appareils iOS et Android.
 *
 * Documentation FCM : https://firebase.google.com/docs/cloud-messaging
 * API HTTP v1 : https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');

// ============================================================================
// CONFIGURATION
// ============================================================================

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID;
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY;
const FCM_API_URL = `https://fcm.googleapis.com/fcm/send`;

// Limites FCM
const MAX_TOKENS_PER_REQUEST = 1000;
const REQUEST_TIMEOUT_MS = 10000;

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Envoie une notification push à un utilisateur spécifique.
 * Envoie à tous les appareils actifs de l'utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {Object} notification - {title, body, image}
 * @param {Object} [data] - Données supplémentaires (key-value strings)
 * @returns {Promise<Object>} Résultat de l'envoi
 */
async function sendToUser(userId, notification, data = {}) {
  try {
    // Vérifier si l'utilisateur a activé les push
    const { data: profile } = await supabaseAdmin
      .from('profiles_data')
      .select('push_notifications_enabled')
      .eq('user_id', userId)
      .single();

    if (profile && profile.push_notifications_enabled === false) {
      return { success: false, reason: 'push_disabled_by_user', sent: 0 };
    }

    // Récupérer les tokens actifs de l'utilisateur
    const { data: devices, error } = await supabaseAdmin
      .from('device_tokens')
      .select('token, platform')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (error || !devices || devices.length === 0) {
      return { success: false, reason: 'no_active_devices', sent: 0 };
    }

    const tokens = devices.map(d => d.token);

    // Envoyer via FCM
    const result = await sendMulticast(tokens, notification, data);

    // Désactiver les tokens invalides
    if (result.invalidTokens.length > 0) {
      await deactivateTokens(result.invalidTokens);
    }

    return {
      success: result.successCount > 0,
      sent: result.successCount,
      failed: result.failureCount,
      invalid_tokens_removed: result.invalidTokens.length
    };
  } catch (err) {
    console.error(`[FCM] sendToUser error: ${err.message}`);
    return { success: false, reason: 'internal_error', error: err.message };
  }
}

/**
 * Envoie une notification push à plusieurs utilisateurs.
 *
 * @param {Array<string>} userIds - Liste d'UUIDs
 * @param {Object} notification - {title, body, image}
 * @param {Object} [data] - Données supplémentaires
 * @returns {Promise<Object>} Résultat agrégé
 */
async function sendToUsers(userIds, notification, data = {}) {
  try {
    if (!userIds || userIds.length === 0) {
      return { success: false, reason: 'no_users', sent: 0 };
    }

    // Récupérer tous les tokens actifs des utilisateurs
    const { data: devices, error } = await supabaseAdmin
      .from('device_tokens')
      .select('token, user_id')
      .in('user_id', userIds)
      .eq('is_active', true);

    if (error || !devices || devices.length === 0) {
      return { success: false, reason: 'no_active_devices', sent: 0 };
    }

    const tokens = devices.map(d => d.token);
    const result = await sendMulticast(tokens, notification, data);

    if (result.invalidTokens.length > 0) {
      await deactivateTokens(result.invalidTokens);
    }

    return {
      success: result.successCount > 0,
      sent: result.successCount,
      failed: result.failureCount,
      total_devices: tokens.length
    };
  } catch (err) {
    console.error(`[FCM] sendToUsers error: ${err.message}`);
    return { success: false, reason: 'internal_error', error: err.message };
  }
}

/**
 * Envoie une notification à un topic (ex: tous les livreurs d'une zone).
 *
 * @param {string} topic - Nom du topic FCM
 * @param {Object} notification - {title, body}
 * @param {Object} [data] - Données supplémentaires
 * @returns {Promise<Object>}
 */
async function sendToTopic(topic, notification, data = {}) {
  try {
    if (!FCM_SERVER_KEY) {
      console.warn('[FCM] Server key not configured, skipping push');
      return { success: false, reason: 'fcm_not_configured' };
    }

    const payload = {
      to: `/topics/${topic}`,
      notification: {
        title: notification.title,
        body: notification.body,
        ...(notification.image && { image: notification.image })
      },
      data: stringifyData(data),
      priority: 'high'
    };

    const response = await fetchFCM(payload);
    return { success: true, message_id: response.message_id };
  } catch (err) {
    console.error(`[FCM] sendToTopic error: ${err.message}`);
    return { success: false, reason: 'send_failed', error: err.message };
  }
}

/**
 * Enregistre un token FCM pour un utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {string} token - Token FCM
 * @param {string} platform - 'ios', 'android', 'web'
 * @param {string} [deviceName] - Nom de l'appareil
 * @returns {Promise<Object>}
 */
async function registerToken(userId, token, platform, deviceName = null) {
  try {
    if (!token || !platform) {
      throw new Error('Token and platform are required');
    }

    const validPlatforms = ['ios', 'android', 'web'];
    if (!validPlatforms.includes(platform)) {
      throw new Error(`Invalid platform. Must be one of: ${validPlatforms.join(', ')}`);
    }

    // Upsert le token (un token ne peut appartenir qu'à un seul utilisateur)
    const { data, error } = await supabaseAdmin
      .from('device_tokens')
      .upsert({
        user_id: userId,
        token,
        platform,
        device_name: deviceName,
        is_active: true,
        last_used_at: new Date().toISOString()
      }, {
        onConflict: 'token'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to register token: ${error.message}`);
    }

    return { success: true, device: data };
  } catch (err) {
    throw err;
  }
}

/**
 * Supprime un token FCM (logout ou désinstallation).
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {string} token - Token FCM à supprimer
 * @returns {Promise<Object>}
 */
async function unregisterToken(userId, token) {
  try {
    const { error } = await supabaseAdmin
      .from('device_tokens')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('token', token);

    if (error) {
      throw new Error(`Failed to unregister token: ${error.message}`);
    }

    return { success: true };
  } catch (err) {
    throw err;
  }
}

// ============================================================================
// FONCTIONS INTERNES
// ============================================================================

/**
 * Envoie un multicast FCM à plusieurs tokens.
 */
async function sendMulticast(tokens, notification, data) {
  if (!FCM_SERVER_KEY) {
    console.warn('[FCM] Server key not configured, skipping push');
    return { successCount: 0, failureCount: tokens.length, invalidTokens: [] };
  }

  let successCount = 0;
  let failureCount = 0;
  const invalidTokens = [];

  // Découper en lots de MAX_TOKENS_PER_REQUEST
  for (let i = 0; i < tokens.length; i += MAX_TOKENS_PER_REQUEST) {
    const batch = tokens.slice(i, i + MAX_TOKENS_PER_REQUEST);

    const payload = {
      registration_ids: batch,
      notification: {
        title: notification.title,
        body: notification.body,
        sound: 'default',
        badge: 1,
        ...(notification.image && { image: notification.image })
      },
      data: stringifyData(data),
      priority: 'high',
      content_available: true
    };

    try {
      const response = await fetchFCM(payload);

      if (response.results) {
        response.results.forEach((result, index) => {
          if (result.message_id) {
            successCount++;
          } else {
            failureCount++;
            if (result.error === 'NotRegistered' || result.error === 'InvalidRegistration') {
              invalidTokens.push(batch[index]);
            }
          }
        });
      } else {
        successCount += response.success || 0;
        failureCount += response.failure || 0;
      }
    } catch (err) {
      failureCount += batch.length;
      console.error(`[FCM] Batch send error: ${err.message}`);
    }
  }

  return { successCount, failureCount, invalidTokens };
}

/**
 * Appelle l'API FCM.
 */
async function fetchFCM(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(FCM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `key=${FCM_SERVER_KEY}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`FCM API error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Désactive les tokens invalides en BDD.
 */
async function deactivateTokens(tokens) {
  try {
    await supabaseAdmin
      .from('device_tokens')
      .update({ is_active: false })
      .in('token', tokens);
  } catch (err) {
    console.error(`[FCM] Failed to deactivate tokens: ${err.message}`);
  }
}

/**
 * Convertit toutes les valeurs de data en strings (requis par FCM).
 */
function stringifyData(data) {
  const result = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}

module.exports = {
  sendToUser,
  sendToUsers,
  sendToTopic,
  registerToken,
  unregisterToken
};
