/**
 * @file notificationController.js
 * @description Contrôleur des endpoints de notifications et OTP (Sprint 6).
 */

'use strict';

const notificationService = require('../services/notificationService');
const otpService = require('../services/otpService');
const fcmService = require('../services/fcmService');
const { success, error: errorResponse } = require('../utils/responseHelper');

// ============================================================================
// CONTRÔLEURS — NOTIFICATIONS
// ============================================================================

/**
 * GET /api/notifications
 * Récupère les notifications de l'utilisateur connecté (paginées).
 */
async function getNotifications(req, res) {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, unread_only = false } = req.query;

    const result = await notificationService.getUserNotifications(userId, {
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 50),
      unread_only: unread_only === 'true'
    });

    return res.status(200).json(success(result, 'Notifications retrieved'));
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to retrieve notifications')
    );
  }
}

/**
 * PUT /api/notifications/read
 * Marque des notifications comme lues.
 */
async function markNotificationsRead(req, res) {
  try {
    const userId = req.user.id;
    const { notification_ids } = req.body;

    const result = await notificationService.markAsRead(userId, notification_ids || []);

    return res.status(200).json(success(result, 'Notifications marked as read'));
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to mark notifications as read')
    );
  }
}

/**
 * GET /api/notifications/preferences
 * Récupère les préférences de notification de l'utilisateur.
 */
async function getPreferences(req, res) {
  try {
    const userId = req.user.id;
    const preferences = await notificationService.getPreferences(userId);

    return res.status(200).json(success(preferences, 'Preferences retrieved'));
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to retrieve preferences')
    );
  }
}

/**
 * PUT /api/notifications/preferences
 * Met à jour les préférences de notification.
 */
async function updatePreferences(req, res) {
  try {
    const userId = req.user.id;
    const { notification_type, push_enabled, sms_enabled, in_app_enabled } = req.body;

    const result = await notificationService.updatePreferences(
      userId,
      notification_type,
      { push_enabled, sms_enabled, in_app_enabled }
    );

    return res.status(200).json(success(result, 'Preferences updated'));
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to update preferences')
    );
  }
}

// ============================================================================
// CONTRÔLEURS — DEVICE TOKENS (FCM)
// ============================================================================

/**
 * POST /api/notifications/device
 * Enregistre un token FCM pour l'utilisateur.
 */
async function registerDevice(req, res) {
  try {
    const userId = req.user.id;
    const { token, platform, device_name } = req.body;

    const result = await fcmService.registerToken(userId, token, platform, device_name);

    return res.status(201).json(success(result, 'Device registered'));
  } catch (err) {
    const statusCode = err.statusCode || 400;
    return res.status(statusCode).json(
      errorResponse(err.message, statusCode)
    );
  }
}

/**
 * DELETE /api/notifications/device
 * Supprime un token FCM (logout).
 */
async function unregisterDevice(req, res) {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    const result = await fcmService.unregisterToken(userId, token);

    return res.status(200).json(success(result, 'Device unregistered'));
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to unregister device')
    );
  }
}

// ============================================================================
// CONTRÔLEURS — OTP
// ============================================================================

/**
 * POST /api/otp/send
 * Envoie un code OTP par SMS.
 */
async function sendOTP(req, res) {
  try {
    const userId = req.user?.id || null;
    const { phone_number, purpose } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress;

    const result = await otpService.sendOTP(phone_number, purpose, userId, ipAddress);

    return res.status(200).json(success(result, result.message));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to send OTP' : err.message,
        statusCode
      )
    );
  }
}

/**
 * POST /api/otp/verify
 * Vérifie un code OTP.
 */
async function verifyOTP(req, res) {
  try {
    const { phone_number, code, purpose } = req.body;

    const result = await otpService.verifyOTP(phone_number, code, purpose);

    return res.status(200).json(success(result, result.message));
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to verify OTP' : err.message,
        statusCode
      )
    );
  }
}

// ============================================================================
// CONTRÔLEURS — ADMIN
// ============================================================================

/**
 * POST /api/notifications/broadcast
 * Envoie une notification à tous les utilisateurs d'un rôle (admin uniquement).
 */
async function broadcastNotification(req, res) {
  try {
    const { role, title, message, type } = req.body;

    // Récupérer tous les utilisateurs du rôle
    const { data: users, error } = await require('../services/supabaseService').supabaseAdmin
      .from('profiles_data')
      .select('user_id')
      .eq('role', role);

    if (error || !users || users.length === 0) {
      return res.status(200).json(
        success({ sent: 0 }, 'No users found for this role')
      );
    }

    // Envoyer à chaque utilisateur
    let sentCount = 0;
    for (const user of users) {
      try {
        await notificationService.sendNotification({
          type: type || 'system_alert',
          recipients: { user_id: user.user_id },
          data: { title, message }
        });
        sentCount++;
      } catch {
        // Continuer avec les autres
      }
    }

    return res.status(200).json(
      success({ sent: sentCount, total: users.length }, 'Broadcast sent')
    );
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to broadcast notification')
    );
  }
}

module.exports = {
  getNotifications,
  markNotificationsRead,
  getPreferences,
  updatePreferences,
  registerDevice,
  unregisterDevice,
  sendOTP,
  verifyOTP,
  broadcastNotification
};
