/**
 * ============================================================
 * Hil_Delivre v4 — Point d'entrée de l'application mobile
 * Sprint 1 : Infrastructure
 * ============================================================
 * Écran de chargement initial (splash screen) — aucun écran
 * fonctionnel au Sprint 1.
 * ============================================================
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, StatusBar } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simuler le chargement initial (configuration, connexion Supabase)
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ExpoStatusBar style="light" />
      <StatusBar barStyle="light-content" />

      <View style={styles.splashContent}>
        <Text style={styles.appName}>Hil_Delivre</Text>
        <Text style={styles.version}>v4.0.0</Text>
        {isLoading && <ActivityIndicator size="large" color="#FF6B00" style={styles.loader} />}
      </View>

      <Text style={styles.footer}>© 2024 Hil_Delivre Team</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  appName: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FF6B00',
    marginBottom: 8,
  },
  version: {
    fontSize: 16,
    color: '#888',
    marginBottom: 40,
  },
  loader: {
    marginTop: 16,
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    fontSize: 12,
    color: '#555',
  },
});
