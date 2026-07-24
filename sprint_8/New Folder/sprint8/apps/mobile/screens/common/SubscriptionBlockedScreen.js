// apps/mobile/screens/common/SubscriptionBlockedScreen.js - Écran de blocage (Gating)

import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, BackHandler, ActivityIndicator, Linking } from 'react-native';
import { AuthContext } from '../../contexts/AuthContext'; // Supposé exister du Sprint 2
import subscriptionService from '../../services/subscriptionService'; // À créer dans ce sprint
import dayjs from 'dayjs';
import 'dayjs/locale/fr';

dayjs.locale('fr');

const SubscriptionBlockedScreen = () => {
  const { user, signOut } = useContext(AuthContext); // Récupérer l'utilisateur et la fonction de déconnexion
  const [loading, setLoading] = useState(true);
  const [planAmount, setPlanAmount] = useState(null);
  const [planType, setPlanType] = useState(null);

  useEffect(() => {
    // Empêcher la navigation arrière physique sur Android
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => true);
    fetchSubscriptionDetails();
    return () => backHandler.remove();
  }, []);

  const fetchSubscriptionDetails = async () => {
    if (!user || !user.id) {
      setLoading(false);
      return;
    }
    try {
      const status = await subscriptionService.getSubscriptionStatus();
      if (status && status.plan_type) {
        setPlanAmount(status.amount);
        setPlanType(status.plan_type);
      }
    } catch (error) {
      console.error("Erreur lors de la récupération des détails d'abonnement:", error);
      Alert.alert("Erreur", "Impossible de récupérer les détails de votre abonnement.");
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!user || !user.id) {
      Alert.alert("Erreur", "Vous devez être connecté pour effectuer un paiement.");
      return;
    }

    setLoading(true);
    try {
      const response = await subscriptionService.initiateRenewal();
      if (response && response.payment_url) {
        Linking.openURL(response.payment_url);
      } else {
        Alert.alert("Erreur", "Impossible d'initier le paiement. Veuillez réessayer.");
      }
    } catch (error) {
      console.error("Erreur lors de l'initiation du paiement:", error);
      Alert.alert("Erreur", error.message || "Une erreur est survenue lors du paiement.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(); // Déconnecte l'utilisateur
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={styles.loadingText}>Chargement...</Text>
      </View>
    );
  }

  const amountToPay = planAmount || (planType === 'merchant_monthly' ? 6000 : 3000);
  const roleText = planType === 'merchant_monthly' ? 'marchand' : 'livreur';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accès Bloqué</Text>
      <Text style={styles.message}>
        Votre abonnement {roleText} a expiré. Veuillez le renouveler pour continuer à utiliser les services Hil_Delivre.
      </Text>
      <Text style={styles.amountText}>Montant à payer : {amountToPay} F CFA</Text>

      <TouchableOpacity style={styles.paymentButton} onPress={handlePayment} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.paymentButtonText}>Payer via Mobile Money</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FF3008', // Rouge DoorDash
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 20,
    textAlign: 'center',
  },
  message: {
    fontSize: 18,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 24,
  },
  amountText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 40,
  },
  paymentButton: {
    backgroundColor: '#191919', // Noir/Gris foncé pour le bouton
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
    width: '80%',
    alignItems: 'center',
    marginBottom: 20,
  },
  paymentButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  logoutButton: {
    marginTop: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  logoutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    textDecorationLine: 'underline',
  },
  loadingText: {
    color: '#FFFFFF',
    marginTop: 10,
    fontSize: 16,
  },
});

export default SubscriptionBlockedScreen;
