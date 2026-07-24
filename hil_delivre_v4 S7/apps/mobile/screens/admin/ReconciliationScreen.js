/**
 * @file ReconciliationScreen.js
 * @description Écran de gestion de la réconciliation cash pour l'admin.
 * Affiche les fiches de réconciliation, permet de confirmer ou contester.
 */

'use strict';

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, RefreshControl
} from 'react-native';
import { apiClient } from '../../services/apiClient';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function ReconciliationScreen({ navigation }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const LIMIT = 20;

  // ====================================================================
  // CHARGEMENT
  // ====================================================================

  const loadReconciliations = useCallback(async (pageNum = 1) => {
    try {
      const params = { page: pageNum, limit: LIMIT };
      if (statusFilter) params.status = statusFilter;

      const response = await apiClient.get('/admin/reconciliation', { params });
      const { records: newRecords, total: newTotal } = response.data.data;

      setRecords(pageNum === 1 ? newRecords : prev => [...prev, ...newRecords]);
      setTotal(newTotal);
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de charger les réconciliations');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    setPage(1);
    loadReconciliations(1);
  }, [statusFilter, loadReconciliations]);

  const onRefresh = () => {
    setRefreshing(true);
    setPage(1);
    loadReconciliations(1);
  };

  // ====================================================================
  // ACTIONS
  // ====================================================================

  const handleConfirm = async (record) => {
    Alert.alert(
      'Confirmer la réconciliation',
      `Confirmer la réception de ${formatCFA(record.amount_to_remit)} du livreur ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            try {
              await apiClient.post(`/admin/reconciliation/${record.id}/confirm`);
              Alert.alert('Succès', 'Réconciliation confirmée');
              loadReconciliations(1);
            } catch (err) {
              Alert.alert('Erreur', err.response?.data?.error || 'Échec de la confirmation');
            }
          }
        }
      ]
    );
  };

  const handleDispute = (record) => {
    Alert.prompt(
      'Contester la réconciliation',
      'Raison de la contestation (min. 10 caractères) :',
      async (reason) => {
        if (!reason || reason.length < 10) {
          Alert.alert('Erreur', 'La raison doit contenir au moins 10 caractères');
          return;
        }
        try {
          await apiClient.post(`/admin/reconciliation/${record.id}/dispute`, { reason });
          Alert.alert('Succès', 'Réconciliation contestée');
          loadReconciliations(1);
        } catch (err) {
          Alert.alert('Erreur', err.response?.data?.error || 'Échec');
        }
      },
      'plain-text'
    );
  };

  // ====================================================================
  // RENDU
  // ====================================================================

  const getStatusColor = (status) => {
    const colors = {
      pending: '#FF9800',
      submitted: '#1E88E5',
      confirmed: '#4CAF50',
      disputed: '#F44336',
      resolved: '#9E9E9E'
    };
    return colors[status] || '#666';
  };

  const renderRecord = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + '20' }]}>
          <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.dateText}>
          {new Date(item.created_at).toLocaleDateString('fr-FR')}
        </Text>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Période</Text>
          <Text style={styles.infoValue}>
            {new Date(item.period_start).toLocaleDateString('fr-FR')} →{' '}
            {new Date(item.period_end).toLocaleDateString('fr-FR')}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Cash collecté</Text>
          <Text style={styles.infoValue}>{formatCFA(item.total_cash_collected)}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Commandes</Text>
          <Text style={styles.infoValue}>{item.total_orders_cash}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Commission plateforme</Text>
          <Text style={styles.infoValue}>{formatCFA(item.platform_commission)}</Text>
        </View>
        <View style={[styles.infoRow, styles.highlightRow]}>
          <Text style={styles.highlightLabel}>À reverser</Text>
          <Text style={styles.highlightValue}>{formatCFA(item.amount_to_remit)}</Text>
        </View>
      </View>

      {item.payment_reference && (
        <Text style={styles.refText}>Réf: {item.payment_reference}</Text>
      )}

      {item.dispute_reason && (
        <Text style={styles.disputeText}>Contestation: {item.dispute_reason}</Text>
      )}

      {/* Actions */}
      {item.status === 'submitted' && (
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.confirmBtn]}
            onPress={() => handleConfirm(item)}
          >
            <Text style={styles.confirmBtnText}>Confirmer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.disputeBtn]}
            onPress={() => handleDispute(item)}
          >
            <Text style={styles.disputeBtnText}>Contester</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Filtres */}
      <View style={styles.filters}>
        {[null, 'pending', 'submitted', 'confirmed', 'disputed'].map(status => (
          <TouchableOpacity
            key={status || 'all'}
            style={[styles.filterChip, statusFilter === status && styles.filterChipActive]}
            onPress={() => setStatusFilter(status)}
          >
            <Text style={[styles.filterText, statusFilter === status && styles.filterTextActive]}>
              {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Tous'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.counter}>{total} enregistrement(s)</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <FlatList
          data={records}
          renderItem={renderRecord}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <Text style={styles.emptyText}>Aucune réconciliation trouvée</Text>
          }
        />
      )}
    </View>
  );
}

// ============================================================================
// UTILITAIRES
// ============================================================================

function formatCFA(amount) {
  return new Intl.NumberFormat('fr-FR').format(amount || 0) + ' FCFA';
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  filters: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexWrap: 'wrap' },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#E0E0E0' },
  filterChipActive: { backgroundColor: '#1E88E5' },
  filterText: { fontSize: 11, color: '#666' },
  filterTextActive: { color: '#FFF', fontWeight: '600' },
  counter: { paddingHorizontal: 16, paddingBottom: 8, fontSize: 12, color: '#999' },
  loader: { marginTop: 40 },
  card: {
    backgroundColor: '#FFF', marginHorizontal: 12, marginVertical: 6,
    borderRadius: 12, padding: 16, elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { fontSize: 10, fontWeight: '700' },
  dateText: { fontSize: 12, color: '#999' },
  cardBody: { gap: 6 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel: { fontSize: 13, color: '#666' },
  infoValue: { fontSize: 13, fontWeight: '500', color: '#333' },
  highlightRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#EEE' },
  highlightLabel: { fontSize: 14, fontWeight: '600', color: '#333' },
  highlightValue: { fontSize: 14, fontWeight: '700', color: '#1E88E5' },
  refText: { fontSize: 11, color: '#999', marginTop: 8 },
  disputeText: { fontSize: 12, color: '#F44336', marginTop: 8, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', marginTop: 14, gap: 10 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  confirmBtn: { backgroundColor: '#E8F5E9' },
  confirmBtnText: { color: '#4CAF50', fontWeight: '600', fontSize: 14 },
  disputeBtn: { backgroundColor: '#FFEBEE' },
  disputeBtnText: { color: '#F44336', fontWeight: '600', fontSize: 14 },
  emptyText: { textAlign: 'center', marginTop: 40, color: '#999', fontSize: 14 }
});
