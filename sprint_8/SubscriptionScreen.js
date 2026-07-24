// apps/mobile/screens/common/SubscriptionScreen.js - Écran de gestion de l'abonnement

import React, { useEffect, useState, useContext } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../../contexts/AuthContext'; // Supposé exister du Sprint 2
import subscriptionService from '../../services/subscriptionService'; // À créer dans ce sprint
import dayjs from 'dayjs';
import 'dayjs/locale/fr'; // Pour la localisation des dates

dayjs.locale('fr');

const SubscriptionScreen = () => {
  const { user } = useContext(AuthContext); // Récupérer l'utilisateur authentifié
  const navigation = useNavigation();
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [subscriptionHistory, setSubscriptionHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user && user.id) {
      fetchSubscriptionData();
    }
  }, [user]);

  const fetchSubscriptionData = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await subscriptionService.getSubscriptionStatus();
      setSubscriptionStatus(status);

      const history = await subscriptionService.getSubscriptionHistory();
      setSubscriptionHistory(history);
    } catch (err) {
      console.error("Erreur lors de la récupération des données d'abonnement:", err);
      setError("Impossible de charger les informations d'abonnement.");
    } finally {
      setLoading(false);
    }
  };

  const handleRenewSubscription = async () => {
    if (!user || !user.id) {
      Alert.alert("Erreur", "Vous devez être connecté pour renouveler votre abonnement.");
      return;
    }

    try {
      const response = await subscriptionService.initiateRenewal();
      if (response && response.payment_url) {
        // Rediriger l'utilisateur vers l'URL de paiement PayDunya
        Linking.openURL(response.payment_url);
      } else {
        Alert.alert("Erreur", "Impossible d'initier le paiement. Veuillez réessayer.");
      }
    } catch (err) {
      console.error("Erreur lors de l'initiation du renouvellement:", err);
      Alert.alert("Erreur", err.message || "Une erreur est survenue lors du renouvellement.");
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#FF3008" />
        <Text style={styles.loadingText}>Chargement de votre abonnement...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchSubscriptionData}>
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isExpired = subscriptionStatus?.expires_at && dayjs(subscriptionStatus.expires_at).isBefore(dayjs());
  const statusColor = isExpired ? '#FF3008' : '#4CAF50'; // Rouge pour expiré, vert pour actif

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Mon Abonnement</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Statut Actuel</Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Statut :</Text>
          <Text style={[styles.statusValue, { color: statusColor }]}>
            {subscriptionStatus?.is_trial ? 'Période d\'essai' : subscriptionStatus?.status === 'active' ? 'Actif' : 'Expiré'}
          </Text>
        </View>
        {subscriptionStatus?.plan_name && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Plan :</Text>
            <Text style={styles.statusValue}>{subscriptionStatus.plan_name}</Text>
          </View>
        )}
        {subscriptionStatus?.expires_at && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Expire le :</Text>
            <Text style={styles.statusValue}>{dayjs(subscriptionStatus.expires_at).format('DD MMMM YYYY à HH:mm')}</Text>
          </View>
        )}
        {subscriptionStatus?.is_trial && subscriptionStatus?.trial_ends_at && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Fin de l'essai :</Text>
            <Text style={styles.statusValue}>{dayjs(subscriptionStatus.trial_ends_at).format('DD MMMM YYYY à HH:mm')}</Text>
          </View>
        )}
        {isExpired && (
          <Text style={styles.expiredMessage}>
            Votre abonnement a expiré. Veuillez le renouveler pour continuer à utiliser nos services.
          </Text>
        )}
        <TouchableOpacity style={styles.renewButton} onPress={handleRenewSubscription}>
          <Text style={styles.renewButtonText}>Renouveler mon abonnement</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.header}>Historique des Abonnements</Text>
      <View style={styles.historyContainer}>
        {subscriptionHistory.length > 0 ? (
          subscriptionHistory.map((sub, index) => (
            <View key={sub.id || index} style={styles.historyItem}>
              <Text style={styles.historyText}>Plan: {sub.plan_name}</Text>
              <Text style={styles.historyText}>Montant: {sub.amount} F CFA</Text>
              <Text style={styles.historyText}>Statut: {sub.status === 'active' ? 'Actif' : 'Expiré'}</Text>
              <Text style={styles.historyText}>Début: {dayjs(sub.started_at).format('DD/MM/YYYY')}</Text>
              <Text style={styles.historyText}>Fin: {dayjs(sub.expires_at).format('DD/MM/YYYY')}</Text>
              {sub.is_trial && <Text style={styles.historyText}>Période d'essai</Text>}
            </View>
          ))
        ) : (
          <Text style={styles.noHistoryText}>Aucun historique d'abonnement trouvé.</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 20,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#191919',
  },
  errorText: {
    fontSize: 16,
    color: '#FF3008',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#191919',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#191919',
    marginBottom: 20,
    marginTop: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 20,
    marginBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#191919',
    marginBottom: 15,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  statusLabel: {
    fontSize: 16,
    color: '#555',
  },
  statusValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#191919',
  },
  expiredMessage: {
    fontSize: 15,
    color: '#FF3008',
    textAlign: 'center',
    marginTop: 15,
    marginBottom: 15,
    fontWeight: 'bold',
  },
  renewButton: {
    backgroundColor: '#FF3008',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  renewButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  historyContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  historyItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
    paddingVertical: 10,
    marginBottom: 10,
  },
  historyText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 3,
  },
  noHistoryText: {
    fontSize: 16,
    color: '#777',
    textAlign: 'center',
    paddingVertical: 20,
  },
});

export default SubscriptionScreen;
