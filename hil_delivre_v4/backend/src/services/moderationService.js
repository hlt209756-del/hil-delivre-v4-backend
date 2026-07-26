/**
 * @file moderationService.js
 * @description Service de modération et gestion des utilisateurs pour l'admin.
 * Gère la suspension, la réactivation, la suppression, et la gestion des payouts marchands.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');
const { sendNotification } = require('./notificationService');

// ============================================================================
// FONCTIONS PUBLIQUES — GESTION UTILISATEURS
// ============================================================================

/**
 * Récupère la liste des utilisateurs avec filtres et pagination.
 *
 * @param {Object} options - {role, status, search, page, limit, sort_by, sort_order}
 * @returns {Promise<Object>}
 */
async function getUsers(options = {}) {
  try {
    const {
      role, status, search,
      page = 1, limit = 20,
      sort_by = 'created_at', sort_order = 'desc'
    } = options;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('profiles_data')
      .select('*, users!inner(email, created_at)', { count: 'exact' })
      .order(sort_by, { ascending: sort_order === 'asc' })
      .range(offset, offset + limit - 1);

    if (role) query = query.eq('role', role);
    if (status === 'suspended') query = query.eq('is_suspended', true);
    if (status === 'active') query = query.eq('is_suspended', false);
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
    }

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch users: ${error.message}`);
    }

    return {
      users: data || [],
      total: count || 0,
      page,
      limit
    };
  } catch (err) {
    throw new Error(`getUsers failed: ${err.message}`);
  }
}

/**
 * Récupère le détail complet d'un utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<Object>}
 */
async function getUserDetail(userId) {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    // Statistiques de l'utilisateur
    const stats = await getUserStats(userId, profile.role);

    // Dernières actions admin sur cet utilisateur
    const { data: adminActions } = await supabaseAdmin
      .from('admin_actions')
      .select('*')
      .eq('target_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    return {
      profile,
      stats,
      admin_actions: adminActions || []
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`getUserDetail failed: ${err.message}`);
  }
}

/**
 * Suspend un utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur à suspendre
 * @param {string} adminId - UUID de l'admin
 * @param {string} reason - Raison de la suspension
 * @returns {Promise<Object>}
 */
async function suspendUser(userId, adminId, reason) {
  try {
    // Vérifier que l'utilisateur existe et n'est pas déjà suspendu
    const { data: profile, error } = await supabaseAdmin
      .from('profiles_data')
      .select('role, is_suspended, full_name')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    if (profile.role === 'admin') {
      const err = new Error('Cannot suspend an admin');
      err.statusCode = 403;
      throw err;
    }

    if (profile.is_suspended) {
      const err = new Error('User is already suspended');
      err.statusCode = 409;
      throw err;
    }

    // Suspendre
    const { error: updateError } = await supabaseAdmin
      .from('profiles_data')
      .update({
        is_suspended: true,
        suspension_reason: reason,
        suspended_at: new Date().toISOString(),
        suspended_by: adminId
      })
      .eq('user_id', userId);

    if (updateError) {
      throw new Error(`Failed to suspend: ${updateError.message}`);
    }

    // Si c'est un livreur, le mettre offline
    if (profile.role === 'deliverer') {
      await supabaseAdmin
        .from('deliverer_locations')
        .update({ availability: 'offline' })
        .eq('deliverer_id', userId);
    }

    // Logger l'action admin
    await logAdminAction(adminId, 'user_suspended', userId, reason);

    // Notifier l'utilisateur
    await sendNotification({
      type: 'system_alert',
      recipients: { user_id: userId },
      data: {
        title: 'Compte suspendu',
        message: `Votre compte a été suspendu. Raison : ${reason}. Contactez le support pour plus d'informations.`
      }
    }).catch(() => {}); // Non-bloquant

    return {
      success: true,
      user_id: userId,
      suspended: true,
      reason
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`suspendUser failed: ${err.message}`);
  }
}

/**
 * Réactive un utilisateur suspendu.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {string} adminId - UUID de l'admin
 * @returns {Promise<Object>}
 */
