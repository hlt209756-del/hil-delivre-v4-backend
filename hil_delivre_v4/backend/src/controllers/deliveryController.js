/**
 * @file deliveryController.js
 * @description Contrôleur des endpoints de livraison (Sprint 5).
 * Gère l'estimation des frais, l'assignation, le tracking et la géolocalisation.
 */

'use strict';

const osrmService = require('../services/osrmService');
const deliveryFeeService = require('../services/deliveryFeeService');
const assignmentService = require('../services/deliveryAssignmentService');
const geolocationService = require('../services/geolocationService');
const { success, error: errorResponse } = require('../utils/responseHelper');

// ============================================================================
// CONTRÔLEURS — ESTIMATION & FRAIS
// ============================================================================

/**
 * POST /api/delivery/estimate
 * Estime les frais de livraison entre un marchand et un point de livraison.
 * Utilisé par le client avant de passer commande.
 */
async function estimateDeliveryFee(req, res) {
  try {
    const { merchant_latitude, merchant_longitude, delivery_latitude, delivery_longitude } = req.body;

    // Calculer la route via OSRM
    const route = await osrmService.calculateRoute(
      { latitude: merchant_latitude, longitude: merchant_longitude },
      { latitude: delivery_latitude, longitude: delivery_longitude }
    );

    // Estimer les frais
    const estimate = await deliveryFeeService.estimateDeliveryFee(route.distance_km);

    return res.status(200).json(
      success({
        ...estimate,
        distance_km: route.distance_km,
        estimated_duration_minutes: route.duration_minutes,
        route_source: route.source
      }, 'Delivery fee estimated')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to estimate delivery fee' : err.message,
        statusCode
      )
    );
  }
}

/**
 * POST /api/delivery/calculate
 * Calcule les frais de livraison définitifs pour une commande.
 * Inclut le surge pricing actif.
 */
async function calculateDeliveryFee(req, res) {
  try {
    const { merchant_latitude, merchant_longitude, delivery_latitude, delivery_longitude } = req.body;

    // Calculer la route via OSRM
    const route = await osrmService.calculateRoute(
      { latitude: merchant_latitude, longitude: merchant_longitude },
      { latitude: delivery_latitude, longitude: delivery_longitude }
    );

    // Calculer les frais avec surge
    const fees = await deliveryFeeService.calculateDeliveryFee(route.distance_km);

    return res.status(200).json(
      success({
        ...fees,
        distance_km: route.distance_km,
        estimated_duration_minutes: route.duration_minutes,
        route_geometry: route.route_geometry,
        route_source: route.source
      }, 'Delivery fee calculated')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to calculate delivery fee' : err.message,
        statusCode
      )
    );
  }
}

// ============================================================================
// CONTRÔLEURS — ASSIGNATION
// ============================================================================

/**
 * POST /api/delivery/assign
 * Initie l'assignation d'un livreur à une commande.
 * Appelé automatiquement quand la commande passe en statut 'accepted' ou 'ready'.
 */
async function assignDeliverer(req, res) {
  try {
    const { order_id, merchant_latitude, merchant_longitude } = req.body;

    const result = await assignmentService.proposeDelivery(
      order_id,
      { latitude: merchant_latitude, longitude: merchant_longitude }
    );

    const statusCode = result.assignment ? 201 : 200;
    return res.status(statusCode).json(
      success(result, result.assignment ? 'Delivery proposed to nearest deliverer' : result.message)
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to assign deliverer' : err.message,
        statusCode
      )
    );
  }
}

/**
 * POST /api/delivery/assignments/:assignmentId/accept
 * Le livreur accepte une proposition de livraison.
 */
async function acceptAssignment(req, res) {
  try {
    const { assignmentId } = req.params;
    const delivererId = req.user.id;

    const result = await assignmentService.acceptAssignment(assignmentId, delivererId);

    return res.status(200).json(
      success(result, 'Assignment accepted')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to accept assignment' : err.message,
        statusCode
      )
    );
  }
}

/**
 * POST /api/delivery/assignments/:assignmentId/reject
 * Le livreur rejette une proposition de livraison.
 */
