/**
 * @file deliveryAssignmentService.js
 * @description Service d'assignation des livreurs aux commandes.
 * Implémente le matching par proximité géographique avec rounds d'assignation.
 * 
 * Algorithme :
 * 1. Trouver les N livreurs les plus proches du marchand (online, KYC validé)
 * 2. Proposer la course au plus proche
 * 3. Si rejet/expiration (60s), passer au suivant
 * 4. Max 3 rounds, puis notification admin
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');
const { calculateDistanceMatrix } = require('./osrmService');

// ============================================================================
// CONSTANTES
// ============================================================================

const ASSIGNMENT_TIMEOUT_SECONDS = 60;
const MAX_ASSIGNMENT_ROUNDS = 3;
const MAX_DELIVERERS_PER_ROUND = 5;
const SEARCH_RADIUS_KM = 5;
const EXPANDED_SEARCH_RADIUS_KM = 10;

const ASSIGNMENT_STATUS = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled'
};

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Recherche et propose la course au livreur le plus proche.
 * Crée une entrée dans delivery_assignments avec expiration de 60s.
 *
 * @param {string} orderId - UUID de la commande
 * @param {Object} merchantLocation - {latitude, longitude} du marchand
 * @param {number} [round=1] - Numéro du round d'assignation
 * @returns {Promise<Object>} Assignation créée ou null si aucun livreur disponible
 */
