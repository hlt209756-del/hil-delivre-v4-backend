import api from '../config/api';
// ============================================================
// Service d'abonnement — Hil_Delivre v4 (Sprint 8)
// Gère les appels API liés aux abonnements marchands/livreurs
// ============================================================
/**
• Récupérer le statut de l'abonnement de l'utilisateur connecté
 */
export const getSubscriptionStatus = async () => {
  try {
 const response = await api.get('/subscription/status');
 return response.data;
  } catch (error) {
 throw error.response?.data || error;
  }
};
/**
• Initier le renouvellement de l'abonnement via PayDunya
 */
export const initiateRenewal = async () => {
  try {
 const response = await api.post('/subscription/renew');
 return response.data;
  } catch (error) {
 throw error.response?.data || error;
  }
};
/**
• Récupérer l'historique des paiements d'abonnement
 */
export const getSubscriptionHistory = async (page = 1, limit = 20) => {
  try {
 const response = await api.get('/subscription/history', {
   params: { page, limit }
 });
 return response.data;
  } catch (error) {
 throw error.response?.data || error;
  }
};
/**
• Vérifier si l'abonnement est actif (utilisé par le middleware mobile)
 */
export const isSubscriptionActive = async () => {
  try {
 const { data } = await getSubscriptionStatus();
 return data.status === 'active' || data.is_trial === true;
  } catch (error) {
 return false;
  }
};
export default {
  getSubscriptionStatus,
  initiateRenewal,
  getSubscriptionHistory,
  isSubscriptionActive,
};