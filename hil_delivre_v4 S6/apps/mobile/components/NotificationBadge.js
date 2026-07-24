/**
 * @file NotificationBadge.js
 * @description Composant badge de notification pour la barre de navigation.
 * Affiche le nombre de notifications non lues avec animation.
 */

'use strict';

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { useNotifications } from '../contexts/NotificationContext';

// ============================================================================
// COMPOSANT
// ============================================================================

export default function NotificationBadge({ size = 'normal' }) {
  const { unreadCount } = useNotifications();
  const scaleAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (unreadCount > 0) {
      // Animation de pop-in
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.3,
          duration: 150,
          useNativeDriver: true
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true
        })
      ]).start();
    } else {
      Animated.timing(scaleAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true
      }).start();
    }
  }, [unreadCount]);

  if (unreadCount === 0) return null;

  const isSmall = size === 'small';
  const displayCount = unreadCount > 99 ? '99+' : unreadCount.toString();

  return (
    <Animated.View
      style={[
        styles.badge,
        isSmall && styles.badgeSmall,
        { transform: [{ scale: scaleAnim }] }
      ]}
    >
      <Text style={[styles.badgeText, isSmall && styles.badgeTextSmall]}>
        {displayCount}
      </Text>
    </Animated.View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#FFF'
  },
  badgeSmall: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    top: -2,
    right: -6
  },
  badgeText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700'
  },
  badgeTextSmall: {
    fontSize: 9
  }
});