async function proposeDelivery(orderId, merchantLocation, round = 1) {
  try {
    // 1. Vérifier que la commande existe et est assignable
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, status, delivery_id, merchant_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    if (order.delivery_id) {
      return { message: 'Order already has a deliverer assigned', assignment: null };
    }

    if (!['accepted', 'ready'].includes(order.status)) {
      const err = new Error(`Order is not ready for delivery assignment. Status: ${order.status}`);
      err.statusCode = 409;
      throw err;
    }

    // 2. Récupérer les livreurs déjà sollicités pour cette commande
    const { data: previousAssignments } = await supabaseAdmin
      .from('delivery_assignments')
      .select('deliverer_id')
      .eq('order_id', orderId)
      .in('status', [ASSIGNMENT_STATUS.REJECTED, ASSIGNMENT_STATUS.EXPIRED]);

    const excludedDelivererIds = (previousAssignments || []).map(a => a.deliverer_id);

    // 3. Trouver les livreurs disponibles les plus proches
    const searchRadius = round > 1 ? EXPANDED_SEARCH_RADIUS_KM : SEARCH_RADIUS_KM;

    const { data: nearbyDeliverers, error: geoError } = await supabaseAdmin
      .rpc('find_nearest_deliverers', {
        p_latitude: merchantLocation.latitude,
        p_longitude: merchantLocation.longitude,
        p_radius_km: searchRadius,
        p_limit: MAX_DELIVERERS_PER_ROUND * 2
      });

    if (geoError) {
      throw new Error(`Geo query failed: ${geoError.message}`);
    }

    if (!nearbyDeliverers || nearbyDeliverers.length === 0) {
      return {
        message: 'No deliverers available in the area',
        assignment: null,
        round
      };
    }

    // 4. Filtrer les livreurs déjà sollicités
    const eligibleDeliverers = nearbyDeliverers.filter(
      d => !excludedDelivererIds.includes(d.deliverer_id)
    );

    if (eligibleDeliverers.length === 0) {
      return {
        message: 'All nearby deliverers have been contacted',
        assignment: null,
        round
      };
    }

    // 5. Vérifier le KYC des livreurs éligibles
    const delivererIds = eligibleDeliverers.slice(0, MAX_DELIVERERS_PER_ROUND).map(d => d.deliverer_id);

    const { data: profiles } = await supabaseAdmin
      .from('profiles_data')
      .select('user_id, kyc_status, role')
      .in('user_id', delivererIds)
      .eq('role', 'deliverer')
      .eq('kyc_status', 'approved');

    const approvedDelivererIds = (profiles || []).map(p => p.user_id);

    const validDeliverers = eligibleDeliverers.filter(
      d => approvedDelivererIds.includes(d.deliverer_id)
    );

    if (validDeliverers.length === 0) {
      return {
        message: 'No KYC-approved deliverers available',
        assignment: null,
        round
      };
    }

    // 6. Sélectionner le livreur le plus proche
    const selectedDeliverer = validDeliverers[0];
    const distanceToMerchant = selectedDeliverer.distance_meters / 1000; // Convertir en km
    const estimatedPickupTime = Math.ceil((distanceToMerchant / 20) * 60); // ~20 km/h en ville

    // 7. Créer l'assignation
    const expiresAt = new Date(Date.now() + ASSIGNMENT_TIMEOUT_SECONDS * 1000).toISOString();

    const { data: assignment, error: insertError } = await supabaseAdmin
      .from('delivery_assignments')
      .insert({
        order_id: orderId,
        deliverer_id: selectedDeliverer.deliverer_id,
        status: ASSIGNMENT_STATUS.PROPOSED,
        distance_to_merchant: Math.round(distanceToMerchant * 100) / 100,
        estimated_pickup_time: estimatedPickupTime,
        expires_at: expiresAt,
        assignment_round: round
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to create assignment: ${insertError.message}`);
    }

    // 8. Audit trail
    await logAuditEvent({
      userId: selectedDeliverer.deliverer_id,
      actionType: 'delivery_proposed',
      entityType: 'delivery_assignment',
      entityId: assignment.id,
      newValue: {
        order_id: orderId,
        deliverer_id: selectedDeliverer.deliverer_id,
        distance_km: distanceToMerchant,
        round
      }
    });

    return {
      assignment,
      deliverer: {
        id: selectedDeliverer.deliverer_id,
        distance_km: Math.round(distanceToMerchant * 100) / 100,
        estimated_pickup_minutes: estimatedPickupTime
      },
      round,
      expires_at: expiresAt
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`proposeDelivery failed: ${err.message}`);
  }
}

/**
 * Le livreur accepte une assignation de livraison.
 * Met à jour l'assignation, la commande et la disponibilité du livreur.
 *
 * @param {string} assignmentId - UUID de l'assignation
 * @param {string} delivererId - UUID du livreur
 * @returns {Promise<Object>} Assignation mise à jour
 */
async function acceptAssignment(assignmentId, delivererId) {
  try {
    // 1. Récupérer l'assignation
    const { data: assignment, error: fetchError } = await supabaseAdmin
      .from('delivery_assignments')
      .select('*')
      .eq('id', assignmentId)
      .eq('deliverer_id', delivererId)
      .single();

    if (fetchError || !assignment) {
      const err = new Error('Assignment not found or not yours');
      err.statusCode = 404;
      throw err;
    }

    // 2. Vérifier que l'assignation est encore valide
    if (assignment.status !== ASSIGNMENT_STATUS.PROPOSED) {
      const err = new Error(`Assignment is no longer available. Status: ${assignment.status}`);
      err.statusCode = 409;
      throw err;
    }

    if (new Date(assignment.expires_at) < new Date()) {
      // Marquer comme expirée
      await supabaseAdmin
        .from('delivery_assignments')
        .update({ status: ASSIGNMENT_STATUS.EXPIRED })
        .eq('id', assignmentId);

      const err = new Error('Assignment has expired');
      err.statusCode = 410;
      throw err;
    }

    // 3. Vérifier que la commande n'a pas déjà un livreur
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('id, delivery_id, status')
      .eq('id', assignment.order_id)
      .single();

    if (order?.delivery_id) {
      const err = new Error('Order already has a deliverer assigned');
      err.statusCode = 409;
      throw err;
    }

    // 4. Mettre à jour l'assignation
    const { data: updatedAssignment, error: updateError } = await supabaseAdmin
      .from('delivery_assignments')
      .update({
        status: ASSIGNMENT_STATUS.ACCEPTED,
        responded_at: new Date().toISOString()
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update assignment: ${updateError.message}`);
    }

    // 5. Assigner le livreur à la commande
    await supabaseAdmin
      .from('orders')
      .update({ delivery_id: delivererId })
      .eq('id', assignment.order_id);

    // 6. Mettre à jour la disponibilité du livreur
    await supabaseAdmin
      .from('deliverer_locations')
      .update({
        availability: 'busy',
        current_order_id: assignment.order_id
      })
      .eq('deliverer_id', delivererId);

    // 7. Annuler les autres assignations en cours pour cette commande
    await supabaseAdmin
      .from('delivery_assignments')
      .update({ status: ASSIGNMENT_STATUS.CANCELLED })
      .eq('order_id', assignment.order_id)
      .eq('status', ASSIGNMENT_STATUS.PROPOSED)
      .neq('id', assignmentId);

    // 8. Audit trail
    await logAuditEvent({
      userId: delivererId,
      actionType: 'delivery_accepted',
      entityType: 'delivery_assignment',
      entityId: assignmentId,
      newValue: { order_id: assignment.order_id }
    });

    return {
      assignment: updatedAssignment,
      order_id: assignment.order_id,
      message: 'Delivery assignment accepted'
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`acceptAssignment failed: ${err.message}`);
  }
}

/**
 * Le livreur rejette une assignation de livraison.
 *
 * @param {string} assignmentId - UUID de l'assignation
 * @param {string} delivererId - UUID du livreur
 * @param {string} [reason] - Raison du rejet (optionnel)
 * @returns {Promise<Object>} Résultat du rejet
 */