async function unsuspendUser(userId, adminId) {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles_data')
      .select('is_suspended')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    if (!profile.is_suspended) {
      const err = new Error('User is not suspended');
      err.statusCode = 409;
      throw err;
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles_data')
      .update({
        is_suspended: false,
        suspension_reason: null,
        suspended_at: null,
        suspended_by: null
      })
      .eq('user_id', userId);

    if (updateError) {
      throw new Error(`Failed to unsuspend: ${updateError.message}`);
    }

    await logAdminAction(adminId, 'user_unsuspended', userId);

    // Notifier
    await sendNotification({
      type: 'system_alert',
      recipients: { user_id: userId },
      data: {
        title: 'Compte réactivé',
        message: 'Votre compte a été réactivé. Vous pouvez à nouveau utiliser tous les services.'
      }
    }).catch(() => {});

    return { success: true, user_id: userId, suspended: false };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`unsuspendUser failed: ${err.message}`);
  }
}

/**
 * Supprime un compte utilisateur (soft-delete + anonymisation CIL).
 *
 * @param {string} userId - UUID
 * @param {string} adminId - UUID admin
 * @param {string} reason - Raison
 * @returns {Promise<Object>}
 */
async function deleteUser(userId, adminId, reason) {
  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles_data')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error || !profile) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    if (profile.role === 'admin') {
      const err = new Error('Cannot delete an admin account');
      err.statusCode = 403;
      throw err;
    }

    // Anonymisation CIL (droit à l'effacement)
    await supabaseAdmin
      .from('profiles_data')
      .update({
        full_name: '[SUPPRIMÉ]',
        phone: null,
        address: null,
        is_suspended: true,
        suspension_reason: `Compte supprimé: ${reason}`,
        suspended_at: new Date().toISOString(),
        suspended_by: adminId
      })
      .eq('user_id', userId);

    // Désactiver les tokens
    await supabaseAdmin
      .from('device_tokens')
      .update({ is_active: false })
      .eq('user_id', userId);

    await logAdminAction(adminId, 'user_deleted', userId, reason);

    return { success: true, user_id: userId, deleted: true };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`deleteUser failed: ${err.message}`);
  }
}

// ============================================================================
// FONCTIONS PUBLIQUES — PAYOUTS MARCHANDS
// ============================================================================

/**
 * Génère un payout pour un marchand.
 *
 * @param {string} merchantId - UUID du marchand
 * @param {string} periodStart - Début de période
 * @param {string} periodEnd - Fin de période
 * @returns {Promise<Object>}
 */