async function rejectAssignment(req, res) {
  try {
    const { assignmentId } = req.params;
    const delivererId = req.user.id;
    const { reason } = req.body;

    const result = await assignmentService.rejectAssignment(assignmentId, delivererId, reason);

    return res.status(200).json(
      success(result, 'Assignment rejected')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to reject assignment' : err.message,
        statusCode
      )
    );
  }
}

/**
 * GET /api/delivery/assignments/active
 * Récupère les assignations actives (proposées) pour le livreur connecté.
 */
async function getActiveAssignments(req, res) {
  try {
    const delivererId = req.user.id;
    const assignments = await assignmentService.getActiveAssignments(delivererId);

    return res.status(200).json(
      success(assignments, 'Active assignments retrieved')
    );
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to retrieve active assignments')
    );
  }
}

// ============================================================================
// CONTRÔLEURS — GÉOLOCALISATION & TRACKING
// ============================================================================

/**
 * PUT /api/delivery/location
 * Met à jour la position GPS du livreur connecté.
 */
async function updateLocation(req, res) {
  try {
    const delivererId = req.user.id;
    const { latitude, longitude, heading, speed, accuracy } = req.body;

    const result = await geolocationService.updateDelivererLocation(delivererId, {
      latitude, longitude, heading, speed, accuracy
    });

    if (result.throttled) {
      return res.status(429).json(
        errorResponse('Location update too frequent. Wait a few seconds.', 429)
      );
    }

    return res.status(200).json(
      success(result.location, 'Location updated')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to update location' : err.message,
        statusCode
      )
    );
  }
}

/**
 * PUT /api/delivery/availability
 * Met à jour le statut de disponibilité du livreur.
 */
async function updateAvailability(req, res) {
  try {
    const delivererId = req.user.id;
    const { availability } = req.body;

    const result = await geolocationService.updateAvailability(delivererId, availability);

    return res.status(200).json(
      success(result, `Availability set to ${availability}`)
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to update availability' : err.message,
        statusCode
      )
    );
  }
}

/**
 * POST /api/delivery/tracking/event
 * Enregistre un événement de tracking (pickup, delivery, etc.).
 */
async function recordTrackingEvent(req, res) {
  try {
    const delivererId = req.user.id;
    const { order_id, event_type, latitude, longitude, metadata } = req.body;

    const event = await geolocationService.recordTrackingEvent(
      order_id,
      delivererId,
      event_type,
      latitude && longitude ? { latitude, longitude } : null,
      metadata || {}
    );

    return res.status(201).json(
      success(event, `Tracking event "${event_type}" recorded`)
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to record tracking event' : err.message,
        statusCode
      )
    );
  }
}

/**
 * GET /api/delivery/tracking/:orderId
 * Récupère l'historique de tracking d'une commande.
 */
async function getTrackingHistory(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const events = await geolocationService.getTrackingHistory(orderId, userId);

    return res.status(200).json(
      success(events, 'Tracking history retrieved')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to retrieve tracking history' : err.message,
        statusCode
      )
    );
  }
}

/**
 * GET /api/delivery/position/:orderId
 * Récupère la position actuelle du livreur pour une commande.
 */
async function getDelivererPosition(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const position = await geolocationService.getDelivererPosition(orderId, userId);

    if (!position) {
      return res.status(200).json(
        success(null, 'Deliverer position not available')
      );
    }

    return res.status(200).json(
      success(position, 'Deliverer position retrieved')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Failed to retrieve deliverer position' : err.message,
        statusCode
      )
    );
  }
}

/**
 * GET /api/delivery/surge
 * Récupère le statut actuel du surge pricing.
 */
async function getSurgeStatus(req, res) {
  try {
    const surge = await deliveryFeeService.getCurrentSurgeMultiplier();

    return res.status(200).json(
      success(surge, 'Surge status retrieved')
    );
  } catch (err) {
    return res.status(500).json(
      errorResponse('Failed to retrieve surge status')
    );
  }
}

module.exports = {
  estimateDeliveryFee,
  calculateDeliveryFee,
  assignDeliverer,
  acceptAssignment,
  rejectAssignment,
  getActiveAssignments,
  updateLocation,
  updateAvailability,
  recordTrackingEvent,
  getTrackingHistory,
  getDelivererPosition,
  getSurgeStatus
};
