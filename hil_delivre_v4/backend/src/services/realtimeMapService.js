const { v4: uuidv4 } = require("uuid");

// Placeholder for Socket.IO server instance
const io = {
    to: (room) => ({
        emit: (event, data) => {
            console.log(`Socket.IO: Emitting to room ${room}, event: ${event}, data:`, data);
        },
    }),
    sockets: {
        adapter: {
            sids: new Map(), // Map<socketId, Set<room>>
            rooms: new Map(), // Map<room, Set<socketId>>
        },
        sockets: new Map(), // Map<socketId, socketObject>
    },
};

// Placeholder for cacheService (e.g., Redis)
const cacheService = {
    get: async (key) => {
        console.log(`CacheService: Getting ${key}`);
        return null; // Simulate cache miss
    },
    set: async (key, value, ttl) => {
        console.log(`CacheService: Setting ${key} with TTL ${ttl}`);
        return "OK";
    },
    del: async (key) => {
        console.log(`CacheService: Deleting ${key}`);
        return 1;
    },
};

const DELIVERER_OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const THROTTLE_EMIT_MS = 1000; // Max 1 update per second per client
const MIN_MOVE_DISTANCE_METERS = 20; // Minimum distance to trigger an update
const GRID_CELL_SIZE_METERS = 500; // Size of grid cells for clustering

class RealtimeMapService {
    constructor() {
        /**
         * Stocke les positions actuelles des livreurs.
         * @type {Map<string, {lat: number, lng: number, status: string, lastUpdate: number}>}
         */
        this.delivererPositions = new Map();
        /**
         * Stocke le dernier horodatage d'émission par socketId pour le throttling.
         * @type {Map<string, number>}
         */
        this.lastEmitTimestamp = new Map();
        /**
         * Stocke les dernières positions envoyées par socketId pour les delta updates.
         * @type {Map<string, {lat: number, lng: number}>}
         */
        this.lastSentPositions = new Map();

        // Cleanup interval for offline deliverers
        setInterval(() => this._cleanupOfflineDeliverers(), DELIVERER_OFFLINE_THRESHOLD_MS / 2);
    }

    /**
     * Calcule la distance Haversine entre deux points géographiques.
     * @param {{lat: number, lng: number}} p1 - Premier point (latitude, longitude).
     * @param {{lat: number, lng: number}} p2 - Deuxième point (latitude, longitude).
     * @returns {number} Distance en mètres.
     * @private
     */
    _haversineDistance(p1, p2) {
        const R = 6371e3; // Rayon de la Terre en mètres
        const φ1 = p1.lat * Math.PI / 180; // φ, λ en radians
        const φ2 = p2.lat * Math.PI / 180;
        const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
        const Δλ = (p2.lng - p1.lng) * Math.PI / 180;

        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                  Math.cos(φ1) * Math.cos(φ2) *
                  Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c; // Distance en mètres
    }

    /**
     * Génère un identifiant de cellule de grille pour le clustering.
     * @param {number} lat - Latitude.
     * @param {number} lng - Longitude.
     * @returns {string} Identifiant unique de la cellule de grille.
     * @private
     */
    _getGridCellId(lat, lng) {
        // Simple grid-based clustering: divide the world into cells
        const latGrid = Math.floor(lat / (GRID_CELL_SIZE_METERS / 111111)); // Approx 111.111m per degree lat
        const lngGrid = Math.floor(lng / (GRID_CELL_SIZE_METERS / (111111 * Math.cos(lat * Math.PI / 180)))); // Adjust for longitude
        return `grid:${latGrid}:${lngGrid}`;
    }

    /**
     * Met à jour la position d'un livreur.
     * @param {string} delivererId - ID du livreur.
     * @param {number} lat - Nouvelle latitude.
     * @param {number} lng - Nouvelle longitude.
     * @param {string} status - Statut du livreur (e.g., 'online', 'delivering').
     */
    async updateDelivererLocation(delivererId, lat, lng, status = 'online') {
        const now = Date.now();
        const oldPosition = this.delivererPositions.get(delivererId);

        if (oldPosition) {
            const distance = this._haversineDistance(oldPosition, { lat, lng });
            if (distance < MIN_MOVE_DISTANCE_METERS && status === oldPosition.status) {
                // Skip update if movement is too small and status hasn't changed
                return;
            }
        }

        const newPosition = { lat, lng, status, lastUpdate: now };
        this.delivererPositions.set(delivererId, newPosition);

        // Potentially update cache (e.g., Redis for persistence or other services)
        await cacheService.set(`deliverer:${delivererId}:location`, newPosition, DELIVERER_OFFLINE_THRESHOLD_MS / 1000 * 2); // Keep in cache for longer than offline threshold

        // Notify relevant clients
        this._emitDelivererUpdate(delivererId, newPosition);
    }