async function generateMerchantPayout(merchantId, periodStart, periodEnd) {
  try {
    // Récupérer les commandes livrées dans la période
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('id, food_amount, commission_amount, vat_amount')
      .eq('merchant_id', merchantId)
      .eq('status', 'delivered')
      .gte('delivered_at', periodStart)
      .lte('delivered_at', periodEnd);

    if (error) {
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }

    const ordersList = orders || [];
    if (ordersList.length === 0) {
      return { success: false, message: 'No orders found for this period' };
    }

    const totalOrdersAmount = ordersList.reduce((sum, o) => sum + (o.food_amount || 0), 0);
    const platformCommission = ordersList.reduce((sum, o) => sum + (o.commission_amount || 0), 0);
    const vatOnCommission = ordersList.reduce((sum, o) => sum + (o.vat_amount || 0), 0);
    const netPayout = totalOrdersAmount - platformCommission;

    const { data: payout, error: insertError } = await supabaseAdmin
      .from('merchant_payouts')
      .insert({
        merchant_id: merchantId,
        period_start: periodStart,
        period_end: periodEnd,
        total_orders_amount: totalOrdersAmount,
        total_orders_count: ordersList.length,
        platform_commission: platformCommission,
        commission_rate: 0.05,
        vat_on_commission: vatOnCommission,
        net_payout: netPayout,
        order_ids: ordersList.map(o => o.id)
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create payout: ${insertError.message}`);
    }

    return payout;
  } catch (err) {
    throw new Error(`generateMerchantPayout failed: ${err.message}`);
  }
}

/**
 * Approuve et traite un payout marchand.
 *
 * @param {string} payoutId - UUID du payout
 * @param {string} adminId - UUID admin
 * @param {string} paymentReference - Référence du paiement
 * @returns {Promise<Object>}
 */
async function approvePayout(payoutId, adminId, paymentReference) {
  try {
    const { data: payout, error } = await supabaseAdmin
      .from('merchant_payouts')
      .select('*')
      .eq('id', payoutId)
      .single();

    if (error || !payout) {
      const err = new Error('Payout not found');
      err.statusCode = 404;
      throw err;
    }

    if (payout.status !== 'pending') {
      const err = new Error(`Cannot approve: current status is "${payout.status}"`);
      err.statusCode = 409;
      throw err;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('merchant_payouts')
      .update({
        status: 'completed',
        payment_reference: paymentReference,
        processed_at: new Date().toISOString(),
        processed_by: adminId,
        updated_at: new Date().toISOString()
      })
      .eq('id', payoutId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to approve: ${updateError.message}`);
    }

    // Mettre à jour les gains du marchand
    await supabaseAdmin.rpc('increment_field', {
      p_table: 'profiles_data',
      p_field: 'total_earnings',
      p_value: payout.net_payout,
      p_user_id: payout.merchant_id
    }).catch(() => {
      // Fallback si RPC n'existe pas
      supabaseAdmin
        .from('profiles_data')
        .update({ total_earnings: payout.net_payout })
        .eq('user_id', payout.merchant_id);
    });

    await logAdminAction(adminId, 'payout_approved', payout.merchant_id, null, {
      payout_id: payoutId,
      amount: payout.net_payout
    });

    // Notifier le marchand
    await sendNotification({
      type: 'payment_received',
      recipients: { merchant_id: payout.merchant_id },
      data: { amount: payout.net_payout, order_ref: `PAYOUT-${payoutId.slice(0, 8)}` }
    }).catch(() => {});

    return updated;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`approvePayout failed: ${err.message}`);
  }
}

/**
 * Récupère les payouts (filtrés).
 *
 * @param {Object} options - {merchant_id, status, page, limit}
 * @returns {Promise<Object>}
 */
async function getPayouts(options = {}) {
  try {
    const { merchant_id, status, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('merchant_payouts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (merchant_id) query = query.eq('merchant_id', merchant_id);
    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch payouts: ${error.message}`);
    }

    return {
      payouts: data || [],
      total: count || 0,
      page,
      limit
    };
  } catch (err) {
    throw new Error(`getPayouts failed: ${err.message}`);
  }
}

// ============================================================================
// FONCTIONS INTERNES
// ============================================================================

/**
 * Récupère les statistiques d'un utilisateur selon son rôle.
 */
async function getUserStats(userId, role) {
  const stats = {};

  if (role === 'client') {
    const { count } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', userId);
    stats.total_orders = count || 0;
  }

  if (role === 'merchant') {
    const { count } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', userId)
      .eq('status', 'delivered');
    stats.completed_orders = count || 0;

    const { data: revenue } = await supabaseAdmin
      .from('orders')
      .select('food_amount')
      .eq('merchant_id', userId)
      .eq('status', 'delivered');
    stats.total_revenue = (revenue || []).reduce((sum, o) => sum + (o.food_amount || 0), 0);
  }

  if (role === 'deliverer') {
    const { count } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_id', userId)
      .eq('status', 'delivered');
    stats.completed_deliveries = count || 0;

    const { data: earnings } = await supabaseAdmin
      .from('orders')
      .select('delivery_fee')
      .eq('delivery_id', userId)
      .eq('status', 'delivered');
    stats.total_earnings = (earnings || []).reduce((sum, o) => sum + (o.delivery_fee || 0), 0);
  }

  return stats;
}

/**
 * Enregistre une action admin dans le journal.
 */
async function logAdminAction(adminId, actionType, targetUserId, reason = null, metadata = {}) {
  try {
    await supabaseAdmin
      .from('admin_actions')
      .insert({
        admin_id: adminId,
        action_type: actionType,
        target_user_id: targetUserId,
        reason,
        metadata
      });
  } catch {
    // Non-bloquant
  }
}

module.exports = {
  getUsers,
  getUserDetail,
  suspendUser,
  unsuspendUser,
  deleteUser,
  generateMerchantPayout,
  approvePayout,
  getPayouts
};
