'use strict';

/**
 * @fileoverview Configuration de l'API pour l'application mobile Hil_Delivre v4.
 *
 * @module config/api
 */

import Constants from 'expo-constants';

/**
 * URL de base de l'API backend.
 * En développement : localhost (via le tunnel Expo ou l'IP locale)
 * En production : URL du serveur de production
 */
export const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl
  || __DEV__
    ? 'http://192.168.1.1:3000' // Remplacer par l'IP locale en dev
    : 'https://api.hildelivre.bf';

/**
 * Timeout par défaut des requêtes (en ms).
 */
export const REQUEST_TIMEOUT = 15000;

/**
 * Version de l'API.
 */
export const API_VERSION = 'v1';
