/**
 * @file adminApi.js
 * @description Service API pour le panel d'administration web.
 * Centralise tous les appels API vers le backend admin.
 */

'use strict';

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

// ============================================================================
// UTILITAIRE HTTP
// ============================================================================

class AdminApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Effectue une requête authentifiée vers l'API admin.
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    throw new AdminApiError('Not authenticated', 401);
  }

  const config = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    },
    ...options
  };

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
      throw new AdminApiError(
        data.error || 'Request failed',
        response.status,
        data
      );
    }

    return data;
  } catch (err) {
    if (err instanceof AdminApiError) throw err;
    throw new AdminApiError(`Network error: ${err.message}`, 0);
  }
}

// ============================================================================
// DASHBOARD & STATS
// ============================================================================

export async function getDashboard() {
  return request('/admin/dashboard');
}

export async function getHistoricalStats(startDate, endDate) {
  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);
  return request(`/admin/stats?${params.toString()}`);
}

export async function getTopMerchants(limit = 10, periodDays = 30) {
  return request(`/admin/stats/top-merchants?limit=${limit}&period_days=${periodDays}`);
}

export async function getTopDeliverers(limit = 10, periodDays = 30) {
  return request(`/admin/stats/top-deliverers?limit=${limit}&period_days=${periodDays}`);
}

export async function calculateDailyStats(date = null) {
  return request('/admin/stats/calculate', {
    method: 'POST',
    body: JSON.stringify({ date })
  });
}

// ============================================================================
// GESTION UTILISATEURS
// ============================================================================

export async function getUsers(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  });
  return request(`/admin/users?${searchParams.toString()}`);
}

export async function getUserDetail(userId) {
  return request(`/admin/users/${userId}`);
}

export async function suspendUser(userId, reason) {
  return request(`/admin/users/${userId}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export async function unsuspendUser(userId) {
  return request(`/admin/users/${userId}/unsuspend`, {
    method: 'POST'
  });
}

export async function deleteUser(userId, reason) {
  return request(`/admin/users/${userId}`, {
    method: 'DELETE',
    body: JSON.stringify({ reason })
  });
}

// ============================================================================
// RÉCONCILIATION
// ============================================================================

export async function getReconciliations(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  });
  return request(`/admin/reconciliation?${searchParams.toString()}`);
}

export async function generateReconciliation(delivererId, periodStart, periodEnd) {
  return request('/admin/reconciliation/generate', {
    method: 'POST',
    body: JSON.stringify({
      deliverer_id: delivererId,
      period_start: periodStart,
      period_end: periodEnd
    })
  });
}

export async function confirmReconciliation(recordId) {
  return request(`/admin/reconciliation/${recordId}/confirm`, {
    method: 'POST'
  });
}

export async function disputeReconciliation(recordId, reason) {
  return request(`/admin/reconciliation/${recordId}/dispute`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export async function getDelivererBalance(delivererId) {
  return request(`/admin/reconciliation/balance/${delivererId}`);
}

// ============================================================================
// PAYOUTS
// ============================================================================

export async function getPayouts(params = {}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value);
    }
  });
  return request(`/admin/payouts?${searchParams.toString()}`);
}

export async function generatePayout(merchantId, periodStart, periodEnd) {
  return request('/admin/payouts/generate', {
    method: 'POST',
    body: JSON.stringify({
      merchant_id: merchantId,
      period_start: periodStart,
      period_end: periodEnd
    })
  });
}

export async function approvePayout(payoutId, paymentReference) {
  return request(`/admin/payouts/${payoutId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ payment_reference: paymentReference })
  });
}

export { AdminApiError };
