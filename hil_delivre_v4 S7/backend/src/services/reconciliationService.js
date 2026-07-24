/**
 * @file reconciliationService.js
 * @description Service de réconciliation cash des livreurs.
 * Gère le suivi des encaissements cash, la génération des fiches de réconciliation,
 * la soumission par le livreur, et la confirmation par l'admin.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Génère un enregistrement de réconciliation pour un livreur.
 *
 * @param {string} delivererId - UUID du livreur
 * @param {string} periodStart - Début de la période (ISO)
 * @param {string} periodEnd - Fin de la période (ISO)
 * @returns {Promise<Object>} Enregistrement créé
 */
async function generateReconciliation(delivererId, periodStart, periodEnd) {
  try {
    // Vérifier que le livreur existe et est un livreur
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles_data')
      .select('role, user_id')
      .eq('user_id', delivererId)
      .eq('role', 'deliverer')
      .single();

    if (profileError || !profile) {
      const err = new Error('Deliverer not found');
      err.statusCode = 404;
      throw err;
    }

    // Vérifier qu'il n'y a pas de réconciliation en cours pour cette période
    const { data: existing } = await supabaseAdmin
      .from('reconciliation_records')
      .select('id')
      .eq('deliverer_id', delivererId)
      .gte('period_start', periodStart)
      .lte('period_end', periodEnd)
      .in('status', ['pending', 'submitted'])
      .limit(1);

    if (existing && existing.length > 0) {
      const err = new Error('A reconciliation already exists for this period');
      err.statusCode = 409;
      throw err;
    }

    // Récupérer les commandes cash livrées dans la période
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, total_amount, commission_amount, delivery_fee')
      .eq('delivery_id', delivererId)
      .eq('payment_method', 'cash')
      .eq('status', 'delivered')
      .gte('delivered_at', periodStart)
      .lte('delivered_at', periodEnd);

    if (ordersError) {
      throw new Error(`Failed to fetch orders: ${ordersError.message}`);
    }

    const ordersList = orders || [];

    // Calculer les montants
    const totalCashCollected = ordersList.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const totalOrdersCash = ordersList.length;
    const platformCommission = ordersList.reduce((sum, o) => sum + (o.commission_amount || 0), 0);
    const deliveryFeesCollected = ordersList.reduce((sum, o) => sum + (o.delivery_fee || 0), 0);

    // Le livreur a collecté le cash total du client
    // Il garde ses frais de livraison
    // Il doit reverser : total_cash - delivery_fees (= food + commission + vat + service_fees)
    const amountToRemit = Math.max(totalCashCollected - deliveryFeesCollected, 0);
    const amountToReceive = Math.max(deliveryFeesCollected - totalCashCollected, 0);

    const orderIds = ordersList.map(o => o.id);

    // Créer l'enregistrement
    const { data: record, error: insertError } = await supabaseAdmin
      .from('reconciliation_records')
      .insert({
        deliverer_id: delivererId,
        period_start: periodStart,
        period_end: periodEnd,
        total_cash_collected: totalCashCollected,
        total_orders_cash: totalOrdersCash,
        platform_commission: platformCommission,
        delivery_fees_collected: deliveryFeesCollected,
        amount_to_remit: amountToRemit,
        amount_to_receive: amountToReceive,
        order_ids: orderIds
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create reconciliation: ${insertError.message}`);
    }

    return record;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`generateReconciliation failed: ${err.message}`);
  }
}

/**
 * Le livreur soumet sa réconciliation (confirme qu'il va payer).
 *
 * @param {string} recordId - UUID de l'enregistrement
 * @param {string} delivererId - UUID du livreur (vérification)
 * @param {string} [paymentReference] - Référence du paiement (Mobile Money)
 * @returns {Promise<Object>}
 */
async function submitReconciliation(recordId, delivererId, paymentReference = null) {
  try {
    // Vérifier l'enregistrement
    const { data: record, error } = await supabaseAdmin
      .from('reconciliation_records')
      .select('*')
      .eq('id', recordId)
      .eq('deliverer_id', delivererId)
      .single();

    if (error || !record) {
      const err = new Error('Reconciliation record not found');
      err.statusCode = 404;
      throw err;
    }

    if (record.status !== 'pending') {
      const err = new Error(`Cannot submit: current status is "${record.status}"`);
      err.statusCode = 409;
      throw err;
    }

    // Mettre à jour
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('reconciliation_records')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        payment_reference: paymentReference,
        updated_at: new Date().toISOString()
      })
      .eq('id', recordId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to submit: ${updateError.message}`);
    }

    return updated;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`submitReconciliation failed: ${err.message}`);
  }
}

/**
 * L'admin confirme la réception du paiement.
 *
 * @param {string} recordId - UUID de l'enregistrement
 * @param {string} adminId - UUID de l'admin
 * @returns {Promise<Object>}
 */
