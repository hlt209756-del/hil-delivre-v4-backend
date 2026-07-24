/**
 * @file NotificationsScreen.js
 * @description Écran de liste des notifications (commun à tous les rôles).
 * Affiche les notifications in-app avec pagination, pull-to-refresh,
 * et marquage comme lu au tap.
 */

'use strict';

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  StyleSheet,
  ActivityIndicator,
  Alert
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  getNotifications,
  markAsRead,
  markReadViaSocket
} from '../../services/notificationService';

// ============================================================================
// CONSTANTES
// ============================================================================

const PAGE_SIZE = 20;

const NOTIFICATION_ICONS = {
  order_created: '📦',
  order_accepted: '✅',
  order_ready: '🍽️',
  order_picked_up: '🏃',
  order_in_delivery: '🚗',
  order_delivered: '🎉',
  order_cancelled: '❌',
  delivery_proposed: '🔔',
  delivery_accepted: '✅',
  delivery_rejected: '↩️',
  payment_received: '💰',
  payment_failed: '⚠️',
  kyc_approved: '✅',
  kyc_rejected: '❌',
  system_alert: 'ℹ️',
  promotion: '🎁'
};

// ============================================================================
// COMPOSANT
// ============================================================================

export default function NotificationsScreen() {
  const navigation = useNavigation();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'

  // ====================================================================
  // CHARGEMENT
  // ====================================================================

  const loadNotifications = useCallback(async (pageNum = 1, append = false) => {
    try {
      const result = await getNotifications({
        page: pageNum,
        limit: PAGE_SIZE,
        unread_only: filter === 'unread'
      });

      if (append) {
        setNotifications(prev => [...prev, ...result.notifications]);
      } else {
        setNotifications(result.notifications);
      }

      setUnreadCount(result.unread_count);
      setHasMore(result.notifications.length === PAGE_SIZE);
      setPage(pageNum);
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de charger les notifications.');
    }
  }, [filter]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadNotifications(1, false);
      setLoading(false);
    };
    init();
  }, [loadNotifications]);

  // ====================================================================
  // ACTIONS
  // ====================================================================

  const onRefresh = async () => {
    setRefreshing(true);
    await loadNotifications(1, false);
    setRefreshing(false);
  };

  const onLoadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    await loadNotifications(page + 1, true);
    setLoadingMore(false);
  };

  const onNotificationPress = async (notification) => {
    // Marquer comme lu
    if (!notification.is_read) {
      try {
        await markAsRead([notification.id]);
        markReadViaSocket([notification.id]);
        setNotifications(prev =>
          prev.map(n => n.id === notification.id ? { ...n, is_read: true } : n)
        );
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch {
        // Silencieux
      }
    }

    // Navigation contextuelle
    if (notification.related_entity_type === 'order' && notification.related_entity_id) {
      navigation.navigate('OrderDetail', { orderId: notification.related_entity_id });
    }
  };

  const onMarkAllRead = async () => {
    try {
      await markAsRead([]);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      Alert.alert('Erreur', 'Impossible de marquer comme lu.');
    }
  };

  // ====================================================================
  // RENDU
  // ====================================================================

  const renderNotification = ({ item }) => {
    const icon = NOTIFICATION_ICONS[item.type] || 'ℹ️';
    const timeAgo = getTimeAgo(item.created_at);

    return (
      <TouchableOpacity
        style={[styles.notificationItem, !item.is_read && styles.unreadItem]}
        onPress={() => onNotificationPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <View style={styles.contentContainer}>
          <Text style={[styles.title, !item.is_read && styles.unreadTitle]}>
            {item.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {item.body}
          </Text>
          <Text style={styles.time}>{timeAgo}</Text>
        </View>
        {!item.is_read && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterButton, filter === 'all' && styles.filterActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            Toutes
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterButton, filter === 'unread' && styles.filterActive]}
          onPress={() => setFilter('unread')}
        >
          <Text style={[styles.filterText, filter === 'unread' && styles.filterTextActive]}>
            Non lues ({unreadCount})
          </Text>
        </TouchableOpacity>
      </View>
      {unreadCount > 0 && (
        <TouchableOpacity style={styles.markAllButton} onPress={onMarkAllRead}>
          <Text style={styles.markAllText}>Tout marquer comme lu</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>🔔</Text>
      <Text style={styles.emptyText}>
        {filter === 'unread'
          ? 'Aucune notification non lue'
          : 'Aucune notification'}
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color="#FF6B35" />
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF6B35" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={renderNotification}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#FF6B35']}
            tintColor="#FF6B35"
          />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.3}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

function getTimeAgo(dateString) {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'À l\'instant';
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  return date.toLocaleDateString('fr-FR');
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0'
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F0F0F0'
  },
  filterActive: {
    backgroundColor: '#FF6B35'
  },
  filterText: {
    fontSize: 14,
    color: '#666'
  },
  filterTextActive: {
    color: '#FFF',
    fontWeight: '600'
  },
  markAllButton: {
    marginTop: 8,
    alignSelf: 'flex-end'
  },
  markAllText: {
    fontSize: 13,
    color: '#FF6B35',
    fontWeight: '500'
  },
  notificationItem: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    alignItems: 'center'
  },
  unreadItem: {
    backgroundColor: '#FFF8F5'
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  icon: {
    fontSize: 20
  },
  contentContainer: {
    flex: 1
  },
  title: {
    fontSize: 15,
    color: '#333',
    marginBottom: 2
  },
  unreadTitle: {
    fontWeight: '700'
  },
  body: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18
  },
  time: {
    fontSize: 11,
    color: '#999',
    marginTop: 4
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF6B35',
    marginLeft: 8
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16
  },
  emptyText: {
    fontSize: 16,
    color: '#999'
  },
  footer: {
    paddingVertical: 16,
    alignItems: 'center'
  }
});
