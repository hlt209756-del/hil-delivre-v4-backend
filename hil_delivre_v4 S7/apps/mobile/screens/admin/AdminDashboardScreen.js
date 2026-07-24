/**
 * @file AdminDashboardScreen.js
 * @description Écran dashboard admin pour l'application mobile.
 * Affiche les métriques temps réel et les indicateurs clés.
 */

'use strict';

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, RefreshControl,
  StyleSheet, ActivityIndicator, TouchableOpacity
} from 'react-native';
import { apiClient } from '../../services/apiClient';

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function AdminDashboardScreen({ navigation }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // ====================================================================
  // CHARGEMENT
  // ====================================================================

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      const response = await apiClient.get('/admin/dashboard');
      setMetrics(response.data.data);
    } catch (err) {
      setError(err.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
    // Refresh automatique toutes les 60 secondes
    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const onRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  // ====================================================================
  // RENDU
  // ====================================================================

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1E88E5" />
        <Text style={styles.loadingText}>Chargement du dashboard...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadDashboard}>
          <Text style={styles.retryText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Dashboard Admin</Text>
        <Text style={styles.headerSubtitle}>
          Mis à jour : {new Date(metrics?.generated_at).toLocaleTimeString('fr-FR')}
        </Text>
      </View>

      {/* Métriques temps réel */}
      <Text style={styles.sectionTitle}>Temps réel</Text>
      <View style={styles.metricsRow}>
        <MetricCard
          label="Commandes actives"
          value={metrics?.realtime?.active_orders || 0}
          color="#FF9800"
        />
        <MetricCard
          label="Livreurs en ligne"
          value={metrics?.realtime?.online_deliverers || 0}
          color="#4CAF50"
        />
        <MetricCard
          label="KYC en attente"
          value={metrics?.realtime?.pending_kyc || 0}
          color="#F44336"
          onPress={() => navigation.navigate('KYCManagement')}
        />
      </View>

      {/* Métriques du jour */}
      <Text style={styles.sectionTitle}>Aujourd'hui</Text>
      <View style={styles.metricsRow}>
        <MetricCard
          label="Commandes"
          value={metrics?.today?.total_orders || 0}
          color="#1E88E5"
        />
        <MetricCard
          label="Complétées"
          value={metrics?.today?.completed_orders || 0}
          color="#4CAF50"
        />
        <MetricCard
          label="Annulées"
          value={metrics?.today?.cancelled_orders || 0}
          color="#F44336"
        />
      </View>

      {/* Revenue */}
      <Text style={styles.sectionTitle}>Revenue du jour</Text>
      <View style={styles.revenueCard}>
        <View style={styles.revenueRow}>
          <Text style={styles.revenueLabel}>Commissions (5%)</Text>
          <Text style={styles.revenueValue}>
            {formatCFA(metrics?.today?.revenue_commissions || 0)}
          </Text>
        </View>
        <View style={styles.revenueRow}>
          <Text style={styles.revenueLabel}>Frais de livraison (1%)</Text>
          <Text style={styles.revenueValue}>
            {formatCFA(metrics?.today?.revenue_delivery_fees || 0)}
          </Text>
        </View>
        <View style={styles.revenueRow}>
          <Text style={styles.revenueLabel}>TVA collectée (18%)</Text>
          <Text style={styles.revenueValue}>
            {formatCFA(metrics?.today?.revenue_vat || 0)}
          </Text>
        </View>
        <View style={[styles.revenueRow, styles.revenueTotal]}>
          <Text style={styles.revenueTotalLabel}>Total</Text>
          <Text style={styles.revenueTotalValue}>
            {formatCFA(metrics?.today?.revenue_total || 0)}
          </Text>
        </View>
      </View>

      {/* Taux de complétion */}
      <View style={styles.completionCard}>
        <Text style={styles.completionLabel}>Taux de complétion</Text>
        <Text style={styles.completionValue}>
          {metrics?.today?.completion_rate || 0}%
        </Text>
      </View>

      {/* Utilisateurs */}
      <Text style={styles.sectionTitle}>Utilisateurs</Text>
      <View style={styles.metricsRow}>
        <MetricCard
          label="Clients"
          value={metrics?.users?.clients || 0}
          color="#1E88E5"
          onPress={() => navigation.navigate('UsersManagement', { role: 'client' })}
        />
        <MetricCard
          label="Marchands"
          value={metrics?.users?.merchants || 0}
          color="#9C27B0"
          onPress={() => navigation.navigate('UsersManagement', { role: 'merchant' })}
        />
        <MetricCard
          label="Livreurs"
          value={metrics?.users?.deliverers || 0}
          color="#FF5722"
          onPress={() => navigation.navigate('UsersManagement', { role: 'deliverer' })}
        />
      </View>

      {/* Actions rapides */}
      <Text style={styles.sectionTitle}>Actions rapides</Text>
      <View style={styles.actionsContainer}>
        <ActionButton
          label="Gestion utilisateurs"
          onPress={() => navigation.navigate('UsersManagement')}
        />
        <ActionButton
          label="Réconciliation cash"
          onPress={() => navigation.navigate('Reconciliation')}
        />
        <ActionButton
          label="Payouts marchands"
          onPress={() => navigation.navigate('Payouts')}
        />
        <ActionButton
          label="Statistiques"
          onPress={() => navigation.navigate('Statistics')}
        />
      </View>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ============================================================================
// COMPOSANTS INTERNES
// ============================================================================

function MetricCard({ label, value, color, onPress }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.metricCard} onPress={onPress}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Wrapper>
  );
}

function ActionButton({ label, onPress }) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress}>
      <Text style={styles.actionButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ============================================================================
// UTILITAIRES
// ============================================================================

function formatCFA(amount) {
  return new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, color: '#666', fontSize: 14 },
  errorText: { color: '#F44336', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryButton: { backgroundColor: '#1E88E5', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  retryText: { color: '#FFF', fontWeight: '600' },
  header: { padding: 20, backgroundColor: '#1E88E5' },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#FFF' },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginHorizontal: 16, marginTop: 20, marginBottom: 10 },
  metricsRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 8 },
  metricCard: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 12, padding: 16,
    alignItems: 'center', elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3
  },
  metricValue: { fontSize: 28, fontWeight: '700' },
  metricLabel: { fontSize: 11, color: '#666', marginTop: 4, textAlign: 'center' },
  revenueCard: {
    marginHorizontal: 16, backgroundColor: '#FFF', borderRadius: 12,
    padding: 16, elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3
  },
  revenueRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  revenueLabel: { fontSize: 14, color: '#666' },
  revenueValue: { fontSize: 14, fontWeight: '600', color: '#333' },
  revenueTotal: { borderTopWidth: 1, borderTopColor: '#EEE', marginTop: 8, paddingTop: 12 },
  revenueTotalLabel: { fontSize: 16, fontWeight: '700', color: '#333' },
  revenueTotalValue: { fontSize: 16, fontWeight: '700', color: '#1E88E5' },
  completionCard: {
    marginHorizontal: 16, marginTop: 12, backgroundColor: '#FFF',
    borderRadius: 12, padding: 16, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', elevation: 2
  },
  completionLabel: { fontSize: 14, color: '#666' },
  completionValue: { fontSize: 24, fontWeight: '700', color: '#4CAF50' },
  actionsContainer: { paddingHorizontal: 16, gap: 8 },
  actionButton: {
    backgroundColor: '#FFF', borderRadius: 12, padding: 16,
    elevation: 2, shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 3
  },
  actionButtonText: { fontSize: 15, fontWeight: '600', color: '#1E88E5' },
  bottomSpacer: { height: 40 }
});
