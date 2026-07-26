'use strict';

/**
 * @fileoverview Context React pour la gestion du panier côté mobile.
 * Le panier est géré localement (pas de table panier en BDD).
 * Il est persisté dans AsyncStorage pour survivre aux redémarrages.
 *
 * @module contexts/CartContext
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CartContext = createContext(null);

const STORAGE_KEY = '@hil_delivre_cart';

// ============================================================
// ACTIONS
// ============================================================

const ACTIONS = {
  SET_CART: 'SET_CART',
  ADD_ITEM: 'ADD_ITEM',
  REMOVE_ITEM: 'REMOVE_ITEM',
  UPDATE_QUANTITY: 'UPDATE_QUANTITY',
  CLEAR_CART: 'CLEAR_CART',
  SET_MERCHANT: 'SET_MERCHANT',
};

// ============================================================
// REDUCER
// ============================================================

const initialState = {
  merchant_id: null,
  merchant_name: null,
  items: [],
  // Calculés
  total_items: 0,
  food_amount: 0,
};

function cartReducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_CART:
      return { ...action.payload };

    case ACTIONS.SET_MERCHANT:
      // Si on change de marchand, vider le panier
      if (state.merchant_id && state.merchant_id !== action.payload.merchant_id) {
        return {
          merchant_id: action.payload.merchant_id,
          merchant_name: action.payload.merchant_name,
          items: [],
          total_items: 0,
          food_amount: 0,
        };
      }
      return {
        ...state,
        merchant_id: action.payload.merchant_id,
        merchant_name: action.payload.merchant_name,
      };

    case ACTIONS.ADD_ITEM: {
      const existingIndex = state.items.findIndex(
        (item) => item.menu_item_id === action.payload.menu_item_id
      );

      let newItems;
      if (existingIndex >= 0) {
        // Incrémenter la quantité
        newItems = [...state.items];
        newItems[existingIndex] = {
          ...newItems[existingIndex],
          quantity: newItems[existingIndex].quantity + (action.payload.quantity || 1),
        };
      } else {
        // Ajouter un nouvel article
        newItems = [...state.items, {
          menu_item_id: action.payload.menu_item_id,
          name: action.payload.name,
          price: action.payload.price,
          quantity: action.payload.quantity || 1,
          image_url: action.payload.image_url || null,
        }];
      }

      const totalItems = newItems.reduce((sum, item) => sum + item.quantity, 0);
      const foodAmount = newItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      return { ...state, items: newItems, total_items: totalItems, food_amount: foodAmount };
    }

    case ACTIONS.REMOVE_ITEM: {
      const newItems = state.items.filter(
        (item) => item.menu_item_id !== action.payload.menu_item_id
      );
      const totalItems = newItems.reduce((sum, item) => sum + item.quantity, 0);
      const foodAmount = newItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      return { ...state, items: newItems, total_items: totalItems, food_amount: foodAmount };
    }

    case ACTIONS.UPDATE_QUANTITY: {
      const { menu_item_id, quantity } = action.payload;

      if (quantity <= 0) {
        // Supprimer l'article si quantité <= 0
        const newItems = state.items.filter((item) => item.menu_item_id !== menu_item_id);
        const totalItems = newItems.reduce((sum, item) => sum + item.quantity, 0);
        const foodAmount = newItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        return { ...state, items: newItems, total_items: totalItems, food_amount: foodAmount };
      }

      if (quantity > 99) {
        return state; // Limite max
      }

      const newItems = state.items.map((item) =>
        item.menu_item_id === menu_item_id ? { ...item, quantity } : item
      );
      const totalItems = newItems.reduce((sum, item) => sum + item.quantity, 0);
      const foodAmount = newItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

      return { ...state, items: newItems, total_items: totalItems, food_amount: foodAmount };
    }

    case ACTIONS.CLEAR_CART:
      return { ...initialState };

    default:
      return state;
  }
}

// ============================================================
// PROVIDER
// ============================================================

export function CartProvider({ children }) {
  const [state, dispatch] = useReducer(cartReducer, initialState);

  // Charger le panier depuis AsyncStorage au démarrage
  useEffect(() => {
    async function loadCart() {
      try {
        const storedCart = await AsyncStorage.getItem(STORAGE_KEY);
        if (storedCart) {
          const parsed = JSON.parse(storedCart);
          dispatch({ type: ACTIONS.SET_CART, payload: parsed });
        }
      } catch (error) {
        console.error('[CartContext] Erreur chargement panier:', error.message);
      }
    }
    loadCart();
  }, []);

  // Persister le panier à chaque modification
  useEffect(() => {
    async function saveCart() {
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (error) {
        console.error('[CartContext] Erreur sauvegarde panier:', error.message);
      }
    }
    saveCart();
  }, [state]);

  // ============================================================
  // ACTIONS EXPOSÉES
  // ============================================================

  const setMerchant = useCallback((merchantId, merchantName) => {
    dispatch({
      type: ACTIONS.SET_MERCHANT,
      payload: { merchant_id: merchantId, merchant_name: merchantName },
    });
  }, []);

  const addItem = useCallback((item) => {
    if (!item || !item.menu_item_id || !item.name || !item.price) {
      console.warn('[CartContext] addItem: données invalides');
      return;
    }
    dispatch({ type: ACTIONS.ADD_ITEM, payload: item });
  }, []);

  const removeItem = useCallback((menuItemId) => {
    dispatch({ type: ACTIONS.REMOVE_ITEM, payload: { menu_item_id: menuItemId } });
  }, []);

  const updateQuantity = useCallback((menuItemId, quantity) => {
    dispatch({
      type: ACTIONS.UPDATE_QUANTITY,
      payload: { menu_item_id: menuItemId, quantity },
    });
  }, []);

  const clearCart = useCallback(() => {
    dispatch({ type: ACTIONS.CLEAR_CART });
  }, []);

  /**
   * Préparer les données pour l'API de création de commande.
   * @returns {Array<{menu_item_id: string, quantity: number}>}
   */
  const getOrderItems = useCallback(() => {
    return state.items.map((item) => ({
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
    }));
  }, [state.items]);

  const value = {
    // État
    cart: state,
    merchantId: state.merchant_id,
    merchantName: state.merchant_name,
    items: state.items,
    totalItems: state.total_items,
    foodAmount: state.food_amount,
    isEmpty: state.items.length === 0,
    // Actions
    setMerchant,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    getOrderItems,
  };

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

/**
 * Hook pour accéder au contexte du panier.
 * @returns {object} Contexte du panier
 */
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart doit être utilisé à l\'intérieur d\'un CartProvider');
  }
  return context;
}

export default CartContext;
