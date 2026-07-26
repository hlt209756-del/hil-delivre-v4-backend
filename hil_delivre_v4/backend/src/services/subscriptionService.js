// apps/mobile/services/subscriptionService.js - Service API mobile pour les abonnements

import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext'; // Supposé exister du Sprint 2
import { API_URL } from '../config/api'; // Supposé exister du Sprint 2

const useSubscriptionService = () => {
  const { authToken } = useContext(AuthContext);

  const callApi = async (endpoint, method = 'GET', body = null) => {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    };

    const config = {
      method,
      headers,
    };

    if (body) {
      config.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_URL}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Une erreur est survenue');
    }
    return data.data;
  };

  const getSubscriptionStatus = async () => {
    return callApi('/subscription/status');
  };

  const initiateRenewal = async () => {
    return callApi('/subscription/renew', 'POST');
  };

  const getSubscriptionHistory = async () => {
    return callApi('/subscription/history');
  };

  return {
    getSubscriptionStatus,
    initiateRenewal,
    getSubscriptionHistory,
  };
};

export default useSubscriptionService;
