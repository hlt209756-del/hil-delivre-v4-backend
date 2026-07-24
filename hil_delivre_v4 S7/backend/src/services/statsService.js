/**
 * @file statsService.js
 * @description Service de statistiques et métriques pour le dashboard admin.
 * Fournit des données temps réel et historiques sur l'activité de la plateforme.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Récupère les métriques temps réel du dashboard.
 *
 * @returns {Promise<Object>} Métriques en temps réel
 */
async function getDashboardMetrics() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const startOfDay = new Date(today + 'T00:00:00Z').toISOString();

    // Requêtes parallèles pour les métriques temps réel
    const [
      ordersToday,
      activeOrders,
      usersCount,
      revenueToday,
      onlineDeliverers,
      pendingKyc
    ] = await Promise.all([
      // Commandes du jour
      supabaseAdmin
        .from('orders')
        .select('id, status, total_amount', { count: 'exact' })
        .gte('created_at', startOfDay),

      // Commandes actives (en cours)
      supabaseAdmin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'accepted', 'preparing', 'ready', 'picked_up', 'in_delivery']),

      // Nombre total d'utilisateurs par rôle
      supabaseAdmin
        .from('profiles_data')
        .select('role', { count: 'exact' }),

      // Revenue du jour (commissions + frais)
      supabaseAdmin
        .from('orders')
        .select('commission_amount, delivery_fee, vat_amount')
        .gte('created_at', startOfDay)
        .eq('status', 'delivered'),

      // Livreurs en ligne
      supabaseAdmin
        .from('deliverer_locations')
        .select('id', { count: 'exact', head: true })
        .eq('availability', 'online'),

      // KYC en attente
      supabaseAdmin
        .from('kyc_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
    ]);

    // Calculer les métriques
    const totalOrdersToday = ordersToday.count || 0;
    const completedToday = ordersToday.data?.filter(o => o.status === 'delivered').length || 0;
    const cancelledToday = ordersToday.data?.filter(o => o.status === 'cancelled').length || 0;

    const revenue = (revenueToday.data || []).reduce((acc, o) => ({
      commissions: acc.commissions + (o.commission_amount || 0),
      delivery_fees: acc.delivery_fees + (o.delivery_fee || 0),
      vat: acc.vat + (o.vat_amount || 0)
    }), { commissions: 0, delivery_fees: 0, vat: 0 });

    // Compter par rôle
    const roleCounts = {};
    if (usersCount.data) {
      for (const user of usersCount.data) {
        roleCounts[user.role] = (roleCounts[user.role] || 0) + 1;
      }
    }

    return {
      realtime: {
        active_orders: activeOrders.count || 0,
        online_deliverers: onlineDeliverers.count || 0,
        pending_kyc: pendingKyc.count || 0
      },
      today: {
        total_orders: totalOrdersToday,
        completed_orders: completedToday,
        cancelled_orders: cancelledToday,
        completion_rate: totalOrdersToday > 0
          ? Math.round((completedToday / totalOrdersToday) * 100)
          : 0,
        revenue_commissions: revenue.commissions,
        revenue_delivery_fees: revenue.delivery_fees,
        revenue_vat: revenue.vat,
        revenue_total: revenue.commissions + revenue.delivery_fees + revenue.vat
      },
      users: {
        total: usersCount.count || 0,
        clients: roleCounts.client || 0,
        merchants: roleCounts.merchant || 0,
        deliverers: roleCounts.deliverer || 0,
        admins: roleCounts.admin || 0
      },
      generated_at: now.toISOString()
    };
  } catch (err) {
    throw new Error(`getDashboardMetrics failed: ${err.message}`);
  }
}

/**
 * Récupère les statistiques historiques (par période).
 *
 * @param {Object} options - {start_date, end_date, granularity}
 * @returns {Promise<Array>} Statistiques par jour
 */
