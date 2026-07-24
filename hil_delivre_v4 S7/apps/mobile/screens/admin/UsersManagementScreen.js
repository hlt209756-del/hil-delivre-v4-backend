/**
 * @file UsersManagementScreen.js
 * @description Écran de gestion des utilisateurs pour l'admin mobile.
 * Liste, recherche, filtrage et actions (suspend/unsuspend/delete).
 */

'use strict';

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, RefreshControl
} from 'react-native';
import { apiClient } from '../../services/apiClient';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function UsersManagementScreen({ route, navigation }) {
  const initialRole = route?.params?.role || null;

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState(initialRole);
  const [statusFilter, setStatusFilter] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const LIMIT = 20;

  // ====================================================================
  // CHARGEMENT
  // ====================================================================

  const loadUsers = useCallback(async (pageNum = 1, append = false) => {
    try {
      const params = { page: pageNum, limit: LIMIT };
      if (roleFilter) params.role = roleFilter;
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();

      const response = await apiClient.get('/admin/users', { params });
      const { users: newUsers, total: newTotal } = response.data.data;

      if (append) {
        setUsers(prev => [...prev, ...newUsers]);
      } else {
        setUsers(newUsers);
      }
      setTotal(newTotal);
      setHasMore(newUsers.length === LIMIT);
    } catch (err) {
      Alert.alert('Erreur', err.message || 'Impossible de charger les utilisateurs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [roleFilter, statusFilter, search]);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    loadUsers(1);
  }, [roleFilter, statusFilter, loadUsers]);

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    loadUsers(1);
  };

  const loadMore = () => {
    if (!hasMore || loading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadUsers(nextPage, true);
  };

  const onSearch = () => {
    setLoading(true);
    setPage(1);
    loadUsers(1);
  };

  // ====================================================================
  // ACTIONS
  // ====================================================================

  const handleSuspend = (user) => {
    Alert.prompt(
      'Suspendre l\'utilisateur',
      `Raison de la suspension de ${user.full_name || 'cet utilisateur'} :`,
      async (reason) => {
        if (!reason || reason.length < 10) {
          Alert.alert('Erreur', 'La raison doit contenir au moins 10 caractères');
          return;
        }
        try {
          await apiClient.post(`/admin/users/${user.user_id}/suspend`, { reason });
          Alert.alert('Succès', 'Utilisateur suspendu');
          loadUsers(1);
        } catch (err) {
          Alert.alert('Erreur', err.response?.data?.error || 'Échec de la suspension');
        }
      },
      'plain-text'
    );
  };

  const handleUnsuspend = async (user) => {
    Alert.alert(
      'Réactiver l\'utilisateur',
      `Voulez-vous réactiver ${user.full_name || 'cet utilisateur'} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réactiver',
          onPress: async () => {
            try {
              await apiClient.post(`/admin/users/${user.user_id}/unsuspend`);
              Alert.alert('Succès', 'Utilisateur réactivé');
              loadUsers(1);
            } catch (err) {
              Alert.alert('Erreur', err.response?.data?.error || 'Échec de la réactivation');
            }
          }
        }
      ]
    );
  };

  // ====================================================================
  // RENDU
  // ====================================================================

  const renderUser = ({ item }) => (
    <TouchableOpacity
      style={styles.userCard}
      onPress={() => navigation.navigate('UserDetail', { userId: item.user_id })}
    >
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.full_name || 'Sans nom'}</Text>
        <Text style={styles.userPhone}>{item.phone || 'Pas de téléphone'}</Text>
        <View style={styles.badges}>
          <View style={[styles.badge, styles[`badge_${item.role}`]]}>
            <Text style={styles.badgeText}>{item.role}</Text>
          </View>
          {item.is_suspended && (
            <View style={[styles.badge, styles.badge_suspended]}>
              <Text style={styles.badgeText}>Suspendu</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.userActions}>
        {item.is_suspended ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnGreen]}
            onPress={() => handleUnsuspend(item)}
          >
            <Text style={styles.actionBtnText}>Réactiver</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnRed]}
            onPress={() => handleSuspend(item)}
          >
            <Text style={styles.actionBtnText}>Suspendre</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Barre de recherche */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher (nom, téléphone)..."
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
      </View>

      {/* Filtres par rôle */}
      <View style={styles.filters}>
        {[null, 'client', 'merchant', 'deliverer'].map(role => (
          <TouchableOpacity
            key={role || 'all'}
            style={[styles.filterChip, roleFilter === role && styles.filterChipActive]}
            onPress={() => setRoleFilter(role)}
          >
            <Text style={[styles.filterText, roleFilter === role && styles.filterTextActive]}>
              {role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Tous'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Filtres par statut */}
      <View style={styles.filters}>
        {[null, 'active', 'suspended'].map(status => (
          <TouchableOpacity
            key={status || 'all'}
            style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
            onPress={() => setStatusFilter(status)}
          >
            <Text style={[styles.filterText, statusFilter === status && styles.filterTextActive]}>
              {status === 'suspended' ? 'Suspendus' : status === 'active' ? 'Actifs' : 'Tous'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Compteur */}
      <Text style={styles.counter}>{total} utilisateur(s)</Text>

      {/* Liste */}
      {loading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <FlatList
          data={users}
          renderItem={renderUser}
          keyExtractor={item => item.user_id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <Text style={styles.emptyText}>Aucun utilisateur trouvé</Text>
          }
          ListFooterComponent={
            hasMore && users.length > 0 ? (
              <ActivityIndicator size="small" color="#1E88E5" style={styles.footerLoader} />
            ) : null
          }
        />
      )}
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  searchBar: { padding: 12, backgroundColor: '#FFF' },
  searchInput: {
    backgroundColor: '#F0F0F0', borderRadius: 8, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14
  },
  filters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#E0E0E0'
  },
  filterChipActive: { backgroundColor: '#1E88E5' },
  filterText: { fontSize: 12, color: '#666' },
  filterTextActive: { color: '#FFF', fontWeight: '600' },
  counter: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 12, color: '#999' },
  loader: { marginTop: 40 },
  userCard: {
    flexDirection: 'row', backgroundColor: '#FFF', marginHorizontal: 12,
    marginVertical: 4, borderRadius: 10, padding: 14, elevation: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 15, fontWeight: '600', color: '#333' },
  userPhone: { fontSize: 13, color: '#666', marginTop: 2 },
  badges: { flexDirection: 'row', marginTop: 6, gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badge_client: { backgroundColor: '#E3F2FD' },
  badge_merchant: { backgroundColor: '#F3E5F5' },
  badge_deliverer: { backgroundColor: '#FBE9E7' },
  badge_suspended: { backgroundColor: '#FFEBEE' },
  badgeText: { fontSize: 10, fontWeight: '600', color: '#333' },
  userActions: { justifyContent: 'center' },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6 },
  actionBtnRed: { backgroundColor: '#FFEBEE' },
  actionBtnGreen: { backgroundColor: '#E8F5E9' },
  actionBtnText: { fontSize: 12, fontWeight: '600' },
  emptyText: { textAlign: 'center', marginTop: 40, color: '#999', fontSize: 14 },
  footerLoader: { marginVertical: 16 }
});
