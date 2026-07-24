const client = require("prom-client");

// Register a default metrics collection
client.collectDefaultMetrics();

// Define custom metrics
const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests",
    labelNames: ["method", "route", "status_code"],
});

const ordersCreatedTotal = new client.Counter({
    name: "orders_created_total",
    help: "Total number of orders created",
});

const paymentsProcessedTotal = new client.Counter({
    name: "payments_processed_total",
    help: "Total number of payments processed",
    labelNames: ["method"],
});

const deliveriesCompletedTotal = new client.Counter({
    name: "deliveries_completed_total",
    help: "Total number of deliveries completed",
});

const errorsTotal = new client.Counter({
    name: "errors_total",
    help: "Total number of errors",
    labelNames: ["type"],
});

const notificationsSentTotal = new client.Counter({
    name: "notifications_sent_total",
    help: "Total number of notifications sent",
    labelNames: ["channel"],
});

const httpRequestDurationSeconds = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route"],
    buckets: [0.1, 0.5, 1, 1.5, 2, 5],
});

const orderCompletionDurationSeconds = new client.Histogram({
    name: "order_completion_duration_seconds",
    help: "Duration for orders to be completed in seconds",
    buckets: [60, 300, 600, 1800, 3600],
});

const deliveryDurationSeconds = new client.Histogram({
    name: "delivery_duration_seconds",
    help: "Duration for deliveries in seconds",
    buckets: [60, 300, 600, 1800],
});

const osrmRequestDurationSeconds = new client.Histogram({
    name: "osrm_request_duration_seconds",
    help: "Duration of OSRM requests in seconds",
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
});

const activeOrders = new client.Gauge({
    name: "active_orders",
    help: "Number of currently active orders",
});

const onlineDeliverers = new client.Gauge({
    name: "online_deliverers",
    help: "Number of online deliverers",
});

const connectedSockets = new client.Gauge({
    name: "connected_sockets",
    help: "Number of currently connected Socket.IO clients",
});

const cacheHitRatio = new client.Gauge({
    name: "cache_hit_ratio",
    help: "Ratio of cache hits to total cache requests",
});

const redisMemoryUsageBytes = new client.Gauge({
    name: "redis_memory_usage_bytes",
    help: "Memory usage of Redis in bytes",
});

class MetricsService {
    /**
     * Middleware Express pour collecter les métriques HTTP.
     * @param {object} req - L'objet requête Express.
     * @param {object} res - L'objet réponse Express.
     * @param {Function} next - La fonction next middleware.
     */
    metricsMiddleware(req, res, next) {
        const end = httpRequestDurationSeconds.startTimer({ method: req.method, route: req.path });

        res.on("finish", () => {
            httpRequestsTotal.inc({ method: req.method, route: req.path, status_code: res.statusCode });
            end({ status_code: res.statusCode });
        });

        next();
    }

    /**
     * Incrémente le compteur des commandes créées.
     */
    incrementOrdersCreated() {
        ordersCreatedTotal.inc();
    }

    /**
     * Incrémente le compteur des paiements traités.
     * @param {string} method - Méthode de paiement (e.g., 'card', 'cash').
     */
    incrementPaymentsProcessed(method) {
        paymentsProcessedTotal.inc({ method });
    }

    /**
     * Incrémente le compteur des livraisons terminées.
     */
    incrementDeliveriesCompleted() {
        deliveriesCompletedTotal.inc();
    }

    /**
     * Incrémente le compteur d'erreurs.
     * @param {string} type - Type d'erreur (e.g., 'database', 'api', 'validation').
     */
    incrementErrorsTotal(type) {
        errorsTotal.inc({ type });
    }

    /**
     * Incrémente le compteur des notifications envoyées.
     * @param {string} channel - Canal de notification (e.g., 'fcm', 'sms', 'email').
     */
    incrementNotificationsSent(channel) {
        notificationsSentTotal.inc({ channel });
    }

    /**
     * Enregistre la durée d'achèvement d'une commande.
     * @param {number} durationSeconds - Durée en secondes.
     */
    observeOrderCompletionDuration(durationSeconds) {
        orderCompletionDurationSeconds.observe(durationSeconds);
    }

    /**
     * Enregistre la durée d'une livraison.
     * @param {number} durationSeconds - Durée en secondes.
     */
    observeDeliveryDuration(durationSeconds) {
        deliveryDurationSeconds.observe(durationSeconds);
    }

    /**
     * Enregistre la durée d'une requête OSRM.
     * @param {number} durationSeconds - Durée en secondes.
     */
    observeOsrmRequestDuration(durationSeconds) {
        osrmRequestDurationSeconds.observe(durationSeconds);
    }

    /**
     * Définit la jauge des commandes actives.
     * @param {number} count - Nombre de commandes actives.
     */
    setActiveOrders(count) {
        activeOrders.set(count);
    }

    /**
     * Définit la jauge des livreurs en ligne.
     * @param {number} count - Nombre de livreurs en ligne.
     */
    setOnlineDeliverers(count) {
        onlineDeliverers.set(count);
    }

    /**
     * Définit la jauge des sockets connectées.
     * @param {number} count - Nombre de sockets connectées.
     */
    setConnectedSockets(count) {
        connectedSockets.set(count);
    }

    /**
     * Définit la jauge du ratio de hits du cache.
     * @param {number} ratio - Ratio de hits du cache (entre 0 et 1).
     */
    setCacheHitRatio(ratio) {
        cacheHitRatio.set(ratio);
    }

    /**
     * Définit la jauge de l'utilisation mémoire de Redis.
     * @param {number} bytes - Utilisation mémoire en octets.
     */
    setRedisMemoryUsageBytes(bytes) {
        redisMemoryUsageBytes.set(bytes);
    }

    /**
     * Retourne le registre des métriques au format texte Prometheus.
     * @returns {Promise<string>} Le registre des métriques.
     */
    async getMetrics() {
        return client.register.metrics();
    }

    /**
     * Retourne le registre des métriques au format JSON.
     * @returns {Promise<object>} Le registre des métriques.
     */
    async getMetricsJson() {
        return client.register.getMetricsAsJSON();
    }
}

module.exports = new MetricsService();