async function getHistoricalStats(options = {}) {
  try {
    const {
      start_date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date = new Date().toISOString().split('T')[0]
    } = options;

    const { data, error } = await supabaseAdmin
      .from('platform_daily_stats')
      .select('*')
      .gte('stat_date', start_date)
      .lte('stat_date', end_date)
      .order('stat_date', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch stats: ${error.message}`);
    }

    // Calculer les totaux de la période
    const totals = (data || []).reduce((acc, day) => ({
      total_orders: acc.total_orders + day.total_orders,
      completed_orders: acc.completed_orders + day.completed_orders,
      cancelled_orders: acc.cancelled_orders + day.cancelled_orders,
      total_revenue: acc.total_revenue + Number(day.total_revenue),
      total_commissions: acc.total_commissions + Number(day.total_commissions),
      total_gmv: acc.total_gmv + Number(day.total_gmv),
      new_users: acc.new_users + day.new_users
    }), {
      total_orders: 0, completed_orders: 0, cancelled_orders: 0,
      total_revenue: 0, total_commissions: 0, total_gmv: 0, new_users: 0
    });

    return {
      period: { start_date, end_date },
      totals,
      daily: data || []
    };
  } catch (err) {
    throw new Error(`getHistoricalStats failed: ${err.message}`);
  }
}

/**
 * Récupère les top marchands par volume.
 *
 * @param {Object} options - {limit, period_days}
 * @returns {Promise<Array>}
 */
async function getTopMerchants(options = {}) {
  try {
    const { limit = 10, period_days = 30 } = options;
    const since = new Date(Date.now() - period_days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabaseAdmin
      .rpc('get_top_merchants', { p_since: since, p_limit: limit });

    // Fallback si la fonction RPC n'existe pas encore
    if (error) {
      const { data: orders } = await supabaseAdmin
        .from('orders')
        .select('merchant_id, food_amount, status')
        .gte('created_at', since)
        .eq('status', 'delivered');

      if (!orders) return [];

      // Agrégation manuelle
      const merchantStats = {};
      for (const order of orders) {
        if (!merchantStats[order.merchant_id]) {
          merchantStats[order.merchant_id] = { merchant_id: order.merchant_id, total_revenue: 0, order_count: 0 };
        }
        merchantStats[order.merchant_id].total_revenue += order.food_amount || 0;
        merchantStats[order.merchant_id].order_count += 1;
      }

      return Object.values(merchantStats)
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, limit);
    }

    return data || [];
  } catch (err) {
    throw new Error(`getTopMerchants failed: ${err.message}`);
  }
}

/**
 * Récupère les top livreurs par performance.
 *
 * @param {Object} options - {limit, period_days}
 * @returns {Promise<Array>}
 */
async function getTopDeliverers(options = {}) {
  try {
    const { limit = 10, period_days = 30 } = options;
    const since = new Date(Date.now() - period_days * 24 * 60 * 60 * 1000).toISOString();

    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('delivery_id, delivery_fee, delivered_at, created_at')
      .gte('created_at', since)
      .eq('status', 'delivered')
      .not('delivery_id', 'is', null);

    if (!orders || orders.length === 0) return [];

    // Agrégation
    const delivererStats = {};
    for (const order of orders) {
      if (!delivererStats[order.delivery_id]) {
        delivererStats[order.delivery_id] = {
          deliverer_id: order.delivery_id,
          total_earnings: 0,
          delivery_count: 0,
          total_time_minutes: 0
        };
      }
      delivererStats[order.delivery_id].total_earnings += order.delivery_fee || 0;
      delivererStats[order.delivery_id].delivery_count += 1;

      if (order.delivered_at && order.created_at) {
        const timeMin = (new Date(order.delivered_at) - new Date(order.created_at)) / 60000;
        delivererStats[order.delivery_id].total_time_minutes += timeMin;
      }
    }

    return Object.values(delivererStats)
      .map(d => ({
        ...d,
        avg_delivery_time: d.delivery_count > 0
          ? Math.round(d.total_time_minutes / d.delivery_count)
          : 0
      }))
      .sort((a, b) => b.delivery_count - a.delivery_count)
      .slice(0, limit);
  } catch (err) {
    throw new Error(`getTopDeliverers failed: ${err.message}`);
  }
}

/**
 * Déclenche le calcul des stats quotidiennes.
 *
 * @param {string} [date] - Date au format YYYY-MM-DD (défaut: hier)
 * @returns {Promise<Object>}
 */
async function triggerDailyStatsCalculation(date = null) {
  try {
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { error } = await supabaseAdmin
      .rpc('calculate_daily_stats', { p_date: targetDate });

    if (error) {
      throw new Error(`Stats calculation failed: ${error.message}`);
    }

    return { success: true, date: targetDate };
  } catch (err) {
    throw new Error(`triggerDailyStatsCalculation failed: ${err.message}`);
  }
}

module.exports = {
  getDashboardMetrics,
  getHistoricalStats,
  getTopMerchants,
  getTopDeliverers,
  triggerDailyStatsCalculation
};
