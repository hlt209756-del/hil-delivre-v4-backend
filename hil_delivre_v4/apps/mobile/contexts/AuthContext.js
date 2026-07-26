'use strict';

/**
 * @fileoverview Contexte d'authentification pour l'application mobile Hil_Delivre v4.
 * Gère l'état d'authentification global, la persistance du token (SecureStore),
 * et fournit les méthodes d'auth à tous les composants enfants.
 *
 * @module contexts/AuthContext
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import * as SecureStore from 'expo-secure-store';
import authService from '../services/authService';

// ============================================================
// CONSTANTES
// ============================================================

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'hil_access_token',
  REFRESH_TOKEN: 'hil_refresh_token',
  USER_PROFILE: 'hil_user_profile',
};

// ============================================================
// CONTEXTE
// ============================================================

const AuthContext = createContext(null);

/**
 * Provider d'authentification.
 * Encapsule l'application et fournit l'état d'auth + méthodes.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [error, setError] = useState(null);

  // ---- Initialisation : charger la session persistée ----
  useEffect(() => {
    loadStoredSession();
  }, []);

  /**
   * Charge la session depuis SecureStore au démarrage.
   */
  async function loadStoredSession() {
    try {
      setIsLoading(true);
      const accessToken = await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
      const storedProfile = await SecureStore.getItemAsync(STORAGE_KEYS.USER_PROFILE);

      if (accessToken && storedProfile) {
        const parsedProfile = JSON.parse(storedProfile);
        setProfile(parsedProfile);
        setIsAuthenticated(true);

        // Vérifier la validité du token en chargeant le profil frais
        try {
          const response = await authService.getProfile(accessToken);
          if (response.success) {
            setUser(response.data.user);
            setProfile(response.data.profile);
          } else {
            // Token expiré — tenter un refresh
            await attemptTokenRefresh();
          }
        } catch {
          // Erreur réseau — garder la session locale
          setUser({ id: parsedProfile.user_id });
        }
      }
    } catch (err) {
      console.error('[AuthContext] Erreur chargement session:', err.message);
      await clearSession();
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Tente de rafraîchir le token d'accès.
   */
  async function attemptTokenRefresh() {
    try {
      const refreshToken = await SecureStore.getItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
      if (!refreshToken) {
        await clearSession();
        return;
      }

      const response = await authService.refreshToken(refreshToken);
      if (response.success) {
        await storeSession(response.data.session);
      } else {
        await clearSession();
      }
    } catch {
      await clearSession();
    }
  }

  /**
   * Persiste la session dans SecureStore.
   *
   * @param {object} session - Données de session
   * @param {string} session.access_token
   * @param {string} session.refresh_token
   * @param {object} [profileData] - Profil utilisateur
   */
  async function storeSession(session, profileData = null) {
    try {
      await SecureStore.setItemAsync(STORAGE_KEYS.ACCESS_TOKEN, session.access_token);
      await SecureStore.setItemAsync(STORAGE_KEYS.REFRESH_TOKEN, session.refresh_token);

      if (profileData) {
        await SecureStore.setItemAsync(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profileData));
      }
    } catch (err) {
      console.error('[AuthContext] Erreur stockage session:', err.message);
    }
  }

  /**
   * Supprime la session de SecureStore.
   */
  async function clearSession() {
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.REFRESH_TOKEN);
      await SecureStore.deleteItemAsync(STORAGE_KEYS.USER_PROFILE);
    } catch (err) {
      console.error('[AuthContext] Erreur suppression session:', err.message);
    }
    setUser(null);
    setProfile(null);
    setIsAuthenticated(false);
  }

  // ---- Méthodes d'authentification ----

  /**
   * Inscription d'un nouvel utilisateur.
   *
   * @param {object} data - Données d'inscription
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const register = useCallback(async (data) => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await authService.register(data);

      if (response.success) {
        const { session, profile: userProfile, user: userData } = response.data;

        if (session) {
          await storeSession(session, userProfile);
          setUser(userData);
          setProfile(userProfile);
          setIsAuthenticated(true);
        }

        return { success: true };
      }

      const errorMessage = response.error?.message || 'Erreur lors de l\'inscription.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } catch (err) {
      const errorMessage = 'Erreur de connexion au serveur. Vérifiez votre connexion internet.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Connexion d'un utilisateur existant.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  const login = useCallback(async (email, password) => {
    try {
      setError(null);
      setIsLoading(true);

      const response = await authService.login(email, password);

      if (response.success) {
        const { session, profile: userProfile, user: userData } = response.data;

        await storeSession(session, userProfile);
        setUser(userData);
        setProfile(userProfile);
        setIsAuthenticated(true);

        return { success: true };
      }

      const errorMessage = response.error?.message || 'Email ou mot de passe incorrect.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } catch (err) {
      const errorMessage = 'Erreur de connexion au serveur. Vérifiez votre connexion internet.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Déconnexion de l'utilisateur.
   */
  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      const accessToken = await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);

      if (accessToken) {
        await authService.logout(accessToken);
      }
    } catch (err) {
      // Ignorer les erreurs — on déconnecte localement dans tous les cas
      console.warn('[AuthContext] Erreur logout serveur:', err.message);
    } finally {
      await clearSession();
      setIsLoading(false);
    }
  }, []);

  /**
   * Mettre à jour le profil local après modification.
   *
   * @param {object} updatedProfile - Profil mis à jour
   */
  const updateLocalProfile = useCallback(async (updatedProfile) => {
    setProfile(updatedProfile);
    await SecureStore.setItemAsync(STORAGE_KEYS.USER_PROFILE, JSON.stringify(updatedProfile));
  }, []);

  /**
   * Récupérer le token d'accès actuel.
   *
   * @returns {Promise<string|null>}
   */
  const getAccessToken = useCallback(async () => {
    return await SecureStore.getItemAsync(STORAGE_KEYS.ACCESS_TOKEN);
  }, []);

  // ---- Valeur du contexte (mémorisée) ----
  const contextValue = useMemo(() => ({
    user,
    profile,
    isLoading,
    isAuthenticated,
    error,
    register,
    login,
    logout,
    updateLocalProfile,
    getAccessToken,
    clearError: () => setError(null),
  }), [user, profile, isLoading, isAuthenticated, error, register, login, logout, updateLocalProfile, getAccessToken]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook pour accéder au contexte d'authentification.
 *
 * @returns {object} Contexte d'authentification
 * @throws {Error} Si utilisé en dehors d'un AuthProvider
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth doit être utilisé à l\'intérieur d\'un AuthProvider');
  }
  return context;
}

export default AuthContext;
