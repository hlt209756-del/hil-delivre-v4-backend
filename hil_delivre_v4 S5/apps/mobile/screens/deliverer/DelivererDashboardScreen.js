/**
 * @file DelivererDashboardScreen.js
 * @description Dashboard principal du livreur.
 * Affiche les propositions de course, le toggle online/offline,
 * et la course en cours avec actions (pickup, delivery).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Switch,
  Alert,
  RefreshControl,
  Vibration
} from 'react-native';
import * as Location from 'expo-location';
import {
  getActiveAssignments,
  acceptAssignment,
  rejectAssignment,
  updateLocation,
  updateAvailability,
  recordTrackingEvent
} from '../../services/deliveryService';

// ============================================================================
// CONSTANTES
// ============================================================================

const LOCATION_UPDATE_INTERVAL_MS = 15000; // 15 secondes
const COLORS = {
  primary: '#FF6B35',
  secondary: '#004E89',
  success: '#28A745',
  danger: '#DC3545',
  warning: '#FFC107',
  background: '#F8F9FA',
  card: '#FFFFFF',
  text: '#212529',
  textSecondary: '#6C757D',
  online: '#28A745',
  offline: '#6C757D'
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function DelivererDashboardScreen() {
  // State
  const [isOnline, setIsOnline] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);

  // Refs
  const locationWatcherRef = useRef(null);
  const assignmentPollingRef = useRef(null);

  // ============================================================================
  // EFFETS
  // ============================================================================

  useEffect(() => {
    requestLocationPermission();
    return () => {
      stopLocationTracking();
      if (assignmentPollingRef.current) {
        clearInterval(assignmentPollingRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isOnline) {
      startLocationTracking();
      startAssignmentPolling();
    } else {
      stopLocationTracking();
      if (assignmentPollingRef.current) {
        clearInterval(assignmentPollingRef.current);
      }
    }
  }, [isOnline]);

  // ============================================================================
  // PERMISSIONS & LOCALISATION
  // ============================================================================

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setLocationPermission(true);
        // Demander aussi la permission background
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus !== 'granted') {
          Alert.alert(
            'Permission requise',
            'La localisation en arrière-plan est nécessaire pour le suivi de livraison.'
          );
        }
      } else {
        Alert.alert(
          'Permission refusée',
          'La localisation est nécessaire pour recevoir des courses.'
        );
      }
    } catch (error) {
      console.error('Location permission error:', error);
    }
  };

  const startLocationTracking = async () => {
    if (!locationPermission) return;

    try {
      locationWatcherRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: LOCATION_UPDATE_INTERVAL_MS,
          distanceInterval: 20 // Minimum 20m de déplacement
        },
        async (location) => {
          try {
            await updateLocation({
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              heading: location.coords.heading,
              speed: location.coords.speed ? location.coords.speed * 3.6 : null, // m/s → km/h
              accuracy: location.coords.accuracy
            });
          } catch {
            // Silencieux - ne pas bloquer le tracking
          }
        }
      );
    } catch (error) {
      console.error('Location tracking error:', error);
    }
  };

  const stopLocationTracking = () => {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
  };

  // ============================================================================
  // POLLING ASSIGNATIONS
  // ============================================================================

  const startAssignmentPolling = () => {
    loadAssignments();
    assignmentPollingRef.current = setInterval(loadAssignments, 10000); // 10s
  };

  const loadAssignments = async () => {
    try {
      const result = await getActiveAssignments();
      const newAssignments = result?.data || [];

      // Vibrer si nouvelle assignation
      if (newAssignments.length > assignments.length) {
        Vibration.vibrate([0, 500, 200, 500]);
      }

      setAssignments(newAssignments);
    } catch {
      // Silencieux
    }
  };

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleToggleOnline = useCallback(async (value) => {
    try {
      setIsOnline(value);
      await updateAvailability(value ? 'online' : 'offline');
    } catch (error) {
      setIsOnline(!value); // Rollback
      Alert.alert('Erreur', 'Impossible de changer votre statut.');
    }
  }, []);

  const handleAcceptAssignment = useCallback(async (assignmentId) => {
    try {
      const result = await acceptAssignment(assignmentId);
      if (result?.data) {
        setCurrentOrder(result.data);
        setAssignments(prev => prev.filter(a => a.id !== assignmentId));
        Alert.alert('Course acceptée', 'Dirigez-vous vers le restaurant.');
      }
    } catch (error) {
      Alert.alert('Erreur', error.message || 'Impossible d\'accepter la course.');
    }
  }, []);

  const handleRejectAssignment = useCallback(async (assignmentId) => {
    Alert.alert(
      'Refuser la course ?',
      'Cette course sera proposée à un autre livreur.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            try {
              await rejectAssignment(assignmentId, 'Livreur indisponible');
              setAssignments(prev => prev.filter(a => a.id !== assignmentId));
            } catch (error) {
              Alert.alert('Erreur', error.message);
            }
          }
        }
      ]
    );
  }, []);

  const handleTrackingAction = useCallback(async (eventType) => {
    if (!currentOrder?.order_id) return;

    try {
      const location = await Location.getCurrentPositionAsync({});
      await recordTrackingEvent(
        currentOrder.order_id,
        eventType,
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude
        }
      );

      // Mettre à jour l'UI selon l'action
      if (eventType === 'order_picked_up') {
        Alert.alert('Commande récupérée', 'Dirigez-vous vers le client.');
      } else if (eventType === 'order_delivered') {
        Alert.alert('Livraison terminée', 'Merci !');
        setCurrentOrder(null);
        await updateAvailability('online');
      }
    } catch (error) {
      Alert.alert('Erreur', error.message);
    }
  }, [currentOrder]);

  const onRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadAssignments();
    setIsRefreshing(false);
  }, []);

  // ============================================================================
  // RENDU
  // ============================================================================

  return (
    <View style={styles.container}>
      {/* Header avec toggle online/offline */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Tableau de bord</Text>
          <Text style={[styles.statusText, isOnline ? styles.onlineText : styles.offlineText]}>
            {isOnline ? '● En ligne' : '○ Hors ligne'}
          </Text>
        </View>
        <Switch
          value={isOnline}
          onValueChange={handleToggleOnline}
          trackColor={{ false: '#E9ECEF', true: '#A5D6A7' }}
          thumbColor={isOnline ? COLORS.online : COLORS.offline}
        />
      </View>

      {/* Course en cours */}
      {currentOrder && (
        <View style={styles.currentOrderCard}>
          <Text style={styles.currentOrderTitle}>Course en cours</Text>
          <Text style={styles.currentOrderId}>
            Commande #{currentOrder.order_id?.slice(0, 8)}
          </Text>

          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.actionButton, styles.pickupButton]}
              onPress={() => handleTrackingAction('order_picked_up')}
            >
              <Text style={styles.actionButtonText}>📦 Récupérée</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.deliverButton]}
              onPress={() => handleTrackingAction('order_delivered')}
            >
              <Text style={styles.actionButtonText}>✓ Livrée</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Liste des assignations */}
      {isOnline && !currentOrder && (
        <FlatList
          data={assignments}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                En attente de courses...
              </Text>
              <Text style={styles.emptySubtext}>
                Restez dans une zone à forte demande pour recevoir des propositions.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.assignmentCard}>
              <View style={styles.assignmentInfo}>
                <Text style={styles.assignmentDistance}>
                  📍 {item.distance_to_merchant?.toFixed(1)} km du restaurant
                </Text>
                <Text style={styles.assignmentTime}>
                  ⏱ ~{item.estimated_pickup_time} min pour récupérer
                </Text>
                {item.orders && (
                  <Text style={styles.assignmentAmount}>
                    💰 {Math.ceil(item.orders.delivery_fee || 0).toLocaleString('fr-FR')} FCFA
                  </Text>
                )}
              </View>

              <View style={styles.assignmentActions}>
                <TouchableOpacity
                  style={[styles.assignmentButton, styles.acceptButton]}
                  onPress={() => handleAcceptAssignment(item.id)}
                >
                  <Text style={styles.acceptButtonText}>Accepter</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.assignmentButton, styles.rejectButton]}
                  onPress={() => handleRejectAssignment(item.id)}
                >
                  <Text style={styles.rejectButtonText}>Refuser</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Message hors ligne */}
      {!isOnline && (
        <View style={styles.offlineContainer}>
          <Text style={styles.offlineTitle}>Vous êtes hors ligne</Text>
          <Text style={styles.offlineSubtext}>
            Activez votre statut pour recevoir des propositions de course.
          </Text>
        </View>
      )}
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 60, backgroundColor: COLORS.card,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2
  },
  title: { fontSize: 22, fontWeight: '700', color: COLORS.text },
  statusText: { fontSize: 14, marginTop: 4 },
  onlineText: { color: COLORS.online },
  offlineText: { color: COLORS.offline },
  currentOrderCard: {
    margin: 16, padding: 16, backgroundColor: COLORS.card,
    borderRadius: 12, borderLeftWidth: 4, borderLeftColor: COLORS.primary
  },
  currentOrderTitle: { fontSize: 16, fontWeight: '600', color: COLORS.text },
  currentOrderId: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  actionButtons: { flexDirection: 'row', gap: 10, marginTop: 12 },
  actionButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  pickupButton: { backgroundColor: COLORS.secondary },
  deliverButton: { backgroundColor: COLORS.success },
  actionButtonText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  assignmentCard: {
    margin: 16, marginBottom: 8, padding: 16, backgroundColor: COLORS.card,
    borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2
  },
  assignmentInfo: { marginBottom: 12 },
  assignmentDistance: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  assignmentTime: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  assignmentAmount: { fontSize: 14, fontWeight: '600', color: COLORS.primary, marginTop: 4 },
  assignmentActions: { flexDirection: 'row', gap: 10 },
  assignmentButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  acceptButton: { backgroundColor: COLORS.primary },
  acceptButtonText: { color: '#FFF', fontWeight: '600' },
  rejectButton: { backgroundColor: '#F8F9FA', borderWidth: 1, borderColor: COLORS.danger },
  rejectButtonText: { color: COLORS.danger, fontWeight: '600' },
  emptyContainer: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 16, fontWeight: '500', color: COLORS.text },
  emptySubtext: { fontSize: 13, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 },
  offlineContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  offlineTitle: { fontSize: 18, fontWeight: '600', color: COLORS.textSecondary },
  offlineSubtext: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 8 }
});