async function confirmReconciliation(recordId, adminId) {
  try {
    const { data: record, error } = await supabaseAdmin
      .from('reconciliation_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (error || !record) {
      const err = new Error('Reconciliation record not found');
      err.statusCode = 404;
      throw err;
    }

    if (record.status !== 'submitted') {
      const err = new Error(`Cannot confirm: current status is "${record.status}"`);
      err.statusCode = 409;
      throw err;
    }

    // Confirmer
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('reconciliation_records')
      .update({
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        confirmed_by: adminId,
        updated_at: new Date().toISOString()
      })
      .eq('id', recordId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to confirm: ${updateError.message}`);
    }

    // Mettre à jour le solde cash du livreur
    await supabaseAdmin
      .from('profiles_data')
      .update({
        cash_balance: 0 // Reset après réconciliation
      })
      .eq('user_id', record.deliverer_id);

    // Audit
    await logAuditEvent({
      userId: adminId,
      actionType: 'reconciliation_confirmed',
      entityType: 'reconciliation',
      entityId: recordId,
      newValue: { deliverer_id: record.deliverer_id, amount: record.amount_to_remit }
    });

    return updated;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`confirmReconciliation failed: ${err.message}`);
  }
}

/**
 * L'admin conteste un enregistrement.
 *
 * @param {string} recordId - UUID
 * @param {string} adminId - UUID admin
 * @param {string} reason - Raison de la contestation
 * @returns {Promise<Object>}
 */
async function disputeReconciliation(recordId, adminId, reason) {
  try {
    const { data: record, error } = await supabaseAdmin
      .from('reconciliation_records')
      .select('*')
      .eq('id', recordId)
      .single();

    if (error || !record) {
      const err = new Error('Reconciliation record not found');
      err.statusCode = 404;
      throw err;
    }

    if (!['submitted', 'pending'].includes(record.status)) {
      const err = new Error(`Cannot dispute: current status is "${record.status}"`);
      err.statusCode = 409;
      throw err;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('reconciliation_records')
      .update({
        status: 'disputed',
        dispute_reason: reason,
        updated_at: new Date().toISOString()
      })
      .eq('id', recordId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to dispute: ${updateError.message}`);
    }

    await logAuditEvent({
      userId: adminId,
      actionType: 'reconciliation_disputed',
      entityType: 'reconciliation',
      entityId: recordId,
      newValue: { reason, deliverer_id: record.deliverer_id }
    });

    return updated;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`disputeReconciliation failed: ${err.message}`);
  }
}

/**
 * Récupère les enregistrements de réconciliation (filtrés).
 *
 * @param {Object} options - {deliverer_id, status, page, limit}
 * @returns {Promise<Object>}
 */
async function getReconciliations(options = {}) {
  try {
    const { deliverer_id, status, page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('reconciliation_records')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (deliverer_id) query = query.eq('deliverer_id', deliverer_id);
    if (status) query = query.eq('status', status);

    const { data, count, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch reconciliations: ${error.message}`);
    }

    return {
      records: data || [],
      total: count || 0,
      page,
      limit
    };
  } catch (err) {
    throw new Error(`getReconciliations failed: ${err.message}`);
  }
}

/**
 * Récupère le solde cash actuel d'un livreur.
 *
 * @param {string} delivererId - UUID du livreur
 * @returns {Promise<Object>}
 */
async function getDelivererCashBalance(delivererId) {
  try {
    // Commandes cash livrées non réconciliées
    const { data: unreconciledOrders, error } = await supabaseAdmin
      .from('orders')
      .select('id, total_amount, delivery_fee, delivered_at')
      .eq('delivery_id', delivererId)
      .eq('payment_method', 'cash')
      .eq('status', 'delivered');

    if (error) {
      throw new Error(`Failed to fetch orders: ${error.message}`);
    }

    // Récupérer les commandes déjà réconciliées
    const { data: reconciled } = await supabaseAdmin
      .from('reconciliation_records')
      .select('order_ids')
      .eq('deliverer_id', delivererId)
      .in('status', ['submitted', 'confirmed']);

    const reconciledOrderIds = new Set();
    if (reconciled) {
      for (const rec of reconciled) {
        if (rec.order_ids) {
          for (const id of rec.order_ids) {
            reconciledOrderIds.add(id);
          }
        }
      }
    }

    // Filtrer les commandes non réconciliées
    const unreconciledList = (unreconciledOrders || []).filter(o => !reconciledOrderIds.has(o.id));

    const totalCashHeld = unreconciledList.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    const totalDeliveryFees = unreconciledList.reduce((sum, o) => sum + (o.delivery_fee || 0), 0);
    const amountOwed = Math.max(totalCashHeld - totalDeliveryFees, 0);

    return {
      deliverer_id: delivererId,
      total_cash_held: totalCashHeld,
      delivery_fees_earned: totalDeliveryFees,
      amount_owed_to_platform: amountOwed,
      unreconciled_orders_count: unreconciledList.length,
      oldest_unreconciled: unreconciledList.length > 0
        ? unreconciledList[unreconciledList.length - 1].delivered_at
        : null
    };
  } catch (err) {
    throw new Error(`getDelivererCashBalance failed: ${err.message}`);
  }
}

module.exports = {
  generateReconciliation,
  submitReconciliation,
  confirmReconciliation,
  disputeReconciliation,
  getReconciliations,
  getDelivererCashBalance
};
