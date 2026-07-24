'use strict';

/**
 * @fileoverview Écran du panier — Affiche les articles sélectionnés,
 * permet de modifier les quantités et de passer à la confirmation.
 *
 * @module screens/client/CartScreen
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useCart } from '../../contexts/CartContext';

export default function CartScreen({ navigation }) {
  const {
    items,
    merchantName,
    foodAmount,
    totalItems,
    isEmpty,
    updateQuantity,
    removeItem,
    clearCart,
  } = useCart();

  // Modifier la quantité
  const handleIncrement = useCallback((menuItemId, currentQty) => {
    if (currentQty >= 99) return;
    updateQuantity(menuItemId, currentQty + 1);
  }, [updateQuantity]);

  const handleDecrement = useCallback((menuItemId, currentQty) => {
    if (currentQty <= 1) {
      Alert.alert(
        'Supprimer l\'article ?',
        'Voulez-vous retirer cet article du panier ?',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Supprimer', style: 'destructive', onPress: () => removeItem(menuItemId) },
        ]
      );
      return;
    }
    updateQuantity(menuItemId, currentQty - 1);
  }, [updateQuantity, removeItem]);

  // Vider le panier
  const handleClearCart = useCallback(() => {
    Alert.alert(
      'Vider le panier ?',
      'Tous les articles seront supprimés.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Vider', style: 'destructive', onPress: clearCart },
      ]
    );
  }, [clearCart]);

  // Passer à la confirmation
  const handleCheckout = useCallback(() => {
    navigation.navigate('CheckoutScreen');
  }, [navigation]);

  // ============================================================
  // RENDU
  // ============================================================

  const renderCartItem = ({ item }) => (
    <View style={styles.cartItem}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        <Text style={styles.itemPrice}>
          {item.price.toLocaleString('fr-FR')} FCFA
        </Text>
      </View>
      <View style={styles.quantityControls}>
        <TouchableOpacity
          style={styles.qtyButton}
          onPress={() => handleDecrement(item.menu_item_id, item.quantity)}
        >
          <Text style={styles.qtyButtonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.qtyText}>{item.quantity}</Text>
        <TouchableOpacity
          style={styles.qtyButton}
          onPress={() => handleIncrement(item.menu_item_id, item.quantity)}
        >
          <Text style={styles.qtyButtonText}>+</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.itemTotal}>
        {(item.price * item.quantity).toLocaleString('fr-FR')} FCFA
      </Text>
    </View>
  );

  if (isEmpty) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>Votre panier est vide</Text>
        <Text style={styles.emptySubtitle}>
          Parcourez les restaurants pour ajouter des articles.
        </Text>
        <TouchableOpacity
          style={styles.browseButton}
          onPress={() => navigation.navigate('HomeScreen')}
        >
          <Text style={styles.browseButtonText}>Parcourir les restaurants</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* En-tête */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mon panier</Text>
        <Text style={styles.headerSubtitle}>{merchantName}</Text>
        <TouchableOpacity onPress={handleClearCart}>
          <Text style={styles.clearText}>Vider</Text>
        </TouchableOpacity>
      </View>

      {/* Liste des articles */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.menu_item_id}
        renderItem={renderCartItem}
        contentContainerStyle={styles.listContent}
      />

      {/* Résumé et bouton commander */}
      <View style={styles.footer}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Sous-total ({totalItems} article{totalItems > 1 ? 's' : ''})</Text>
          <Text style={styles.summaryValue}>{foodAmount.toLocaleString('fr-FR')} FCFA</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryNote}>Frais de livraison calculés à l'étape suivante</Text>
        </View>
        <TouchableOpacity style={styles.checkoutButton} onPress={handleCheckout} activeOpacity={0.8}>
          <Text style={styles.checkoutButtonText}>Confirmer la commande</Text>
        </TouchableOpacity>
      </View>
    </View>
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F5F5F5',
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 24,
  },
  browseButton: {
    backgroundColor: '#FF6B00',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  header: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333333',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666666',
    flex: 1,
    marginLeft: 8,
  },
  clearText: {
    fontSize: 14,
    color: '#E53935',
    fontWeight: '500',
  },
  listContent: {
    paddingVertical: 8,
  },
  cartItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 8,
    padding: 12,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333333',
    marginBottom: 2,
  },
  itemPrice: {
    fontSize: 13,
    color: '#888888',
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  qtyButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333333',
  },
  qtyText: {
    fontSize: 16,
    fontWeight: '600',
    marginHorizontal: 12,
    minWidth: 20,
    textAlign: 'center',
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF6B00',
    minWidth: 80,
    textAlign: 'right',
  },
  footer: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 15,
    color: '#333333',
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333333',
  },
  summaryNote: {
    fontSize: 12,
    color: '#888888',
    fontStyle: 'italic',
  },
  checkoutButton: {
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  checkoutButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
