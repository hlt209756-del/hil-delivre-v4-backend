/**
 * @file NotificationContext.js
 * @description Context React pour la gestion globale des notifications.
 * Fournit : connexion Socket.IO, push FCM, compteur non-lues, handlers.
 */

'use strict';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AppState, Vibration } from 'react-native';
import {
  connectSocket,
  disconnectSocket,
  registerPushToken,
  unregisterPushToken,
  configureNotificationHandlers,
  getNotifications,
  isSocketConnected
} from '../services/notificationService';

// ============================================================================
// CONTEXT
// ============================================================================

const NotificationContext = createContext(null);

// ============================================================================
// PROVIDER
// ============================================================================

export function NotificationProvider({ children }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastNotification, setLastNotification] = useState(null);
  const appState = useRef(AppState.currentState);

  // ====================================================================
  // INITIALISATION
  // ====================================================================

  const initialize = useCallback(async () => {
    try {
      // 1. Enregistrer le token push
      await registerPushToken();

      // 2. Connecter Socket.IO
      await connectSocket({
        onNotification: handleSocketNotification,
        onOrderUpdate: handleOrderUpdate,
        onDelivererPosition: null // Géré par DeliveryTrackingScreen
      });
      setIsConnected(true);

      // 3. Charger le compteur de non-lues
      await refreshUnreadCount();

      // 4. Configurer les handlers push natifs
      const cleanup = configureNotificationHandlers(
        handlePushReceived,
        handlePushTapped
      );

      return cleanup;
    } catch (err) {
      console.error('[NotificationContext] initialize error:', err.message);
    }
  }, []);

  const cleanup = useCallback(async () => {
    disconnectSocket();
    setIsConnected(false);
  }, []);

  // ====================================================================
  // APP STATE (foreground/background)
  // ====================================================================

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // App revient au premier plan → refresh
        refreshUnreadCount();
        if (!isSocketConnected()) {
          connectSocket({
            onNotification: handleSocketNotification,
            onOrderUpdate: handleOrderUpdate
          }).then(() => setIsConnected(true));
        }
      }
      appState.current = nextAppState;
    });

    return () => subscription?.remove();
  }, []);

  // ====================================================================
  // HANDLERS
  // ====================================================================

  const handleSocketNotification = (notification) => {
    setUnreadCount(prev => prev + 1);
    setLastNotification(notification);

    // Vibration courte pour les notifications importantes
    const importantTypes = ['delivery_proposed', 'order_created', 'payment_received'];
    if (importantTypes.includes(notification.type)) {
      Vibration.vibrate(200);
    }
  };

  const handleOrderUpdate = (update) => {
    // Peut être écouté par d'autres composants via le context
    setLastNotification(update);
  };

  const handlePushReceived = (notification) => {
    setUnreadCount(prev => prev + 1);
  };

  const handlePushTapped = (notification) => {
    // Navigation gérée par le composant parent (NavigationContainer)
    setLastNotification({
      type: 'push_tapped',
      data: notification.request?.content?.data
    });
  };

  // ====================================================================
  // FONCTIONS PUBLIQUES
  // ====================================================================

  const refreshUnreadCount = async () => {
    try {
      const result = await getNotifications({ page: 1, limit: 1 });
      setUnreadCount(result.unread_count || 0);
    } catch {
      // Silencieux
    }
  };

  const decrementUnread = (count = 1) => {
    setUnreadCount(prev => Math.max(0, prev - count));
  };

  const clearLastNotification = () => {
    setLastNotification(null);
  };

  // ====================================================================
  // VALEUR DU CONTEXT
  // ====================================================================

  const value = {
    unreadCount,
    isConnected,
    lastNotification,
    initialize,
    cleanup,
    refreshUnreadCount,
    decrementUnread,
    clearLastNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}

export default NotificationContext;
