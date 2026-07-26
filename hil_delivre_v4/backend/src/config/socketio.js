/**
 * @file socketio.js
 * @description Configuration et initialisation de Socket.IO pour les communications temps réel.
 * Gère l'authentification JWT, les rooms par commande/utilisateur, et le heartbeat.
 *
 * Documentation Socket.IO : https://socket.io/docs/v4/
 */

'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('../services/supabaseService');

// ============================================================================
// CONSTANTES
// ============================================================================

const PING_INTERVAL = 25000; // 25 secondes
const PING_TIMEOUT = 10000; // 10 secondes
const MAX_BUFFER_SIZE = 1e6; // 1 MB

// ============================================================================
// INITIALISATION
// ============================================================================

let io = null;

/**
 * Initialise le serveur Socket.IO avec authentification JWT.
 *
 * @param {Object} httpServer - Instance du serveur HTTP Express
 * @returns {Object} Instance Socket.IO
 */
function initializeSocketIO(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
        : ['http://localhost:3000', 'http://localhost:19006'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: PING_INTERVAL,
    pingTimeout: PING_TIMEOUT,
    maxHttpBufferSize: MAX_BUFFER_SIZE,
    transports: ['websocket', 'polling'],
    allowEIO3: false
  });

  // Middleware d'authentification
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
        || socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication required'));
      }

      // Vérifier le JWT via Supabase
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

      if (error || !user) {
        return next(new Error('Invalid or expired token'));
      }

      // Récupérer le profil
      const { data: profile } = await supabaseAdmin
        .from('profiles_data')
        .select('role, kyc_status')
        .eq('user_id', user.id)
        .single();

      // Attacher les infos utilisateur au socket
      socket.userId = user.id;
      socket.userEmail = user.email;
      socket.userRole = profile?.role || 'client';

      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  // Gestion des connexions
  io.on('connection', async (socket) => {
    console.log(`[SOCKET] User connected: ${socket.userId} (${socket.userRole})`);

    // Rejoindre la room personnelle de l'utilisateur
    socket.join(`user:${socket.userId}`);

    // Rejoindre la room du rôle
    socket.join(`role:${socket.userRole}`);

    // Enregistrer la connexion en BDD
    await registerConnection(socket);

    // ====================================================================
    // ÉVÉNEMENTS CLIENT → SERVEUR
    // ====================================================================

    /**
     * Rejoindre la room d'une commande (pour le suivi temps réel).
     */
    socket.on('join:order', async (orderId) => {
      try {
        // Vérifier que l'utilisateur est partie de la commande
        const hasAccess = await verifyOrderAccess(socket.userId, orderId);
        if (hasAccess) {
          socket.join(`order:${orderId}`);
          socket.emit('joined:order', { orderId, success: true });
        } else {
          socket.emit('error', { message: 'Unauthorized access to order room' });
        }
      } catch (err) {
        socket.emit('error', { message: 'Failed to join order room' });
      }
    });

    /**
     * Quitter la room d'une commande.
     */
    socket.on('leave:order', (orderId) => {
      socket.leave(`order:${orderId}`);
    });

    /**
     * Le livreur envoie sa position (broadcast aux parties de la commande).
     */
    socket.on('deliverer:location', async (data) => {
      if (socket.userRole !== 'deliverer') return;

      const { orderId, latitude, longitude, heading, speed } = data;

      if (!orderId || !latitude || !longitude) return;

      // Broadcast aux membres de la room de la commande (sauf l'émetteur)
      socket.to(`order:${orderId}`).emit('deliverer:position', {
        deliverer_id: socket.userId,
        latitude,
        longitude,
        heading,
        speed,
        timestamp: Date.now()
      });
    });

    /**
     * Marquer les notifications comme lues.
     */
    socket.on('notifications:read', async (notificationIds) => {
      if (!Array.isArray(notificationIds) || notificationIds.length === 0) return;

      try {
        await supabaseAdmin
          .from('notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .in('id', notificationIds)
          .eq('user_id', socket.userId);

        socket.emit('notifications:read:ack', { ids: notificationIds });
      } catch {
        // Silencieux
      }
    });

    /**
     * Heartbeat personnalisé pour le monitoring.
     */
    socket.on('ping:custom', () => {
      socket.emit('pong:custom', { timestamp: Date.now() });
      updateLastPing(socket.id);
    });

    // ====================================================================
    // DÉCONNEXION
    // ====================================================================

    socket.on('disconnect', async (reason) => {
      console.log(`[SOCKET] User disconnected: ${socket.userId} (${reason})`);
      await unregisterConnection(socket.id);
    });
  });

  return io;
}

