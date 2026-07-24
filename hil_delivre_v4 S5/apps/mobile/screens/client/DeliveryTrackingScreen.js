/**
 * @file DeliveryTrackingScreen.js
 * @description Écran de suivi de livraison en temps réel pour le client.
 * Affiche la position du livreur sur une carte, l'ETA et les étapes de livraison.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Alert
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useRoute } from '@react-navigation/native';
import { getDelivererPosition, getTrackingHistory } from '../../services/deliveryService';

// ============================================================================
// CONSTANTES
// ============================================================================

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.02;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

const POLLING_INTERVAL_MS = 5000; // 5 secondes

const COLORS = {
  primary: '#FF6B35',
  secondary: '#004E89',
  success: '#28A745',
  background: '#F8F9FA',
  card: '#FFFFFF',
  text: '#212529',
  textSecondary: '#6C757D',
  deliverer: '#FF6B35',
  merchant: '#004E89',
  client: '#28A745'
};

const ORDER_STEPS = [
  { key: 'accepted', label: 'Commande acceptée', icon: '✓' },
  { key: 'ready', label: 'Commande prête', icon: '🍽️' },
  { key: 'picked_up', label: 'Récupérée par le livreur', icon: '📦' },
  { key: 'in_delivery', label: 'En cours de livraison', icon: '🛵' },
  { key: 'delivered', label: 'Livrée', icon: '🎉' }
];

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function DeliveryTrackingScreen() {
  const route = useRoute();
  const { orderId, order } = route.params;

  // State
  const [delivererPosition, setDelivererPosition] = useState(null);
  const [trackingEvents, setTrackingEvents] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [eta, setEta] = useState(null);

  // Refs
  const mapRef = useRef(null);
  const pollingRef = useRef(null);

  // ============================================================================
  // EFFETS
  // ============================================================================

  // Chargement initial
  useEffect(() => {
    loadTrackingData();
    startPolling();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [orderId]);

  // Mise à jour du step actuel basé sur les événements
  useEffect(() => {
    if (order?.status) {
      const stepIndex = ORDER_STEPS.findIndex(s => s.key === order.status);
      if (stepIndex >= 0) {
        setCurrentStep(stepIndex);
      }
    }
  }, [order?.status, trackingEvents]);

  // ============================================================================
  // FONCTIONS
  // ============================================================================

  const loadTrackingData = useCallback(async () => {
    try {
      setIsLoading(true);

      // Charger la position du livreur
      const posResult = await getDelivererPosition(orderId);
      if (posResult?.data) {
        setDelivererPosition(posResult.data);
      }

      // Charger l'historique de tracking
      const histResult = await getTrackingHistory(orderId);
      if (histResult?.data) {
        setTrackingEvents(histResult.data);
        updateStepFromEvents(histResult.data);
      }
    } catch (error) {
      // Silencieux - le polling continuera
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  const startPolling = useCallback(() => {
    pollingRef.current = setInterval(async () => {
      try {
        const posResult = await getDelivererPosition(orderId);
        if (posResult?.data) {
          setDelivererPosition(posResult.data);

          // Calculer l'ETA basé sur la distance restante
          if (posResult.data.speed && order?.delivery_latitude) {
            const remainingDistance = calculateDistance(
              posResult.data.latitude,
              posResult.data.longitude,
              order.delivery_latitude,
              order.delivery_longitude
            );
            const etaMinutes = Math.ceil((remainingDistance / (posResult.data.speed || 20)) * 60);
            setEta(etaMinutes);
          }
        }
      } catch {
        // Silencieux
      }
    }, POLLING_INTERVAL_MS);
  }, [orderId, order]);

  const updateStepFromEvents = (events) => {
    if (!events || events.length === 0) return;

    const lastEvent = events[events.length - 1];
    const eventToStep = {
      'order_picked_up': 2,
      'delivery_started': 3,
      'order_delivered': 4
    };

    if (eventToStep[lastEvent.event_type] !== undefined) {
      setCurrentStep(eventToStep[lastEvent.event_type]);
    }
  };

  // ============================================================================
  // RENDU
  // ============================================================================

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Chargement du suivi...</Text>
      </View>
    );
  }

  const merchantCoords = order?.merchant_latitude && order?.merchant_longitude
    ? { latitude: order.merchant_latitude, longitude: order.merchant_longitude }
    : null;

  const deliveryCoords = order?.delivery_latitude && order?.delivery_longitude
    ? { latitude: order.delivery_latitude, longitude: order.delivery_longitude }
    : null;

  const initialRegion = delivererPosition
    ? {
        latitude: delivererPosition.latitude,
        longitude: delivererPosition.longitude,
        latitudeDelta: LATITUDE_DELTA,
        longitudeDelta: LONGITUDE_DELTA
      }
    : merchantCoords
      ? {
          latitude: merchantCoords.latitude,
          longitude: merchantCoords.longitude,
          latitudeDelta: LATITUDE_DELTA * 2,
          longitudeDelta: LONGITUDE_DELTA * 2
        }
      : {
          latitude: 12.3714, // Ouagadougou par défaut
          longitude: -1.5197,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05
        };

  return (
    <View style={styles.container}>
      {/* Carte */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
      >
        {/* Marqueur livreur */}
        {delivererPosition && (
          <Marker
            coordinate={{
              latitude: delivererPosition.latitude,
              longitude: delivererPosition.longitude
            }}
            title="Votre livreur"
            description={delivererPosition.is_stale ? 'Position non récente' : 'En direct'}
            pinColor={COLORS.deliverer}
          />
        )}

        {/* Marqueur marchand */}
        {merchantCoords && (
          <Marker
            coordinate={merchantCoords}
            title="Restaurant"
            pinColor={COLORS.merchant}
          />
        )}

        {/* Marqueur destination */}
        {deliveryCoords && (
          <Marker
            coordinate={deliveryCoords}
            title="Votre adresse"
            pinColor={COLORS.client}
          />
        )}

        {/* Ligne entre les points */}
        {merchantCoords && deliveryCoords && (
          <Polyline
            coordinates={[merchantCoords, deliveryCoords]}
            strokeColor={COLORS.secondary}
            strokeWidth={2}
            lineDashPattern={[5, 5]}
          />
        )}
      </MapView>

      {/* Panel d'information */}
      <View style={styles.infoPanel}>
        {/* ETA */}
        {eta && currentStep < 4 && (
          <View style={styles.etaContainer}>
            <Text style={styles.etaLabel}>Arrivée estimée</Text>
            <Text style={styles.etaValue}>
              {eta <= 1 ? 'Imminent' : `${eta} min`}
            </Text>
          </View>
        )}

        {/* Étapes de livraison */}
        <View style={styles.stepsContainer}>
          {ORDER_STEPS.map((step, index) => (
            <View key={step.key} style={styles.stepRow}>
              <View style={[
                styles.stepDot,
                index <= currentStep && styles.stepDotActive,
                index === currentStep && styles.stepDotCurrent
              ]}>
                <Text style={styles.stepIcon}>
                  {index <= currentStep ? step.icon : '○'}
                </Text>
              </View>
              <Text style={[
                styles.stepLabel,
                index <= currentStep && styles.stepLabelActive
              ]}>
                {step.label}
              </Text>
              {index < ORDER_STEPS.length - 1 && (
                <View style={[
                  styles.stepLine,
                  index < currentStep && styles.stepLineActive
                ]} />
              )}
            </View>
          ))}
        </View>

        {/* Info livreur */}
        {delivererPosition && !delivererPosition.is_stale && (
          <View style={styles.delivererInfo}>
            <Text style={styles.delivererInfoText}>
              🛵 Livreur en mouvement
              {delivererPosition.speed ? ` • ${Math.round(delivererPosition.speed)} km/h` : ''}
            </Text>
          </View>
        )}

        {delivererPosition?.is_stale && (
          <View style={[styles.delivererInfo, styles.staleInfo]}>
            <Text style={styles.staleInfoText}>
              ⚠️ Position du livreur non mise à jour depuis {delivererPosition.age_seconds}s
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// UTILITAIRES
// ============================================================================

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.textSecondary
  },
  map: {
    flex: 1,
    minHeight: height * 0.45
  },
  infoPanel: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8
  },
  etaContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE'
  },
  etaLabel: {
    fontSize: 14,
    color: COLORS.textSecondary
  },
  etaValue: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.primary
  },
  stepsContainer: {
    marginBottom: 12
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    position: 'relative'
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E9ECEF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  stepDotActive: {
    backgroundColor: '#E8F5E9'
  },
  stepDotCurrent: {
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4
  },
  stepIcon: {
    fontSize: 12
  },
  stepLabel: {
    fontSize: 13,
    color: COLORS.textSecondary
  },
  stepLabelActive: {
    color: COLORS.text,
    fontWeight: '500'
  },
  stepLine: {
    position: 'absolute',
    left: 13,
    top: 28,
    width: 2,
    height: 8,
    backgroundColor: '#E9ECEF'
  },
  stepLineActive: {
    backgroundColor: COLORS.success
  },
  delivererInfo: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    padding: 10,
    marginTop: 8
  },
  delivererInfoText: {
    fontSize: 13,
    color: '#2E7D32',
    textAlign: 'center'
  },
  staleInfo: {
    backgroundColor: '#FFF3CD'
  },
  staleInfoText: {
    fontSize: 12,
    color: '#856404',
    textAlign: 'center'
  }
});