async function rejectAssignment(assignmentId, delivererId, reason = null) {
  try {
    // 1. Récupérer l'assignation
    const { data: assignment, error: fetchError } = await supabaseAdmin
      .from('delivery_assignments')
      .select('*')
      .eq('id', assignmentId)
      .eq('deliverer_id', delivererId)
      .single();

    if (fetchError || !assignment) {
      const err = new Error('Assignment not found or not yours');
      err.statusCode = 404;
      throw err;
    }

    if (assignment.status !== ASSIGNMENT_STATUS.PROPOSED) {
      const err = new Error(`Assignment cannot be rejected. Status: ${assignment.status}`);
      err.statusCode = 409;
      throw err;
    }

    // 2. Mettre à jour l'assignation
    const { data: updatedAssignment, error: updateError } = await supabaseAdmin
      .from('delivery_assignments')
      .update({
        status: ASSIGNMENT_STATUS.REJECTED,
        responded_at: new Date().toISOString(),
        rejection_reason: reason
      })
      .eq('id', assignmentId)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to reject assignment: ${updateError.message}`);
    }

    // 3. Audit trail
    await logAuditEvent({
      userId: delivererId,
      actionType: 'delivery_rejected',
      entityType: 'delivery_assignment',
      entityId: assignmentId,
      newValue: { order_id: assignment.order_id, reason }
    });

    // 4. Tenter le round suivant si possible
    let nextRoundResult = null;
    if (assignment.assignment_round < MAX_ASSIGNMENT_ROUNDS) {
      // Récupérer les coordonnées du marchand depuis la commande
      const { data: order } = await supabaseAdmin
        .from('orders')
        .select('merchant_latitude, merchant_longitude')
        .eq('id', assignment.order_id)
        .single();

      if (order?.merchant_latitude && order?.merchant_longitude) {
        nextRoundResult = await proposeDelivery(
          assignment.order_id,
          { latitude: order.merchant_latitude, longitude: order.merchant_longitude },
          assignment.assignment_round + 1
        );
      }
    }

    return {
      assignment: updatedAssignment,
      message: 'Assignment rejected',
      next_round: nextRoundResult
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`rejectAssignment failed: ${err.message}`);
  }
}

/**
 * Expire les assignations qui ont dépassé leur délai.
 * À appeler périodiquement (cron job ou intervalle).
 *
 * @returns {Promise<Object>} Nombre d'assignations expirées
 */
async function expireStaleAssignments() {
  try {
    const now = new Date().toISOString();

    // Trouver les assignations expirées
    const { data: expired, error } = await supabaseAdmin
      .from('delivery_assignments')
      .update({ status: ASSIGNMENT_STATUS.EXPIRED })
      .eq('status', ASSIGNMENT_STATUS.PROPOSED)
      .lt('expires_at', now)
      .select('id, order_id, deliverer_id, assignment_round');

    if (error) {
      throw new Error(`Failed to expire assignments: ${error.message}`);
    }

    // Pour chaque assignation expirée, tenter le round suivant
    const results = [];
    for (const assignment of (expired || [])) {
      if (assignment.assignment_round < MAX_ASSIGNMENT_ROUNDS) {
        const { data: order } = await supabaseAdmin
          .from('orders')
          .select('merchant_latitude, merchant_longitude, delivery_id')
          .eq('id', assignment.order_id)
          .single();

        // Ne pas relancer si un livreur est déjà assigné
        if (order && !order.delivery_id && order.merchant_latitude) {
          const nextRound = await proposeDelivery(
            assignment.order_id,
            { latitude: order.merchant_latitude, longitude: order.merchant_longitude },
            assignment.assignment_round + 1
          );
          results.push(nextRound);
        }
      }
    }

    return {
      expired_count: (expired || []).length,
      next_rounds_initiated: results.filter(r => r.assignment).length
    };
  } catch (err) {
    throw new Error(`expireStaleAssignments failed: ${err.message}`);
  }
}

/**
 * Récupère les assignations actives d'un livreur.
 *
 * @param {string} delivererId - UUID du livreur
 * @returns {Promise<Array>} Liste des assignations proposées
 */
async function getActiveAssignments(delivererId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('delivery_assignments')
      .select(`
        *,
        orders:order_id (
          id, status, food_amount, delivery_fee, total_amount,
          delivery_address, merchant_latitude, merchant_longitude,
          delivery_latitude, delivery_longitude
        )
      `)
      .eq('deliverer_id', delivererId)
      .eq('status', ASSIGNMENT_STATUS.PROPOSED)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch active assignments: ${error.message}`);
    }

    return data || [];
  } catch (err) {
    throw new Error(`getActiveAssignments failed: ${err.message}`);
  }
}

module.exports = {
  proposeDelivery,
  acceptAssignment,
  rejectAssignment,
  expireStaleAssignments,
  getActiveAssignments,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_TIMEOUT_SECONDS,
  MAX_ASSIGNMENT_ROUNDS
};