// ============================================================================
// FONCTIONS D'ÉMISSION (SERVEUR → CLIENT)
// ============================================================================

/**
 * Envoie une notification à un utilisateur spécifique via Socket.IO.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {string} event - Nom de l'événement
 * @param {Object} data - Données à envoyer
 */
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, {
    ...data,
    timestamp: Date.now()
  });
}

/**
 * Envoie un événement à tous les membres d'une room de commande.
 *
 * @param {string} orderId - UUID de la commande
 * @param {string} event - Nom de l'événement
 * @param {Object} data - Données à envoyer
 */
function emitToOrder(orderId, event, data) {
  if (!io) return;
  io.to(`order:${orderId}`).emit(event, {
    ...data,
    timestamp: Date.now()
  });
}

/**
 * Envoie un événement à tous les utilisateurs d'un rôle.
 *
 * @param {string} role - Rôle cible ('client', 'merchant', 'deliverer', 'admin')
 * @param {string} event - Nom de l'événement
 * @param {Object} data - Données à envoyer
 */
function emitToRole(role, event, data) {
  if (!io) return;
  io.to(`role:${role}`).emit(event, {
    ...data,
    timestamp: Date.now()
  });
}

/**
 * Broadcast global à tous les utilisateurs connectés.
 *
 * @param {string} event - Nom de l'événement
 * @param {Object} data - Données à envoyer
 */
function broadcast(event, data) {
  if (!io) return;
  io.emit(event, {
    ...data,
    timestamp: Date.now()
  });
}

/**
 * Récupère le nombre de connexions actives.
 * @returns {number}
 */
function getActiveConnectionsCount() {
  if (!io) return 0;
  return io.sockets.sockets.size;
}

// ============================================================================
// FONCTIONS INTERNES
// ============================================================================

/**
 * Vérifie qu'un utilisateur a accès à une commande.
 */
async function verifyOrderAccess(userId, orderId) {
  try {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('client_id, merchant_id, delivery_id')
      .eq('id', orderId)
      .single();

    if (!order) return false;

    // Vérifier si l'utilisateur est partie de la commande
    if ([order.client_id, order.merchant_id, order.delivery_id].includes(userId)) {
      return true;
    }

    // Vérifier si admin
    const { data: profile } = await supabaseAdmin
      .from('profiles_data')
      .select('role')
      .eq('user_id', userId)
      .single();

    return profile?.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Enregistre une connexion socket en BDD.
 */
async function registerConnection(socket) {
  try {
    await supabaseAdmin
      .from('socket_connections')
      .upsert({
        user_id: socket.userId,
        socket_id: socket.id,
        ip_address: socket.handshake.address,
        user_agent: socket.handshake.headers?.['user-agent'] || null,
        rooms: Array.from(socket.rooms)
      }, { onConflict: 'socket_id' });
  } catch {
    // Non-bloquant
  }
}

/**
 * Supprime une connexion socket de la BDD.
 */
async function unregisterConnection(socketId) {
  try {
    await supabaseAdmin
      .from('socket_connections')
      .delete()
      .eq('socket_id', socketId);
  } catch {
    // Non-bloquant
  }
}

/**
 * Met à jour le dernier ping d'un socket.
 */
async function updateLastPing(socketId) {
  try {
    await supabaseAdmin
      .from('socket_connections')
      .update({ last_ping_at: new Date().toISOString() })
      .eq('socket_id', socketId);
  } catch {
    // Non-bloquant
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  initializeSocketIO,
  emitToUser,
  emitToOrder,
  emitToRole,
  broadcast,
  getActiveConnectionsCount,
  getIO: () => io
};
