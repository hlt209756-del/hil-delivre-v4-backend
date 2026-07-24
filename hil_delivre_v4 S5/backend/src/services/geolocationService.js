/**
 * @file geolocationService.js
 * @description Service de géolocalisation et tracking en temps réel.
 * Gère la mise à jour de la position des livreurs, le suivi de livraison
 * et les événements de tracking.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');

// ============================================================================
// CONSTANTES
// ============================================================================

const TRACKING_EVENTS = {
  LOCATION_UPDATE: 'location_update',
  PICKUP_STARTED: 'pickup_started',
  ARRIVED_AT_MERCHANT: 'arrived_at_merchant',
  ORDER_PICKED_UP: 'order_picked_up',
  DELIVERY_STARTED: 'delivery_started',
  ARRIVED_AT_CLIENT: 'arrived_at_client',
  ORDER_DELIVERED: 'order_delivered',
  DELIVERY_ISSUE: 'delivery_issue'
};

// Seuil de détection d'arrivée (mètres)
const ARRIVAL_THRESHOLD_METERS = 100;

// Intervalle minimum entre deux mises à jour de position (secondes)
const MIN_UPDATE_INTERVAL_SECONDS = 5;

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Met à jour la position GPS d'un livreur.
 * Inclut la validation des coordonnées et le throttling.
 *
 * @param {string} delivererId - UUID du livreur
 * @param {Object} location - {latitude, longitude, heading, speed, accuracy}
 * @returns {Promise<Object>} Position mise à jour
 */
async function updateDelivererLocation(delivererId, location) {
  try {
    const { latitude, longitude, heading, speed, accuracy } = location;

    // Validation des coordonnées
    if (!latitude || !longitude || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      const err = new Error('Invalid GPS coordinates');
      err.statusCode = 400;
      throw err;
    }

    // Vérifier le throttling (pas plus d'une mise à jour toutes les 5 secondes)
    const { data: existing } = await supabaseAdmin
      .from('deliverer_locations')
      .select('last_updated_at')
      .eq('deliverer_id', delivererId)
      .single();

    if (existing) {
      const lastUpdate = new Date(existing.last_updated_at);
      const elapsed = (Date.now() - lastUpdate.getTime()) / 1000;

      if (elapsed < MIN_UPDATE_INTERVAL_SECONDS) {
        return { throttled: true, message: 'Update too frequent' };
      }
    }

    // Upsert la position
    const { data, error } = await supabaseAdmin
      .from('deliverer_locations')
      .upsert({
        deliverer_id: delivererId,
        latitude,
        longitude,
        heading: heading || null,
        speed: speed || null,
        accuracy: accuracy || null
      }, {
        onConflict: 'deliverer_id'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update location: ${error.message}`);
    }

    return { location: data, throttled: false };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`updateDelivererLocation failed: ${err.message}`);
  }
}

/**
 * Met à jour le statut de disponibilité d'un livreur.
 *
 * @param {string} delivererId - UUID du livreur
 * @param {string} availability - 'online', 'busy', 'offline'
 * @returns {Promise<Object>} Statut mis à jour
 */
async function updateAvailability(delivererId, availability) {
  try {
    const validStatuses = ['online', 'busy', 'offline'];
    if (!validStatuses.includes(availability)) {
      const err = new Error(`Invalid availability status. Must be one of: ${validStatuses.join(', ')}`);
      err.statusCode = 400;
      throw err;
    }

    const { data, error } = await supabaseAdmin
      .from('deliverer_locations')
      .upsert({
        deliverer_id: delivererId,
        availability,
        // Si passage en offline, réinitialiser la commande en cours
        current_order_id: availability === 'offline' ? null : undefined
      }, {
        onConflict: 'deliverer_id'
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update availability: ${error.message}`);
    }

    // Audit trail
    await logAuditEvent({
      userId: delivererId,
      actionType: 'deliverer_availability_changed',
      entityType: 'deliverer_location',
      entityId: data.id,
      newValue: { availability }
    });

    return data;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`updateAvailability failed: ${err.message}`);
  }
}

/**
 * Enregistre un événement de tracking pour une livraison.
 *
 * @param {string} orderId - UUID de la commande
 * @param {string} delivererId - UUID du livreur
 * @param {string} eventType - Type d'événement (voir TRACKING_EVENTS)
 * @param {Object} [location] - Position GPS optionnelle
 * @param {Object} [metadata] - Données supplémentaires
 * @returns {Promise<Object>} Événement créé
 */
