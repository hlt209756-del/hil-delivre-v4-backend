/**
 * @file apps/mobile/services/paymentService.js
 * @description Service mobile pour les appels API de paiement.
 * Gère l'initiation des paiements, le polling du statut et la récupération des factures.
 */

import { apiClient } from '../config/api';

// ============================================================================
// CONSTANTES
// ============================================================================

const PAYMENT_ENDPOINTS = {
  INITIATE: '/api/payments/initiate',
  STATUS: (orderId) => `/api/payments/${orderId}/status`,
  INVOICE: (orderId) => `/api/orders/${orderId}/invoice`,
  RATES: '/api/config/rates'
};

const POLLING_INTERVAL_MS = 3000; // 3 secondes entre chaque poll
const MAX_POLLING_ATTEMPTS = 60; // 3 minutes max de polling (60 × 3s)

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Initie un paiement pour une commande.
 * @param {string} orderId - UUID de la commande
 * @param {string} paymentMethod - 'mobile_money' ou 'cash'
 * @param {string} [phoneNumber] - Numéro de téléphone (requis pour mobile_money)
 * @returns {Promise<Object>} Résultat de l'initiation
 */
export async function initiatePayment(orderId, paymentMethod, phoneNumber = null) {
  try {
    const payload = {
      order_id: orderId,
      payment_method: paymentMethod
    };

    if (paymentMethod === 'mobile_money' && phoneNumber) {
      payload.phone_number = phoneNumber;
    }

    const response = await apiClient.post(PAYMENT_ENDPOINTS.INITIATE, payload);
    return response.data;
  } catch (error) {
    const message = error.response?.data?.error || 'Failed to initiate payment';
    throw new Error(message);
  }
}

/**
 * Récupère le statut de paiement d'une commande.
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<Object>} Statut du paiement
 */
export async function getPaymentStatus(orderId) {
  try {
    const response = await apiClient.get(PAYMENT_ENDPOINTS.STATUS(orderId));
    return response.data;
  } catch (error) {
    const message = error.response?.data?.error || 'Failed to get payment status';
    throw new Error(message);
  }
}

/**
 * Effectue un polling du statut de paiement jusqu'à résolution.
 * Résout quand le paiement est complété, échoué ou annulé.
 * @param {string} orderId - UUID de la commande
 * @param {Function} onStatusChange - Callback appelé à chaque changement de statut
 * @param {AbortSignal} [signal] - Signal pour annuler le polling
 * @returns {Promise<Object>} Statut final du paiement
 */
export async function pollPaymentStatus(orderId, onStatusChange, signal = null) {
  let attempts = 0;
  let lastStatus = null;

  return new Promise((resolve, reject) => {
    const intervalId = setInterval(async () => {
      // Vérifier si annulé
      if (signal?.aborted) {
        clearInterval(intervalId);
        reject(new Error('Payment polling cancelled'));
        return;
      }

      // Vérifier le nombre max de tentatives
      attempts += 1;
      if (attempts > MAX_POLLING_ATTEMPTS) {
        clearInterval(intervalId);
        reject(new Error('Payment status check timed out. Please check your payment provider.'));
        return;
      }

      try {
        const result = await getPaymentStatus(orderId);
        const currentStatus = result?.data?.transaction?.status;

        // Notifier le changement de statut
        if (currentStatus && currentStatus !== lastStatus) {
          lastStatus = currentStatus;
          if (onStatusChange) {
            onStatusChange(currentStatus, result.data);
          }
        }

        // Résoudre si le paiement est dans un état final
        if (['completed', 'failed', 'cancelled', 'refunded'].includes(currentStatus)) {
          clearInterval(intervalId);
          resolve(result.data);
        }
      } catch (err) {
        // Ne pas arrêter le polling sur une erreur réseau temporaire
        if (attempts >= MAX_POLLING_ATTEMPTS) {
          clearInterval(intervalId);
          reject(err);
        }
      }
    }, POLLING_INTERVAL_MS);

    // Cleanup si le signal est annulé
    if (signal) {
      signal.addEventListener('abort', () => {
        clearInterval(intervalId);
        reject(new Error('Payment polling cancelled'));
      });
    }
  });
}

/**
 * Récupère la facture FEC d'une commande.
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<Object>} Facture FEC
 */
export async function getInvoice(orderId) {
  try {
    const response = await apiClient.get(PAYMENT_ENDPOINTS.INVOICE(orderId));
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      return null; // Facture pas encore générée
    }
    const message = error.response?.data?.error || 'Failed to get invoice';
    throw new Error(message);
  }
}

/**
 * Récupère les taux de la plateforme (commission, TVA, frais).
 * Utile pour l'affichage du récapitulatif avant paiement.
 * @returns {Promise<Object>} Taux de la plateforme
 */
export async function getPlatformRates() {
  try {
    const response = await apiClient.get(PAYMENT_ENDPOINTS.RATES);
    return response.data;
  } catch (error) {
    // Retourner les valeurs par défaut en cas d'erreur
    return {
      data: {
        merchant_commission_rate: 0.05,
        platform_vat_rate: 0.18,
        delivery_base_fee: 250,
        service_fee_rate: 0.02
      }
    };
  }
}

export default {
  initiatePayment,
  getPaymentStatus,
  pollPaymentStatus,
  getInvoice,
  getPlatformRates
};
