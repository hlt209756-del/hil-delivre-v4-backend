/**
 * @file PaymentConfirmationScreen.js
 * @description Écran de confirmation/attente du paiement.
 * Pour Mobile Money : affiche un écran d'attente avec polling du statut.
 * Pour Cash : affiche la confirmation immédiate.
 * Redirige vers le suivi de commande après succès.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Alert
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { pollPaymentStatus, getPaymentStatus } from '../../services/paymentService';

// ============================================================================
// CONSTANTES
// ============================================================================

const PAYMENT_STATES = {
  WAITING: 'waiting',
  SUCCESS: 'success',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled'
};

const COLORS = {
  primary: '#FF6B35',
  secondary: '#004E89',
  success: '#28A745',
  error: '#DC3545',
  warning: '#FFC107',
  background: '#F8F9FA',
  card: '#FFFFFF',
  text: '#212529',
  textSecondary: '#6C757D'
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function PaymentConfirmationScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { order, paymentMethod, transaction, paymentUrl } = route.params;

  // State
  const [paymentState, setPaymentState] = useState(
    paymentMethod === 'cash' ? PAYMENT_STATES.SUCCESS : PAYMENT_STATES.WAITING
  );
  const [statusMessage, setStatusMessage] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);

  // Refs
  const abortControllerRef = useRef(null);
  const timerRef = useRef(null);

  // ============================================================================
  // EFFETS
  // ============================================================================

  // Timer pour afficher le temps écoulé
  useEffect(() => {
    if (paymentState === PAYMENT_STATES.WAITING) {
      timerRef.current = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [paymentState]);

  // Polling du statut pour Mobile Money
  useEffect(() => {
    if (paymentMethod !== 'mobile_money') return;

    abortControllerRef.current = new AbortController();

    const startPolling = async () => {
      try {
        const result = await pollPaymentStatus(
          order.id,
          (status) => {
            setStatusMessage(getStatusMessage(status));
          },
          abortControllerRef.current.signal
        );

        if (result?.transaction?.status === 'completed' || result?.isPaid) {
          setPaymentState(PAYMENT_STATES.SUCCESS);
          setStatusMessage('Paiement confirmé !');
        } else if (result?.transaction?.status === 'failed') {
          setPaymentState(PAYMENT_STATES.FAILED);
          setStatusMessage('Le paiement a échoué. Veuillez réessayer.');
        } else if (result?.transaction?.status === 'cancelled') {
          setPaymentState(PAYMENT_STATES.CANCELLED);
          setStatusMessage('Le paiement a été annulé.');
        }
      } catch (error) {
        if (error.message.includes('timed out')) {
          setPaymentState(PAYMENT_STATES.TIMEOUT);
          setStatusMessage('Le délai d\'attente est dépassé. Vérifiez votre application Mobile Money.');
        } else if (!error.message.includes('cancelled')) {
          setPaymentState(PAYMENT_STATES.FAILED);
          setStatusMessage(error.message || 'Une erreur est survenue.');
        }
      }
    };

    startPolling();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [order.id, paymentMethod]);

  // Ouvrir l'URL de paiement PayDunya dans le navigateur
  useEffect(() => {
    if (paymentUrl && paymentMethod === 'mobile_money') {
      // Petit délai pour laisser l'écran se charger
      const timeout = setTimeout(() => {
        Linking.canOpenURL(paymentUrl).then((supported) => {
          if (supported) {
            Linking.openURL(paymentUrl);
          }
        });
      }, 1000);

      return () => clearTimeout(timeout);
    }
  }, [paymentUrl, paymentMethod]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  /**
   * Navigue vers le suivi de commande.
   */
  const handleGoToTracking = useCallback(() => {
    navigation.reset({
      index: 0,
      routes: [
        { name: 'Home' },
        { name: 'OrderTracking', params: { orderId: order.id } }
      ]
    });
  }, [navigation, order.id]);

  /**
   * Retourne à l'écran de sélection de paiement pour réessayer.
   */
  const handleRetry = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  /**
   * Vérifie manuellement le statut du paiement.
   */
  const handleCheckStatus = useCallback(async () => {
    try {
      const result = await getPaymentStatus(order.id);
      if (result?.data?.isPaid) {
        setPaymentState(PAYMENT_STATES.SUCCESS);
        setStatusMessage('Paiement confirmé !');
      } else {
        Alert.alert(
          'Statut',
          'Le paiement n\'est pas encore confirmé. Veuillez patienter ou vérifier votre application Mobile Money.'
        );
      }
    } catch {
      Alert.alert('Erreur', 'Impossible de vérifier le statut. Veuillez réessayer.');
    }
  }, [order.id]);

  // ============================================================================
  // RENDU
  // ============================================================================

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Icône de statut */}
        <View style={styles.iconContainer}>
          {paymentState === PAYMENT_STATES.WAITING && (
            <ActivityIndicator size="large" color={COLORS.primary} />
          )}
          {paymentState === PAYMENT_STATES.SUCCESS && (
            <View style={[styles.statusIcon, styles.successIcon]}>
              <Text style={styles.statusIconText}>✓</Text>
            </View>
          )}
          {(paymentState === PAYMENT_STATES.FAILED || paymentState === PAYMENT_STATES.CANCELLED) && (
            <View style={[styles.statusIcon, styles.errorIcon]}>
              <Text style={styles.statusIconText}>✕</Text>
            </View>
          )}
          {paymentState === PAYMENT_STATES.TIMEOUT && (
            <View style={[styles.statusIcon, styles.warningIcon]}>
              <Text style={styles.statusIconText}>⏱</Text>
            </View>
          )}
        </View>

        {/* Titre */}
        <Text style={styles.title}>
          {getTitle(paymentState, paymentMethod)}
        </Text>

        {/* Message de statut */}
        <Text style={styles.message}>
          {statusMessage || getDefaultMessage(paymentState, paymentMethod)}
        </Text>

        {/* Temps écoulé (en attente) */}
        {paymentState === PAYMENT_STATES.WAITING && (
          <Text style={styles.timer}>
            Temps écoulé : {formatTime(elapsedTime)}
          </Text>
        )}

        {/* Montant */}
        <View style={styles.amountContainer}>
          <Text style={styles.amountLabel}>Montant</Text>
          <Text style={styles.amountValue}>
            {Math.ceil(order.total_amount).toLocaleString('fr-FR')} FCFA
          </Text>
        </View>

        {/* Boutons d'action */}
        <View style={styles.actions}>
          {paymentState === PAYMENT_STATES.SUCCESS && (
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleGoToTracking}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>Suivre ma commande</Text>
            </TouchableOpacity>
          )}

          {paymentState === PAYMENT_STATES.WAITING && (
            <>
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={handleCheckStatus}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>Vérifier le statut</Text>
              </TouchableOpacity>

              {paymentUrl && (
                <TouchableOpacity
                  style={[styles.button, styles.outlineButton]}
                  onPress={() => Linking.openURL(paymentUrl)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.outlineButtonText}>Ouvrir la page de paiement</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {(paymentState === PAYMENT_STATES.FAILED ||
            paymentState === PAYMENT_STATES.CANCELLED ||
            paymentState === PAYMENT_STATES.TIMEOUT) && (
            <>
              <TouchableOpacity
                style={[styles.button, styles.primaryButton]}
                onPress={handleRetry}
                activeOpacity={0.8}
              >
                <Text style={styles.primaryButtonText}>Réessayer</Text>
              </TouchableOpacity>

              {paymentState === PAYMENT_STATES.TIMEOUT && (
                <TouchableOpacity
                  style={[styles.button, styles.secondaryButton]}
                  onPress={handleCheckStatus}
                  activeOpacity={0.8}
                >
                  <Text style={styles.secondaryButtonText}>Vérifier manuellement</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// ============================================================================
// UTILITAIRES
// ============================================================================

function getTitle(state, method) {
  switch (state) {
    case PAYMENT_STATES.WAITING:
      return 'Paiement en cours...';
    case PAYMENT_STATES.SUCCESS:
      return method === 'cash' ? 'Commande confirmée' : 'Paiement réussi !';
    case PAYMENT_STATES.FAILED:
      return 'Paiement échoué';
    case PAYMENT_STATES.TIMEOUT:
      return 'Délai dépassé';
    case PAYMENT_STATES.CANCELLED:
      return 'Paiement annulé';
    default:
      return '';
  }
}

function getDefaultMessage(state, method) {
  switch (state) {
    case PAYMENT_STATES.WAITING:
      return 'Veuillez confirmer le paiement sur votre téléphone Mobile Money...';
    case PAYMENT_STATES.SUCCESS:
      if (method === 'cash') {
        return 'Votre commande est confirmée. Préparez le montant exact pour le livreur.';
      }
      return 'Votre paiement a été reçu. Votre commande est en cours de préparation.';
    case PAYMENT_STATES.FAILED:
      return 'Le paiement n\'a pas pu être traité. Veuillez vérifier votre solde et réessayer.';
    case PAYMENT_STATES.TIMEOUT:
      return 'Nous n\'avons pas reçu la confirmation. Vérifiez votre application Mobile Money.';
    case PAYMENT_STATES.CANCELLED:
      return 'Le paiement a été annulé. Vous pouvez réessayer ou choisir une autre méthode.';
    default:
      return '';
  }
}

function getStatusMessage(status) {
  switch (status) {
    case 'initiated':
      return 'Paiement initié...';
    case 'pending':
      return 'En attente de confirmation Mobile Money...';
    case 'completed':
      return 'Paiement confirmé !';
    case 'failed':
      return 'Le paiement a échoué.';
    case 'cancelled':
      return 'Le paiement a été annulé.';
    default:
      return '';
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center'
  },
  content: {
    padding: 24,
    alignItems: 'center'
  },
  iconContainer: {
    marginBottom: 24
  },
  statusIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center'
  },
  successIcon: {
    backgroundColor: COLORS.success
  },
  errorIcon: {
    backgroundColor: COLORS.error
  },
  warningIcon: {
    backgroundColor: COLORS.warning
  },
  statusIconText: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: '700'
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 8
  },
  message: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 16
  },
  timer: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 20
  },
  amountContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2
  },
  amountLabel: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 4
  },
  amountValue: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.primary
  },
  actions: {
    width: '100%',
    gap: 12
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%'
  },
  primaryButton: {
    backgroundColor: COLORS.primary
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600'
  },
  secondaryButton: {
    backgroundColor: COLORS.secondary
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600'
  },
  outlineButton: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: 'transparent'
  },
  outlineButtonText: {
    color: COLORS.primary,
    fontSize: 14,
    fontWeight: '600'
  }
});
