/**
 * @file PaymentSelectionScreen.js
 * @description Écran de sélection de la méthode de paiement.
 * Affiche le récapitulatif détaillé des frais et permet de choisir
 * entre Mobile Money et Cash avant de confirmer le paiement.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { initiatePayment, getPlatformRates } from '../../services/paymentService';

// ============================================================================
// CONSTANTES
// ============================================================================

const PAYMENT_METHODS = {
  MOBILE_MONEY: 'mobile_money',
  CASH: 'cash'
};

const COLORS = {
  primary: '#FF6B35',
  secondary: '#004E89',
  success: '#28A745',
  warning: '#FFC107',
  background: '#F8F9FA',
  card: '#FFFFFF',
  text: '#212529',
  textSecondary: '#6C757D',
  border: '#DEE2E6',
  selected: '#E8F4FD'
};

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export default function PaymentSelectionScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { order } = route.params;

  // State
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [rates, setRates] = useState(null);

  // Charger les taux de la plateforme
  useEffect(() => {
    async function loadRates() {
      try {
        const result = await getPlatformRates();
        setRates(result?.data || null);
      } catch {
        // Utiliser les valeurs de la commande si les taux ne sont pas disponibles
      }
    }
    loadRates();
  }, []);

  /**
   * Gère la confirmation du paiement.
   */
  const handleConfirmPayment = useCallback(async () => {
    if (!selectedMethod) {
      Alert.alert('Erreur', 'Veuillez sélectionner une méthode de paiement.');
      return;
    }

    if (selectedMethod === PAYMENT_METHODS.MOBILE_MONEY && !phoneNumber.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer votre numéro de téléphone Mobile Money.');
      return;
    }

    // Validation basique du numéro de téléphone
    if (selectedMethod === PAYMENT_METHODS.MOBILE_MONEY) {
      const cleanPhone = phoneNumber.replace(/\s/g, '');
      if (cleanPhone.length < 8 || cleanPhone.length > 15) {
        Alert.alert('Erreur', 'Le numéro de téléphone doit contenir entre 8 et 15 chiffres.');
        return;
      }
    }

    setIsLoading(true);

    try {
      const result = await initiatePayment(
        order.id,
        selectedMethod,
        selectedMethod === PAYMENT_METHODS.MOBILE_MONEY ? phoneNumber.trim() : null
      );

      if (result?.data) {
        navigation.navigate('PaymentConfirmation', {
          order,
          paymentMethod: selectedMethod,
          transaction: result.data,
          paymentUrl: result.data.payment_url
        });
      }
    } catch (error) {
      Alert.alert(
        'Erreur de paiement',
        error.message || 'Une erreur est survenue lors de l\'initiation du paiement. Veuillez réessayer.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedMethod, phoneNumber, order, navigation]);

  // ============================================================================
  // RENDU
  // ============================================================================

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* En-tête */}
      <View style={styles.header}>
        <Text style={styles.title}>Paiement</Text>
        <Text style={styles.subtitle}>Commande #{order.id?.slice(0, 8)}</Text>
      </View>

      {/* Récapitulatif des frais */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Récapitulatif</Text>

        <View style={styles.feeRow}>
          <Text style={styles.feeLabel}>Nourriture</Text>
          <Text style={styles.feeValue}>{formatCFA(order.food_amount)}</Text>
        </View>

        <View style={styles.feeRow}>
          <Text style={styles.feeLabel}>Commission plateforme ({((rates?.merchant_commission_rate || 0.05) * 100).toFixed(0)}%)</Text>
          <Text style={styles.feeValue}>{formatCFA(order.commission_amount)}</Text>
        </View>

        <View style={styles.feeRow}>
          <Text style={styles.feeLabel}>Frais de livraison</Text>
          <Text style={styles.feeValue}>{formatCFA(order.delivery_fee || 0)}</Text>
        </View>

        {order.surge_amount > 0 && (
          <View style={styles.feeRow}>
            <Text style={styles.feeLabel}>Supplément heure de pointe</Text>
            <Text style={[styles.feeValue, styles.surgeText]}>{formatCFA(order.surge_amount)}</Text>
          </View>
        )}

        <View style={styles.feeRow}>
          <Text style={styles.feeLabel}>TVA services plateforme (18%)</Text>
          <Text style={styles.feeValue}>{formatCFA(order.platform_vat_amount)}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.feeRow}>
          <Text style={styles.totalLabel}>Total à payer</Text>
          <Text style={styles.totalValue}>{formatCFA(order.total_amount)}</Text>
        </View>
      </View>

      {/* Note de transparence TVA */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          ℹ️ La TVA de 18% s'applique uniquement sur les services de la plateforme
          (commission + frais de livraison). Le prix des plats est celui fixé par le restaurant.
        </Text>
      </View>

      {/* Sélection de la méthode de paiement */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Méthode de paiement</Text>

        {/* Mobile Money */}
        <TouchableOpacity
          style={[
            styles.methodCard,
            selectedMethod === PAYMENT_METHODS.MOBILE_MONEY && styles.methodCardSelected
          ]}
          onPress={() => setSelectedMethod(PAYMENT_METHODS.MOBILE_MONEY)}
          activeOpacity={0.7}
        >
          <View style={styles.methodHeader}>
            <View style={[
              styles.radio,
              selectedMethod === PAYMENT_METHODS.MOBILE_MONEY && styles.radioSelected
            ]} />
            <View style={styles.methodInfo}>
              <Text style={styles.methodTitle}>Mobile Money</Text>
              <Text style={styles.methodDescription}>
                Orange Money, Moov Money, Coris Money
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Champ numéro de téléphone (visible si Mobile Money sélectionné) */}
        {selectedMethod === PAYMENT_METHODS.MOBILE_MONEY && (
          <View style={styles.phoneInputContainer}>
            <Text style={styles.inputLabel}>Numéro Mobile Money</Text>
            <TextInput
              style={styles.phoneInput}
              placeholder="+226 70 00 00 00"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="phone-pad"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              maxLength={15}
              autoFocus
            />
          </View>
        )}

        {/* Cash */}
        <TouchableOpacity
          style={[
            styles.methodCard,
            selectedMethod === PAYMENT_METHODS.CASH && styles.methodCardSelected
          ]}
          onPress={() => setSelectedMethod(PAYMENT_METHODS.CASH)}
          activeOpacity={0.7}
        >
          <View style={styles.methodHeader}>
            <View style={[
              styles.radio,
              selectedMethod === PAYMENT_METHODS.CASH && styles.radioSelected
            ]} />
            <View style={styles.methodInfo}>
              <Text style={styles.methodTitle}>Espèces</Text>
              <Text style={styles.methodDescription}>
                Payer en espèces à la livraison
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Avertissement cash */}
        {selectedMethod === PAYMENT_METHODS.CASH && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              ⚠️ Préparez le montant exact de {formatCFA(order.total_amount)} pour le livreur.
              Des frais de réconciliation de 5% s'appliquent au livreur pour les paiements en espèces.
            </Text>
          </View>
        )}
      </View>

      {/* Bouton de confirmation */}
      <TouchableOpacity
        style={[
          styles.confirmButton,
          (!selectedMethod || isLoading) && styles.confirmButtonDisabled
        ]}
        onPress={handleConfirmPayment}
        disabled={!selectedMethod || isLoading}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.confirmButtonText}>
            Confirmer le paiement — {formatCFA(order.total_amount)}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ============================================================================
// UTILITAIRES
// ============================================================================

/**
 * Formate un montant en FCFA.
 * @param {number} amount - Montant
 * @returns {string} Montant formaté
 */
function formatCFA(amount) {
  if (amount === null || amount === undefined) return '0 FCFA';
  return `${Math.ceil(amount).toLocaleString('fr-FR')} FCFA`;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  content: {
    padding: 16,
    paddingBottom: 32
  },
  header: {
    marginBottom: 20
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8
  },
  feeLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    flex: 1
  },
  feeValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text
  },
  surgeText: {
    color: COLORS.warning
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 8
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary
  },
  infoBox: {
    backgroundColor: '#E8F4FD',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16
  },
  infoText: {
    fontSize: 12,
    color: COLORS.secondary,
    lineHeight: 18
  },
  methodCard: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10
  },
  methodCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.selected
  },
  methodHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginRight: 12
  },
  radioSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary
  },
  methodInfo: {
    flex: 1
  },
  methodTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text
  },
  methodDescription: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2
  },
  phoneInputContainer: {
    marginBottom: 10,
    paddingHorizontal: 4
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 6
  },
  phoneInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    backgroundColor: COLORS.background
  },
  warningBox: {
    backgroundColor: '#FFF3CD',
    borderRadius: 8,
    padding: 10,
    marginTop: 4
  },
  warningText: {
    fontSize: 12,
    color: '#856404',
    lineHeight: 18
  },
  confirmButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8
  },
  confirmButtonDisabled: {
    backgroundColor: '#CCC',
    opacity: 0.7
  },
  confirmButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  }
});