    /**
     * Émet les mises à jour de position des livreurs aux clients pertinents.
     * @param {string} delivererId - ID du livreur.
     * @param {{lat: number, lng: number, status: string}} position - Nouvelle position et statut.
     * @private
     */
    _emitDelivererUpdate(delivererId, position) {
        // Get all sockets that are interested in map updates
        // In a real Socket.IO setup, you'd iterate through rooms or specific client subscriptions
        io.sockets.sockets.forEach((socket, socketId) => {
            const lastEmit = this.lastEmitTimestamp.get(socketId) || 0;
            if (now - lastEmit < THROTTLE_EMIT_MS) {
                return; // Throttle: skip if emitted too recently
            }

            const lastSent = this.lastSentPositions.get(socketId + ':' + delivererId);
            if (lastSent && this._haversineDistance(lastSent, position) < MIN_MOVE_DISTANCE_METERS) {
                return; // Delta update: skip if position hasn't changed significantly for this client
            }

            // Determine if the deliverer is within the client's viewport
            // This would require the client to send its viewport bounds to the server
            // For now, we'll assume all connected clients are interested.
            // A more robust solution would involve rooms like 'map:viewport:{bounds_hash}'
            io.to(socketId).emit('delivererLocationUpdate', { delivererId, ...position });
            this.lastEmitTimestamp.set(socketId, now);
            this.lastSentPositions.set(socketId + ':' + delivererId, { lat: position.lat, lng: position.lng });
        });
    }

    /**
     * Gère la connexion d'un client Socket.IO à la carte en temps réel.
     * @param {object} socket - L'objet socket du client.
     * @param {{northEast: {lat: number, lng: number}, southWest: {lat: number, lng: number}}} viewportBounds - Les limites de la fenêtre d'affichage du client.
     */
    async handleClientConnect(socket, viewportBounds) {
        console.log(`Client ${socket.id} connected to realtime map with viewport:`, viewportBounds);
        // Join a room based on viewport bounds for efficient filtering
        const boundsHash = this._getBoundsHash(viewportBounds);
        socket.join(`map:viewport:${boundsHash}`);

        // Send initial set of deliverers within the viewport
        const deliverersInView = this.getDeliverersInViewport(viewportBounds);
        socket.emit('initialDelivererLocations', deliverersInView);
    }

    /**
     * Gère la déconnexion d'un client Socket.IO.
     * @param {string} socketId - L'ID du socket client.
     */
    handleClientDisconnect(socketId) {
        console.log(`Client ${socketId} disconnected from realtime map.`);
        this.lastEmitTimestamp.delete(socketId);
        // Clean up lastSentPositions for this socketId
        for (const key of this.lastSentPositions.keys()) {
            if (key.startsWith(socketId + ':')) {
                this.lastSentPositions.delete(key);
            }
        }
    }

    /**
     * Récupère les livreurs actuellement dans une zone d'affichage donnée.
     * @param {{northEast: {lat: number, lng: number}, southWest: {lat: number, lng: number}}} viewportBounds - Les limites de la fenêtre d'affichage.
     * @returns {Array<object>} Liste des livreurs dans la zone d'affichage.
     */
    getDeliverersInViewport(viewportBounds) {
        const { northEast, southWest } = viewportBounds;
        const deliverers = [];
        for (const [id, position] of this.delivererPositions.entries()) {
            if (position.lat <= northEast.lat && position.lat >= southWest.lat &&
                position.lng <= northEast.lng && position.lng >= southWest.lng) {
                deliverers.push({ id, ...position });
            }
        }
        return deliverers;
    }

    /**
     * Nettoie les livreurs qui n'ont pas mis à jour leur position depuis un certain temps.
     * @private
     */
    _cleanupOfflineDeliverers() {
        const now = Date.now();
        for (const [delivererId, position] of this.delivererPositions.entries()) {
            if (now - position.lastUpdate > DELIVERER_OFFLINE_THRESHOLD_MS) {
                console.log(`Deliverer ${delivererId} is offline, removing from map.`);
                this.delivererPositions.delete(delivererId);
                cacheService.del(`deliverer:${delivererId}:location`);
                // Notify clients that this deliverer is offline
                io.to('map:all').emit('delivererOffline', { delivererId }); // Assuming a general map room
            }
        }
    }

    /**
     * Génère un hash pour les limites de la fenêtre d'affichage.
     * Utile pour les noms de rooms Socket.IO.
     * @param {{northEast: {lat: number, lng: number}, southWest: {lat: number, lng: number}}} viewportBounds - Les limites de la fenêtre d'affichage.
     * @returns {string} Hash des limites.
     * @private
     */
    _getBoundsHash(viewportBounds) {
        // A simple hash for demonstration. In production, consider a more robust hashing or geohashing library.
        const { northEast, southWest } = viewportBounds;
        return `${northEast.lat.toFixed(2)}_${northEast.lng.toFixed(2)}_${southWest.lat.toFixed(2)}_${southWest.lng.toFixed(2)}`;
    }
}

module.exports = new RealtimeMapService();
