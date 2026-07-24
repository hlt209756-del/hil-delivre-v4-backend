'use strict';

/**
 * @fileoverview Écran de confirmation de commande.
 * Affiche le récapitulatif, l'adresse de livraison et permet de valider.
 *
 * @module screens/client/CheckoutScreen
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useCart } from '../../contexts/CartContext';
import { useAuth } from '../../contexts/AuthContext';
import orderService from '../../services/orderService';

export default function CheckoutScreen({ navigation }) {
  const { items, merchantId, merchantName, foodAmount, getOrderItems, clearCart } = useCart();
  const { accessToken } = useAuth();

  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * Valider et créer la commande.
   */
  const handlePlaceOrder = useCallback(async () => {
    if (!deliveryAddress.trim()) {
      Alert.alert('Adresse requise', 'Veuillez saisir votre adresse de livraison.');
      return;
    }

    if (items.length === 0) {
      Alert.alert('Panier vide', 'Votre panier est vide.');
      return;
    }

    Alert.alert(
      'Confirmer la commande',
      `Total estimé : ${foodAmount.toLocaleString('fr-FR')} FCFA\n(Frais de livraison à ajouter)`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Commander',
          onPress: async () => {
            setLoading(true);

            try {
              const orderData = {
                merchant_id: merchantId,
                items: getOrderItems(),
                delivery_address: deliveryAddress.trim(),
                client_note: clientNote.trim() || null,
              };

              const response = await orderService.createOrder(accessToken, orderData);

              if (response.success) {
                clearCart();
                Alert.alert(
                  'Commande confirmée !',
                  `Votre commande #${response.data.order.id.slice(0, 8)} a été envoyée au restaurant.`,
                  [
                    {
                      text: 'OK',
                      onPress: () => navigation.navigate('HomeScreen'),
                    },
                  ]
                );
              } else {
                Alert.alert(
                  'Erreur',
                  response.error?.message || 'Impossible de créer la commande. Veuillez réessayer.'
                );
              }
            } catch (error) {
              Alert.alert('Erreur', 'Une erreur inattendue est survenue.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }, [deliveryAddress, clientNote, items, merchantId, foodAmount, getOrderItems, accessToken, clearCart, navigation]);

  // ============================================================
  // RENDU
  // ============================================================

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Récapitulatif */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Récapitulatif</Text>
        <Text style={styles.merchantLabel}>{merchantName}</Text>
        {items.map((item) => (
          <View key={item.menu_item_id} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {item.quantity}x {item.name}
            </Text>
            <Text style={styles.itemPrice}>
              {(item.price * item.quantity).toLocaleString('fr-FR')} FCFA
            </Text>
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Sous-total nourriture</Text>
          <Text style={styles.totalValue}>{foodAmount.toLocaleString('fr-FR')} FCFA</Text>
        </View>
        <Text style={styles.noteText}>
          Les frais de livraison et de service seront calculés et affichés après validation.
        </Text>
      </View>

      {/* Adresse de livraison */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Adresse de livraison</Text>
        <TextInput
          style={styles.addressInput}
          placeholder="Ex: Quartier Koulouba, à côté de la pharmacie..."
          value={deliveryAddress}
          onChangeText={setDeliveryAddress}
          multiline
          numberOfLines={3}
          maxLength={500}
        />
      </View>

      {/* Note au restaurant */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Note (optionnel)</Text>
        <TextInput
          style={styles.noteInput}
          placeholder="Instructions spéciales, allergies..."
          value={clientNote}
          onChangeText={setClientNote}
          multiline
          numberOfLines={2}
          maxLength={500}
        />
      </View>

      {/* Bouton commander */}
      <TouchableOpacity
        style={[styles.orderButton, loading && styles.orderButtonDisabled]}
        onPress={handlePlaceOrder}
        disabled={loading}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.orderButtonText}>Passer la commande</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333333',
    marginBottom: 12,
  },
  merchantLabel: {
    fontSize: 14,
    color: '#FF6B00',
    fontWeight: '500',
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  itemName: {
    fontSize: 14,
    color: '#333333',
    flex: 1,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 12,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333333',
  },
  totalValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FF6B00',
  },
  noteText: {
    fontSize: 12,
    color: '#888888',
    fontStyle: 'italic',
    marginTop: 8,
  },
  addressInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  noteInput: {
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  orderButton: {
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  orderButtonDisabled: {
    opacity: 0.6,
  },
  orderButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
