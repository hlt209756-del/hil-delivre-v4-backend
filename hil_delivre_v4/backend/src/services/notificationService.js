/**
 * @file notificationService.js
 * @description Service d'orchestration des notifications multi-canal.
 * Coordonne l'envoi via Socket.IO (temps réel), FCM (push) et in-app (BDD).
 * Respecte les préférences utilisateur et gère la persistance.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { emitToUser, emitToOrder } = require('../config/socketio');
const fcmService = require('./fcmService');
const { logAuditEvent } = require('./auditService');

// ============================================================================
// TEMPLATES DE NOTIFICATIONS
// ============================================================================

const NOTIFICATION_TEMPLATES = {
  order_created: {
    title: (data) => 'Nouvelle commande',
    body: (data) => `Commande #${data.order_ref} reçue. Montant : ${data.amount} FCFA.`,
    targets: ['merchant']
  },
  order_accepted: {
    title: () => 'Commande acceptée',
    body: (data) => `Votre commande #${data.order_ref} a été acceptée par le restaurant.`,
    targets: ['client']
  },
  order_ready: {
    title: () => 'Commande prête',
    body: (data) => `La commande #${data.order_ref} est prête à être récupérée.`,
    targets: ['client', 'deliverer']
  },
  order_picked_up: {
    title: () => 'Commande récupérée',
    body: (data) => `Le livreur a récupéré votre commande #${data.order_ref}.`,
    targets: ['client']
  },
  order_in_delivery: {
    title: () => 'En cours de livraison',
    body: (data) => `Votre commande #${data.order_ref} est en route. ETA : ${data.eta || '?'} min.`,
    targets: ['client']
  },
  order_delivered: {
    title: () => 'Commande livrée',
    body: (data) => `Votre commande #${data.order_ref} a été livrée. Bon appétit !`,
    targets: ['client', 'merchant']
  },
  order_cancelled: {
    title: () => 'Commande annulée',
    body: (data) => `La commande #${data.order_ref} a été annulée. ${data.reason || ''}`,
    targets: ['client', 'merchant', 'deliverer']
  },
  delivery_proposed: {
    title: () => 'Nouvelle course disponible',
    body: (data) => `Course à ${data.distance_km} km. Gain estimé : ${data.fee} FCFA. Expire dans 60s.`,
    targets: ['deliverer']
  },
  delivery_accepted: {
    title: () => 'Livreur assigné',
    body: (data) => `Un livreur a accepté votre commande. Arrivée estimée : ${data.eta} min.`,
    targets: ['client', 'merchant']
  },
  delivery_rejected: {
    title: () => 'Recherche de livreur',
    body: () => 'Nous cherchons un autre livreur pour votre commande.',
    targets: ['client']
  },
  payment_received: {
    title: () => 'Paiement reçu',
    body: (data) => `Paiement de ${data.amount} FCFA confirmé pour la commande #${data.order_ref}.`,
    targets: ['client', 'merchant']
  },
  payment_failed: {
    title: () => 'Échec de paiement',
    body: (data) => `Le paiement pour la commande #${data.order_ref} a échoué. Veuillez réessayer.`,
    targets: ['client']
  },
  kyc_approved: {
    title: () => 'Compte vérifié',
    body: () => 'Votre vérification d\'identité a été approuvée. Vous pouvez maintenant utiliser tous les services.',
    targets: ['user']
  },
  kyc_rejected: {
    title: () => 'Vérification refusée',
    body: (data) => `Votre vérification a été refusée. Raison : ${data.reason || 'Non conforme'}. Veuillez soumettre à nouveau.`,
    targets: ['user']
  },
  system_alert: {
    title: (data) => data.title || 'Information',
    body: (data) => data.message || '',
    targets: ['user']
  },
  promotion: {
    title: (data) => data.title || 'Promotion',
    body: (data) => data.message || '',
    targets: ['user']
  }
};

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Envoie une notification multi-canal à un ou plusieurs utilisateurs.
 * Orchestre : Socket.IO (temps réel) + FCM (push) + In-app (BDD).
 *
 * @param {Object} params
 * @param {string} params.type - Type de notification (voir NOTIFICATION_TEMPLATES)
 * @param {Object} params.recipients - {client_id, merchant_id, deliverer_id, user_id}
 * @param {Object} params.data - Données pour le template
 * @param {string} [params.orderId] - UUID de la commande (pour broadcast room)
 * @returns {Promise<Object>} Résultat de l'envoi
 */
