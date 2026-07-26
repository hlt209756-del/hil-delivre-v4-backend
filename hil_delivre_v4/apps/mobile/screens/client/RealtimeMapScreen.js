'use strict';

/**
 * @fileoverview Écran de carte temps réel optimisé pour Hil_Delivre v4.
 * Affiche les livreurs en temps réel avec clustering, viewport filtering,
 * animations fluides et delta updates via Socket.IO.
 * @module screens/client/RealtimeMapScreen
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Dimensions,
  Alert,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { useSocket } from '../../contexts/SocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ASPECT_RATIO = SCREEN_WIDTH / SCREEN_HEIGHT;

/** Région initiale centrée sur Ouagadougou */
const INITIAL_REGION = {
  latitude: 12.3714,
  longitude: -1.5197,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0922 * ASPECT_RATIO,
};

/** Intervalle minimum entre les envois de viewport (ms) */
const VIEWPORT_THROTTLE_MS = 1000;

/** Intervalle de rafraîchissement de la position utilisateur (ms) */
const LOCATION_UPDATE_INTERVAL_MS = 5000;

/** Seuil de déplacement minimum pour considérer un mouvement (mètres) */
const MIN_MOVEMENT_THRESHOLD_M = 10;

/** Couleurs des marqueurs par statut */
const MARKER_COLORS = {
  available: '#4CAF50',
  busy: '#FF9800',
  returning: '#2196F3',
  offline: '#9E9E9E',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcule la distance Haversine entre deux points GPS (en mètres).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance en mètres.
 */
const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Regroupe les livreurs en clusters basés sur une grille.
 * @param {Array} deliverers - Liste des livreurs avec lat/lng.
 * @param {number} cellSizeKm - Taille de la cellule de grille en km.
 * @param {number} zoomLevel - Niveau de zoom actuel.
 * @returns {Array} Clusters ou livreurs individuels.
 */
const clusterDeliverers = (deliverers, cellSizeKm = 0.5, zoomLevel = 14) => {
  // Pas de clustering si zoom élevé (> 15) ou peu de livreurs
  if (zoomLevel > 15 || deliverers.length <= 5) {
    return deliverers.map((d) => ({ ...d, isCluster: false, count: 1 }));
  }

  const cellSize = cellSizeKm / 111; // Approximation degrés
  const grid = new Map();

  deliverers.forEach((deliverer) => {
    const cellX = Math.floor(deliverer.latitude / cellSize);
    const cellY = Math.floor(deliverer.longitude / cellSize);
    const key = `${cellX}:${cellY}`;

    if (!grid.has(key)) {
      grid.set(key, {
        isCluster: true,
        count: 0,
        latitude: 0,
        longitude: 0,
        deliverers: [],
      });
    }

    const cluster = grid.get(key);
    cluster.count++;
    cluster.latitude += deliverer.latitude;
    cluster.longitude += deliverer.longitude;
    cluster.deliverers.push(deliverer);
  });

  return Array.from(grid.values()).map((cluster) => {
    if (cluster.count === 1) {
      return { ...cluster.deliverers[0], isCluster: false, count: 1 };
    }
    return {
      ...cluster,
      latitude: cluster.latitude / cluster.count,
      longitude: cluster.longitude / cluster.count,
      id: `cluster_${cluster.latitude.toFixed(4)}_${cluster.longitude.toFixed(4)}`,
    };
  });
};

/**
 * Estime le niveau de zoom à partir du latitudeDelta.
 * @param {number} latitudeDelta
 * @returns {number} Niveau de zoom approximatif (1-20).
 */
const getZoomLevel = (latitudeDelta) => {
  return Math.round(Math.log(360 / latitudeDelta) / Math.LN2);
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Écran de carte temps réel affichant les livreurs disponibles.
 * Optimisé avec clustering, viewport filtering et delta updates.
 */
const RealtimeMapScreen = ({ navigation, route }) => {
  // ─── State ───────────────────────────────────────────────────────────────
  const [region, setRegion] = useState(INITIAL_REGION);
  const [deliverers, setDeliverers] = useState(new Map());
  const [userLocation, setUserLocation] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [error, setError] = useState(null);

  // ─── Refs ────────────────────────────────────────────────────────────────
  const mapRef = useRef(null);
  const socketRef = useRef(null);
  const lastViewportEmit = useRef(0);
  const lastUserLocation = useRef(null);
  const locationSubscription = useRef(null);
  const viewportTimeoutRef = useRef(null);

  // ─── Context ─────────────────────────────────────────────────────────────
  const { socket, isConnected } = useSocket();
  const { user } = useAuth();

  // ─── Derived State ───────────────────────────────────────────────────────
  const zoomLevel = useMemo(() => getZoomLevel(region.latitudeDelta), [region.latitudeDelta]);

  const clusteredDeliverers = useMemo(() => {
    const delivererList = Array.from(deliverers.values());
    return clusterDeliverers(delivererList, 0.5, zoomLevel);
  }, [deliverers, zoomLevel]);

  const onlineCount = useMemo(() => {
    return Array.from(deliverers.values()).filter((d) => d.status === 'available').length;
  }, [deliverers]);

  // ─── Location Permission & Tracking ──────────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    const initLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (isMounted) {
            setError('Permission de localisation refusée.');
            setIsLoading(false);
          }
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (isMounted) {
          const newLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setUserLocation(newLocation);
          setRegion((prev) => ({
            ...prev,
            latitude: newLocation.latitude,
            longitude: newLocation.longitude,
          }));
          lastUserLocation.current = newLocation;
          setIsLoading(false);
        }

        // Suivi continu de la position
        locationSubscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: LOCATION_UPDATE_INTERVAL_MS,
            distanceInterval: MIN_MOVEMENT_THRESHOLD_M,
          },
          (loc) => {
            if (!isMounted) return;
            const newLoc = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };

            // Ne mettre à jour que si déplacement significatif
            if (lastUserLocation.current) {
              const dist = haversineDistance(
                lastUserLocation.current.latitude,
                lastUserLocation.current.longitude,
                newLoc.latitude,
                newLoc.longitude
              );
              if (dist < MIN_MOVEMENT_THRESHOLD_M) return;
            }

            setUserLocation(newLoc);
            lastUserLocation.current = newLoc;
          }
        );
      } catch (err) {
        console.error('[RealtimeMapScreen] Location error:', err.message);
        if (isMounted) {
          setError('Erreur de localisation. Vérifiez vos paramètres GPS.');
          setIsLoading(false);
        }
      }
    };

    initLocation();

    return () => {
      isMounted = false;
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  // ─── Socket.IO Connection & Events ───────────────────────────────────────

  useEffect(() => {
    if (!socket || !isConnected) {
      setConnectionStatus('disconnected');
      return;
    }

    socketRef.current = socket;
    setConnectionStatus('connected');

    // Écouter les mises à jour de position des livreurs (delta updates)
    socket.on('deliverer:position_update', (data) => {
      setDeliverers((prev) => {
        const updated = new Map(prev);
        if (data.is_online === false) {
          updated.delete(data.deliverer_id);
        } else {
          updated.set(data.deliverer_id, {
            id: data.deliverer_id,
            latitude: data.latitude,
            longitude: data.longitude,
            heading: data.heading || 0,
            speed: data.speed || 0,
            status: data.status || 'available',
            name: data.display_name || 'Livreur',
            updated_at: Date.now(),
          });
        }
        return updated;
      });
    });

    // Écouter les mises à jour groupées (initial load)
    socket.on('deliverers:batch_update', (data) => {
      setDeliverers((prev) => {
        const updated = new Map(prev);
        data.deliverers.forEach((d) => {
          updated.set(d.deliverer_id, {
            id: d.deliverer_id,
            latitude: d.latitude,
            longitude: d.longitude,
            heading: d.heading || 0,
            speed: d.speed || 0,
            status: d.status || 'available',
            name: d.display_name || 'Livreur',
            updated_at: Date.now(),
          });
        });
        return updated;
      });
    });

    // Écouter les déconnexions de livreurs
    socket.on('deliverer:offline', (data) => {
      setDeliverers((prev) => {
        const updated = new Map(prev);
        updated.delete(data.deliverer_id);
        return updated;
      });
    });

    // Envoyer le viewport initial
    emitViewport(region);

    return () => {
      socket.off('deliverer:position_update');
      socket.off('deliverers:batch_update');
      socket.off('deliverer:offline');
      socket.emit('map:leave_viewport');
    };
  }, [socket, isConnected]);

  // ─── Viewport Management ─────────────────────────────────────────────────

  /**
   * Envoie le viewport actuel au serveur (throttled).
   * @param {Object} newRegion - La nouvelle région de la carte.
   */
  const emitViewport = useCallback(
    (newRegion) => {
      const now = Date.now();
      if (now - lastViewportEmit.current < VIEWPORT_THROTTLE_MS) {
        // Planifier un envoi différé
        if (viewportTimeoutRef.current) {
          clearTimeout(viewportTimeoutRef.current);
        }
        viewportTimeoutRef.current = setTimeout(() => {
          emitViewport(newRegion);
        }, VIEWPORT_THROTTLE_MS);
        return;
      }

      if (socketRef.current && isConnected) {
        const bounds = {
          north: newRegion.latitude + newRegion.latitudeDelta / 2,
          south: newRegion.latitude - newRegion.latitudeDelta / 2,
          east: newRegion.longitude + newRegion.longitudeDelta / 2,
          west: newRegion.longitude - newRegion.longitudeDelta / 2,
        };

        socketRef.current.emit('map:set_viewport', bounds);
        lastViewportEmit.current = now;
      }
    },
    [isConnected]
  );

  /**
   * Callback appelé quand la région de la carte change.
   */
  const onRegionChangeComplete = useCallback(
    (newRegion) => {
      setRegion(newRegion);
      emitViewport(newRegion);
    },
    [emitViewport]
  );

  // ─── Actions ─────────────────────────────────────────────────────────────

  /**
   * Centre la carte sur la position de l'utilisateur.
   */
  const centerOnUser = useCallback(() => {
    if (userLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          ...region,
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
        },
        500
      );
    }
  }, [userLocation, region]);

  /**
   * Rafraîchit les données de la carte.
   */
  const refresh = useCallback(() => {
    setDeliverers(new Map());
    if (socketRef.current && isConnected) {
      emitViewport(region);
    }
  }, [region, isConnected, emitViewport]);

  // ─── Cleanup des livreurs offline ────────────────────────────────────────

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const OFFLINE_THRESHOLD = 2 * 60 * 1000; // 2 minutes

      setDeliverers((prev) => {
        const updated = new Map(prev);
        let changed = false;
        for (const [id, deliverer] of updated) {
          if (now - deliverer.updated_at > OFFLINE_THRESHOLD) {
            updated.delete(id);
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    }, 30000); // Check toutes les 30 secondes

    return () => clearInterval(interval);
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#E53935" />
        <Text style={styles.loadingText}>Chargement de la carte...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={48} color="#E53935" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => setError(null)}>
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Carte */}
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        onRegionChangeComplete={onRegionChangeComplete}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        rotateEnabled={false}
        mapType="standard"
      >
        {/* Marqueurs des livreurs / clusters */}
        {clusteredDeliverers.map((item) => {
          if (item.isCluster) {
            return (
              <Marker
                key={item.id}
                coordinate={{ latitude: item.latitude, longitude: item.longitude }}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.clusterMarker}>
                  <Text style={styles.clusterText}>{item.count}</Text>
                </View>
              </Marker>
            );
          }

          return (
            <Marker
              key={item.id}
              coordinate={{ latitude: item.latitude, longitude: item.longitude }}
              rotation={item.heading || 0}
              anchor={{ x: 0.5, y: 0.5 }}
              title={item.name}
              description={item.status === 'available' ? 'Disponible' : 'En course'}
            >
              <View
                style={[
                  styles.delivererMarker,
                  { backgroundColor: MARKER_COLORS[item.status] || MARKER_COLORS.available },
                ]}
              >
                <Ionicons name="bicycle" size={16} color="#FFFFFF" />
              </View>
            </Marker>
          );
        })}
      </MapView>

      {/* Overlay : Statut de connexion */}
      <View style={styles.statusBar}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: connectionStatus === 'connected' ? '#4CAF50' : '#F44336' },
          ]}
        />
        <Text style={styles.statusText}>
          {connectionStatus === 'connected'
            ? `${onlineCount} livreur${onlineCount > 1 ? 's' : ''} en ligne`
            : 'Connexion...'}
        </Text>
      </View>

      {/* Bouton centrer sur l'utilisateur */}
      <TouchableOpacity style={styles.centerButton} onPress={centerOnUser}>
        <Ionicons name="locate" size={24} color="#333" />
      </TouchableOpacity>

      {/* Bouton rafraîchir */}
      <TouchableOpacity style={styles.refreshButton} onPress={refresh}>
        <Ionicons name="refresh" size={20} color="#333" />
      </TouchableOpacity>

      {/* Légende */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.available }]} />
          <Text style={styles.legendText}>Disponible</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS.busy }]} />
          <Text style={styles.legendText}>En course</Text>
        </View>
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  map: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'Roboto',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#333',
    textAlign: 'center',
    lineHeight: 24,
  },
  retryButton: {
    marginTop: 24,
    backgroundColor: '#E53935',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  statusBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  centerButton: {
    position: 'absolute',
    bottom: 120,
    right: 16,
    backgroundColor: '#FFFFFF',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  refreshButton: {
    position: 'absolute',
    bottom: 180,
    right: 16,
    backgroundColor: '#FFFFFF',
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  legend: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
    color: '#666',
  },
  clusterMarker: {
    backgroundColor: '#E53935',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  clusterText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  delivererMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
});

export default RealtimeMapScreen;
