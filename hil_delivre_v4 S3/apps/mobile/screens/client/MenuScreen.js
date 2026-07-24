'use strict';

/**
 * @fileoverview Écran de menu d'un marchand — Affiche les articles groupés par catégorie.
 * Permet d'ajouter des articles au panier.
 *
 * @module screens/client/MenuScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import menuService from '../../services/menuService';
import { useCart } from '../../contexts/CartContext';

export default function MenuScreen({ route, navigation }) {
  const { merchantId, merchantName } = route.params;
  const { addItem, setMerchant, merchantId: cartMerchantId, totalItems } = useCart();

  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Charger le menu au montage
  useEffect(() => {
    async function fetchMenu() {
      setLoading(true);
      setError(null);

      const response = await menuService.getMerchantMenu(merchantId);

      if (response.success) {
        const { categories } = response.data;
        // Transformer en format SectionList
        const sectionData = Object.entries(categories).map(([title, data]) => ({
          title,
          data,
        }));
        setSections(sectionData);
      } else {
        setError(response.error?.message || 'Impossible de charger le menu.');
      }

      setLoading(false);
    }

    fetchMenu();
  }, [merchantId]);

  /**
   * Ajouter un article au panier.
   * Si le panier contient des articles d'un autre marchand, demander confirmation.
   */
  const handleAddToCart = useCallback((item) => {
    if (cartMerchantId && cartMerchantId !== merchantId) {
      Alert.alert(
        'Changer de restaurant ?',
        'Votre panier contient des articles d\'un autre restaurant. Voulez-vous le vider et ajouter cet article ?',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Vider et ajouter',
            style: 'destructive',
            onPress: () => {
              setMerchant(merchantId, merchantName);
              addItem({
                menu_item_id: item.id,
                name: item.name,
                price: item.price,
                image_url: item.image_url,
                quantity: 1,
              });
            },
          },
        ]
      );
      return;
    }

    // Définir le marchand si pas encore fait
    if (!cartMerchantId) {
      setMerchant(merchantId, merchantName);
    }

    addItem({
      menu_item_id: item.id,
      name: item.name,
      price: item.price,
      image_url: item.image_url,
      quantity: 1,
    });
  }, [cartMerchantId, merchantId, merchantName, setMerchant, addItem]);

  // Naviguer vers le panier
  const handleGoToCart = useCallback(() => {
    navigation.navigate('CartScreen');
  }, [navigation]);

  // ============================================================
  // RENDU
  // ============================================================

  const renderItem = ({ item }) => (
    <View style={styles.menuItem}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName}>{item.name}</Text>
        {item.description ? (
          <Text style={styles.itemDescription} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Text style={styles.itemPrice}>{item.price.toLocaleString('fr-FR')} FCFA</Text>
        {item.stock_quantity !== null && item.stock_quantity <= 5 && (
          <Text style={styles.stockWarning}>
            Plus que {item.stock_quantity} en stock
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => handleAddToCart(item)}
        activeOpacity={0.7}
      >
        <Text style={styles.addButtonText}>+</Text>
      </TouchableOpacity>
    </View>
  );

  const renderSectionHeader = ({ section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#FF6B00" />
        <Text style={styles.loadingText}>Chargement du menu...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setLoading(true);
            menuService.getMerchantMenu(merchantId).then((res) => {
              if (res.success) {
                const sectionData = Object.entries(res.data.categories).map(([title, data]) => ({
                  title,
                  data,
                }));
                setSections(sectionData);
                setError(null);
              }
              setLoading(false);
            });
          }}
        >
          <Text style={styles.retryButtonText}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* En-tête marchand */}
      <View style={styles.merchantHeader}>
        <Text style={styles.merchantName}>{merchantName}</Text>
      </View>

      {/* Liste des articles par catégorie */}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        ListEmptyComponent={
          <View style={styles.centerContainer}>
            <Text style={styles.emptyText}>Aucun article disponible.</Text>
          </View>
        }
      />

      {/* Bouton panier flottant */}
      {totalItems > 0 && (
        <TouchableOpacity style={styles.cartButton} onPress={handleGoToCart} activeOpacity={0.8}>
          <Text style={styles.cartButtonText}>
            Voir le panier ({totalItems} article{totalItems > 1 ? 's' : ''})
          </Text>
        </TouchableOpacity>
      )}
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  merchantHeader: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  merchantName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333333',
  },
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF6B00',
    textTransform: 'uppercase',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  itemInfo: {
    flex: 1,
    marginRight: 12,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333333',
    marginBottom: 2,
  },
  itemDescription: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FF6B00',
  },
  stockWarning: {
    fontSize: 12,
    color: '#E53935',
    marginTop: 2,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FF6B00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 22,
    color: '#FFFFFF',
    fontWeight: '700',
    lineHeight: 24,
  },
  cartButton: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#FF6B00',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 5,
  },
  cartButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },
  errorText: {
    fontSize: 16,
    color: '#E53935',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#FF6B00',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 16,
    color: '#999999',
  },
});
