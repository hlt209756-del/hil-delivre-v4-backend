'use strict';

/**
 * @fileoverview Écran d'accueil client — Liste des marchands disponibles.
 * Affiche les restaurants avec recherche et pagination infinie.
 *
 * @module screens/client/HomeScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import menuService from '../../services/menuService';

const PAGE_SIZE = 20;

export default function HomeScreen({ navigation }) {
  const [merchants, setMerchants] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [searchTimeout, setSearchTimeout] = useState(null);

  /**
   * Charger les marchands depuis l'API.
   */
  const fetchMerchants = useCallback(async (pageNum = 1, searchTerm = '', append = false) => {
    try {
      const response = await menuService.getMerchants({
        page: pageNum,
        limit: PAGE_SIZE,
        search: searchTerm || undefined,
      });

      if (response.success) {
        const { merchants: data, pagination } = response.data;
        if (append) {
          setMerchants((prev) => [...prev, ...data]);
        } else {
          setMerchants(data);
        }
        setTotalPages(pagination.total_pages);
        setPage(pageNum);
      } else {
        Alert.alert('Erreur', response.error?.message || 'Impossible de charger les marchands.');
      }
    } catch (error) {
      Alert.alert('Erreur', 'Erreur réseau. Vérifiez votre connexion.');
    }
  }, []);

  // Chargement initial
  useEffect(() => {
    async function init() {
      setLoading(true);
      await fetchMerchants(1, '');
      setLoading(false);
    }
    init();
  }, [fetchMerchants]);

  // Recherche avec debounce (300ms)
  const handleSearchChange = useCallback((text) => {
    setSearch(text);
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    const timeout = setTimeout(async () => {
      setLoading(true);
      await fetchMerchants(1, text);
      setLoading(false);
    }, 300);
    setSearchTimeout(timeout);
  }, [fetchMerchants, searchTimeout]);

  // Pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchMerchants(1, search);
    setRefreshing(false);
  }, [fetchMerchants, search]);

  // Pagination infinie
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    await fetchMerchants(page + 1, search, true);
    setLoadingMore(false);
  }, [fetchMerchants, loadingMore, page, totalPages, search]);

  // Naviguer vers le menu du marchand
  const handleMerchantPress = useCallback((merchant) => {
    navigation.navigate('MenuScreen', {
      merchantId: merchant.user_id,
      merchantName: merchant.display_name,
    });
  }, [navigation]);

  // ============================================================
  // RENDU
  // ============================================================

  const renderMerchantItem = ({ item }) => (
    <TouchableOpacity
      style={styles.merchantCard}
      onPress={() => handleMerchantPress(item)}
      activeOpacity={0.7}
    >
      <View style={styles.merchantInfo}>
        <Text style={styles.merchantName}>{item.display_name || 'Restaurant'}</Text>
        <Text style={styles.merchantAddress}>{item.address || 'Adresse non renseignée'}</Text>
        <View style={styles.ratingRow}>
          <Text style={styles.ratingText}>
            ⭐ {item.score_rating ? item.score_rating.toFixed(1) : 'N/A'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color="#FF6B00" />
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>
          {search ? 'Aucun restaurant trouvé pour cette recherche.' : 'Aucun restaurant disponible.'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Barre de recherche */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher un restaurant..."
          value={search}
          onChangeText={handleSearchChange}
          returnKeyType="search"
          autoCorrect={false}
        />
      </View>

      {/* Liste des marchands */}
      {loading && !refreshing ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#FF6B00" />
          <Text style={styles.loaderText}>Chargement des restaurants...</Text>
        </View>
      ) : (
        <FlatList
          data={merchants}
          keyExtractor={(item) => item.user_id}
          renderItem={renderMerchantItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#FF6B00']} />
          }
          contentContainerStyle={merchants.length === 0 ? styles.emptyList : undefined}
        />
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
  searchContainer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  searchInput: {
    height: 44,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  merchantCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginVertical: 6,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  merchantInfo: {
    flex: 1,
  },
  merchantName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  merchantAddress: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 14,
    color: '#FF6B00',
    fontWeight: '500',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 14,
    color: '#666666',
  },
  footerLoader: {
    paddingVertical: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 16,
    color: '#999999',
    textAlign: 'center',
  },
  emptyList: {
    flexGrow: 1,
  },
});
