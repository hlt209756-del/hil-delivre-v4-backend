/**
 * @file notificationService.js
 * @description Service mobile pour les notifications (API + FCM + Socket.IO).
 * Gère l'enregistrement du token FCM, la récupération des notifications,
 * et la connexion Socket.IO pour les mises à jour temps réel.
 */

'use strict';

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { io } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || 'http://localhost:3000';

let socketInstance = null;

// ============================================================================
// FONCTIONS — API NOTIFICATIONS
// ============================================================================

/**
 * Récupère les notifications de l'utilisateur.
 *
 * @param {Object} options - {page, limit, unread_only}
 * @returns {Promise<Object>}
 */
export async function getNotifications(options = {}) {
  try {
    const token = await SecureStore.getItemAsync('access_token');
    const params = new URLSearchParams({
      page: options.page || 1,
      limit: options.limit || 20,
      ...(options.unread_only && { unread_only: 'true' })
    });

    const response = await fetch(`${API_BASE_URL}/notifications?${params}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to fetch notifications');
    return data.data;
  } catch (err) {
    console.error('[NotificationService] getNotifications error:', err.message);
    throw err;
  }
}

/**
 * Marque des notifications comme lues.
 *
 * @param {Array<string>} notificationIds - UUIDs (vide = marquer toutes)
 * @returns {Promise<Object>}
 */
export async function markAsRead(notificationIds = []) {
  try {
    const token = await SecureStore.getItemAsync('access_token');

    const response = await fetch(`${API_BASE_URL}/notifications/read`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notification_ids: notificationIds })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to mark as read');
    return data.data;
  } catch (err) {
    console.error('[NotificationService] markAsRead error:', err.message);
    throw err;
  }
}

/**
 * Récupère les préférences de notification.
 * @returns {Promise<Array>}
 */
export async function getPreferences() {
  try {
    const token = await SecureStore.getItemAsync('access_token');

    const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to fetch preferences');
    return data.data;
  } catch (err) {
    console.error('[NotificationService] getPreferences error:', err.message);
    throw err;
  }
}

/**
 * Met à jour les préférences de notification.
 *
 * @param {string} notificationType
 * @param {Object} preferences - {push_enabled, sms_enabled, in_app_enabled}
 * @returns {Promise<Object>}
 */
export async function updatePreferences(notificationType, preferences) {
  try {
    const token = await SecureStore.getItemAsync('access_token');

    const response = await fetch(`${API_BASE_URL}/notifications/preferences`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ notification_type: notificationType, ...preferences })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to update preferences');
    return data.data;
  } catch (err) {
    console.error('[NotificationService] updatePreferences error:', err.message);
    throw err;
  }
}

// ============================================================================
// FONCTIONS — FCM / EXPO PUSH
// ============================================================================

/**
 * Enregistre le token push FCM auprès du backend.
 * Doit être appelé au login et au refresh du token.
 *
 * @returns {Promise<Object>}
 */
export async function registerPushToken() {
  try {
    if (!Device.isDevice) {
      console.warn('[NotificationService] Push not available on emulator');
      return { success: false, reason: 'emulator' };
    }

    // Demander la permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return { success: false, reason: 'permission_denied' };
    }

    // Obtenir le token FCM
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID
    });
    const pushToken = tokenData.data;

    // Enregistrer auprès du backend
    const accessToken = await SecureStore.getItemAsync('access_token');
    const platform = Platform.OS; // 'ios' ou 'android'

    const response = await fetch(`${API_BASE_URL}/notifications/device`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: pushToken,
        platform,
        device_name: Device.modelName || `${Device.brand} ${Device.modelId}`
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to register token');

    // Stocker le token localement
    await SecureStore.setItemAsync('push_token', pushToken);

    return { success: true, token: pushToken };
  } catch (err) {
    console.error('[NotificationService] registerPushToken error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Supprime le token push (à appeler au logout).
 */
export async function unregisterPushToken() {
  try {
    const pushToken = await SecureStore.getItemAsync('push_token');
    if (!pushToken) return;

    const accessToken = await SecureStore.getItemAsync('access_token');

    await fetch(`${API_BASE_URL}/notifications/device`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: pushToken })
    });

    await SecureStore.deleteItemAsync('push_token');
  } catch (err) {
    console.error('[NotificationService] unregisterPushToken error:', err.message);
  }
}

/**
 * Configure les handlers de notifications Expo.
 */
export function configureNotificationHandlers(onNotificationReceived, onNotificationTapped) {
  // Notification reçue en foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true
    })
  });

  // Listener : notification reçue
  const receivedSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      if (onNotificationReceived) {
        onNotificationReceived(notification);
      }
    }
  );

  // Listener : notification tappée
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      if (onNotificationTapped) {
        onNotificationTapped(response.notification);
      }
    }
  );

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}

// ============================================================================
// FONCTIONS — SOCKET.IO
// ============================================================================

/**
 * Connecte le client Socket.IO au serveur.
 *
 * @param {Object} callbacks - {onNotification, onOrderUpdate, onDelivererPosition}
 * @returns {Object} Instance socket
 */
export async function connectSocket(callbacks = {}) {
  try {
    if (socketInstance?.connected) {
      return socketInstance;
    }

    const token = await SecureStore.getItemAsync('access_token');
    if (!token) {
      throw new Error('No access token available');
    }

    socketInstance = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000
    });

    // Événements de connexion
    socketInstance.on('connect', () => {
      console.log('[Socket] Connected:', socketInstance.id);
    });

    socketInstance.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message);
    });

    socketInstance.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    // Événements métier
    if (callbacks.onNotification) {
      socketInstance.on('notification', callbacks.onNotification);
    }

    if (callbacks.onOrderUpdate) {
      socketInstance.on('order:update', callbacks.onOrderUpdate);
    }

    if (callbacks.onDelivererPosition) {
      socketInstance.on('deliverer:position', callbacks.onDelivererPosition);
    }

    return socketInstance;
  } catch (err) {
    console.error('[Socket] connectSocket error:', err.message);
    throw err;
  }
}

/**
 * Rejoint la room d'une commande pour le suivi temps réel.
 *
 * @param {string} orderId - UUID de la commande
 */
export function joinOrderRoom(orderId) {
  if (socketInstance?.connected) {
    socketInstance.emit('join:order', orderId);
  }
}

/**
 * Quitte la room d'une commande.
 *
 * @param {string} orderId - UUID de la commande
 */
export function leaveOrderRoom(orderId) {
  if (socketInstance?.connected) {
    socketInstance.emit('leave:order', orderId);
  }
}

/**
 * Envoie la position du livreur via Socket.IO.
 *
 * @param {string} orderId - UUID de la commande
 * @param {Object} location - {latitude, longitude, heading, speed}
 */
export function sendDelivererLocation(orderId, location) {
  if (socketInstance?.connected) {
    socketInstance.emit('deliverer:location', { orderId, ...location });
  }
}

/**
 * Marque des notifications comme lues via Socket.IO.
 *
 * @param {Array<string>} notificationIds
 */
export function markReadViaSocket(notificationIds) {
  if (socketInstance?.connected) {
    socketInstance.emit('notifications:read', notificationIds);
  }
}

/**
 * Déconnecte le Socket.IO.
 */
export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

/**
 * Vérifie si le socket est connecté.
 * @returns {boolean}
 */
export function isSocketConnected() {
  return socketInstance?.connected || false;
}

// ============================================================================
// FONCTIONS — OTP
// ============================================================================

/**
 * Envoie un OTP pour vérifier le numéro de téléphone.
 *
 * @param {string} phoneNumber
 * @param {string} purpose
 * @returns {Promise<Object>}
 */
export async function sendOTP(phoneNumber, purpose = 'phone_verification') {
  try {
    const token = await SecureStore.getItemAsync('access_token');

    const response = await fetch(`${API_BASE_URL}/otp/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone_number: phoneNumber, purpose })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to send OTP');
    return data.data;
  } catch (err) {
    console.error('[NotificationService] sendOTP error:', err.message);
    throw err;
  }
}

/**
 * Vérifie un code OTP.
 *
 * @param {string} phoneNumber
 * @param {string} code
 * @param {string} purpose
 * @returns {Promise<Object>}
 */
export async function verifyOTP(phoneNumber, code, purpose = 'phone_verification') {
  try {
    const token = await SecureStore.getItemAsync('access_token');

    const response = await fetch(`${API_BASE_URL}/otp/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phone_number: phoneNumber, code, purpose })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to verify OTP');
    return data.data;
  } catch (err) {
    console.error('[NotificationService] verifyOTP error:', err.message);
    throw err;
  }
}