async function sendNotification({ type, recipients, data, orderId }) {
  try {
    const template = NOTIFICATION_TEMPLATES[type];
    if (!template) {
      throw new Error(`Unknown notification type: ${type}`);
    }

    const title = template.title(data);
    const body = template.body(data);
    const results = { socket: [], push: [], in_app: [] };

    // Déterminer les destinataires
    const targetUserIds = resolveRecipients(recipients, template.targets);

    // Pour chaque destinataire
    for (const userId of targetUserIds) {
      if (!userId) continue;

      // Vérifier les préférences
      const prefs = await getUserPreferences(userId, type);

      // 1. Socket.IO (toujours, si connecté)
      try {
        emitToUser(userId, 'notification', {
          type,
          title,
          body,
          data,
          orderId
        });
        results.socket.push({ userId, sent: true });
      } catch {
        results.socket.push({ userId, sent: false });
      }

      // 2. Push FCM (si activé)
      if (prefs.push_enabled) {
        try {
          const pushResult = await fcmService.sendToUser(userId, { title, body }, {
            type,
            order_id: orderId || '',
            ...data
          });
          results.push.push({ userId, ...pushResult });
        } catch {
          results.push.push({ userId, success: false });
        }
      }

      // 3. In-app (persistance en BDD, toujours)
      if (prefs.in_app_enabled) {
        try {
          await persistNotification(userId, type, title, body, data, orderId);
          results.in_app.push({ userId, stored: true });
        } catch {
          results.in_app.push({ userId, stored: false });
        }
      }
    }

    // 4. Broadcast Socket.IO à la room de la commande (si applicable)
    if (orderId) {
      emitToOrder(orderId, 'order:update', {
        type,
        title,
        body,
        data
      });
    }

    return {
      success: true,
      type,
      recipients_count: targetUserIds.filter(Boolean).length,
      results
    };
  } catch (err) {
    console.error(`[NOTIFICATION] sendNotification error: ${err.message}`);
    throw err;
  }
}

/**
 * Récupère les notifications d'un utilisateur (paginées).
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {Object} [options] - {page, limit, unread_only}
 * @returns {Promise<Object>} {notifications, total, unread_count}
 */
async function getUserNotifications(userId, options = {}) {
  try {
    const { page = 1, limit = 20, unread_only = false } = options;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unread_only) {
      query = query.eq('is_read', false);
    }

    const { data: notifications, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch notifications: ${error.message}`);
    }

    // Compter les non-lues
    const { count: unreadCount } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    return {
      notifications: notifications || [],
      total: count || 0,
      unread_count: unreadCount || 0,
      page,
      limit
    };
  } catch (err) {
    throw new Error(`getUserNotifications failed: ${err.message}`);
  }
}

/**
 * Marque des notifications comme lues.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {Array<string>} notificationIds - UUIDs des notifications
 * @returns {Promise<Object>}
 */
async function markAsRead(userId, notificationIds) {
  try {
    if (!notificationIds || notificationIds.length === 0) {
      // Marquer toutes comme lues
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw new Error(error.message);
      return { success: true, message: 'All notifications marked as read' };
    }

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', notificationIds)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
    return { success: true, marked: notificationIds.length };
  } catch (err) {
    throw new Error(`markAsRead failed: ${err.message}`);
  }
}

/**
 * Met à jour les préférences de notification d'un utilisateur.
 *
 * @param {string} userId
 * @param {string} notificationType
 * @param {Object} preferences - {push_enabled, sms_enabled, in_app_enabled}
 * @returns {Promise<Object>}
 */
async function updatePreferences(userId, notificationType, preferences) {
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        notification_type: notificationType,
        ...preferences,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,notification_type'
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    throw new Error(`updatePreferences failed: ${err.message}`);
  }
}

/**
 * Récupère les préférences de notification d'un utilisateur.
 *
 * @param {string} userId
 * @returns {Promise<Array>}
 */
async function getPreferences(userId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId);

    if (error) throw new Error(error.message);
    return data || [];
  } catch (err) {
    throw new Error(`getPreferences failed: ${err.message}`);
  }
}

// ============================================================================
// FONCTIONS INTERNES
// ============================================================================

/**
 * Résout les destinataires en fonction du template et des recipients fournis.
 */
function resolveRecipients(recipients, targets) {
  const userIds = new Set();

  for (const target of targets) {
    switch (target) {
      case 'client':
        if (recipients.client_id) userIds.add(recipients.client_id);
        break;
      case 'merchant':
        if (recipients.merchant_id) userIds.add(recipients.merchant_id);
        break;
      case 'deliverer':
        if (recipients.deliverer_id) userIds.add(recipients.deliverer_id);
        break;
      case 'user':
        if (recipients.user_id) userIds.add(recipients.user_id);
        break;
    }
  }

  return Array.from(userIds);
}

/**
 * Récupère les préférences d'un utilisateur pour un type de notification.
 * Retourne les valeurs par défaut si aucune préférence n'est définie.
 */
async function getUserPreferences(userId, notificationType) {
  try {
    const { data } = await supabaseAdmin
      .from('notification_preferences')
      .select('push_enabled, sms_enabled, in_app_enabled')
      .eq('user_id', userId)
      .eq('notification_type', notificationType)
      .single();

    return data || { push_enabled: true, sms_enabled: true, in_app_enabled: true };
  } catch {
    return { push_enabled: true, sms_enabled: true, in_app_enabled: true };
  }
}

/**
 * Persiste une notification en BDD.
 */
async function persistNotification(userId, type, title, body, data, orderId) {
  await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      channel: 'in_app',
      title,
      body,
      data: data || {},
      is_sent: true,
      sent_at: new Date().toISOString(),
      related_entity_type: orderId ? 'order' : null,
      related_entity_id: orderId || null
    });
}

module.exports = {
  sendNotification,
  getUserNotifications,
  markAsRead,
  updatePreferences,
  getPreferences,
  NOTIFICATION_TEMPLATES
};