async function recordTrackingEvent(orderId, delivererId, eventType, location = null, metadata = {}) {
  try {
    // Vérifier que le livreur est bien assigné à cette commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, delivery_id, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    if (order.delivery_id !== delivererId) {
      const err = new Error('You are not the deliverer for this order');
      err.statusCode = 403;
      throw err;
    }

    // Créer l'événement
    const { data: event, error: insertError } = await supabaseAdmin
      .from('delivery_tracking_events')
      .insert({
        order_id: orderId,
        deliverer_id: delivererId,
        event_type: eventType,
        latitude: location?.latitude || null,
        longitude: location?.longitude || null,
        metadata: {
          ...metadata,
          accuracy: location?.accuracy || null,
          speed: location?.speed || null,
          timestamp: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to record tracking event: ${insertError.message}`);
    }

    // Mettre à jour le statut de la commande selon l'événement
    await handleEventSideEffects(orderId, delivererId, eventType);

    return event;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`recordTrackingEvent failed: ${err.message}`);
  }
}

/**
 * Gère les effets de bord des événements de tracking.
 * Met à jour le statut de la commande et les timestamps.
 *
 * @param {string} orderId
 * @param {string} delivererId
 * @param {string} eventType
 */
async function handleEventSideEffects(orderId, delivererId, eventType) {
  try {
    switch (eventType) {
      case TRACKING_EVENTS.ORDER_PICKED_UP:
        await supabaseAdmin
          .from('orders')
          .update({
            status: 'picked_up',
            picked_up_at: new Date().toISOString()
          })
          .eq('id', orderId)
          .in('status', ['ready', 'accepted']);
        break;

      case TRACKING_EVENTS.DELIVERY_STARTED:
        await supabaseAdmin
          .from('orders')
          .update({ status: 'in_delivery' })
          .eq('id', orderId)
          .eq('status', 'picked_up');
        break;

      case TRACKING_EVENTS.ORDER_DELIVERED:
        await supabaseAdmin
          .from('orders')
          .update({
            status: 'delivered',
            delivered_at: new Date().toISOString()
          })
          .eq('id', orderId)
          .eq('status', 'in_delivery');

        // Libérer le livreur
        await supabaseAdmin
          .from('deliverer_locations')
          .update({
            availability: 'online',
            current_order_id: null
          })
          .eq('deliverer_id', delivererId);
        break;

      default:
        // Pas d'effet de bord pour les autres événements
        break;
    }
  } catch (err) {
    // Logger mais ne pas bloquer l'événement de tracking
    console.error(`[TRACKING] Side effect error for ${eventType}: ${err.message}`);
  }
}

/**
 * Récupère l'historique de tracking d'une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID de l'utilisateur demandant
 * @returns {Promise<Array>} Liste des événements de tracking
 */
async function getTrackingHistory(orderId, userId) {
  try {
    // Vérifier l'accès
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, client_id, merchant_id, delivery_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    const isParty = [order.client_id, order.merchant_id, order.delivery_id].includes(userId);
    if (!isParty) {
      const { data: profile } = await supabaseAdmin
        .from('profiles_data')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (!profile || profile.role !== 'admin') {
        const err = new Error('Unauthorized access to tracking data');
        err.statusCode = 403;
        throw err;
      }
    }

    // Récupérer les événements
    const { data: events, error } = await supabaseAdmin
      .from('delivery_tracking_events')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch tracking history: ${error.message}`);
    }

    return events || [];
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`getTrackingHistory failed: ${err.message}`);
  }
}

/**
 * Récupère la position actuelle du livreur d'une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID de l'utilisateur demandant
 * @returns {Promise<Object|null>} Position du livreur ou null
 */
async function getDelivererPosition(orderId, userId) {
  try {
    // Vérifier l'accès et récupérer la commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, client_id, merchant_id, delivery_id, status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    // Seules les parties de la commande peuvent voir la position
    const isParty = [order.client_id, order.merchant_id].includes(userId);
    if (!isParty) {
      const err = new Error('Unauthorized');
      err.statusCode = 403;
      throw err;
    }

    // La position n'est disponible que pendant la livraison active
    if (!['ready', 'picked_up', 'in_delivery'].includes(order.status)) {
      return null;
    }

    if (!order.delivery_id) {
      return null;
    }

    // Récupérer la position du livreur
    const { data: location, error: locError } = await supabaseAdmin
      .from('deliverer_locations')
      .select('latitude, longitude, heading, speed, last_updated_at')
      .eq('deliverer_id', order.delivery_id)
      .single();

    if (locError || !location) {
      return null;
    }

    // Vérifier que la position est récente (< 5 minutes)
    const lastUpdate = new Date(location.last_updated_at);
    const ageMinutes = (Date.now() - lastUpdate.getTime()) / (1000 * 60);

    return {
      ...location,
      deliverer_id: order.delivery_id,
      is_stale: ageMinutes > 2,
      age_seconds: Math.floor((Date.now() - lastUpdate.getTime()) / 1000)
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`getDelivererPosition failed: ${err.message}`);
  }
}

module.exports = {
  updateDelivererLocation,
  updateAvailability,
  recordTrackingEvent,
  getTrackingHistory,
  getDelivererPosition,
  TRACKING_EVENTS,
  ARRIVAL_THRESHOLD_METERS
};
