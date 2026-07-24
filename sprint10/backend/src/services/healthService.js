const axios = require("axios");
const os = require("os");
const { v4: uuidv4 } = require("uuid");

// Placeholder for database client (e.g., Supabase client)
const db = {
    from: (tableName) => ({
        insert: async (data) => {
            console.log(`Simulating insert into ${tableName}:`, data);
            return { data: [data], error: null };
        },
        select: async (columns) => {
            console.log(`Simulating select from ${tableName} with columns ${columns}`);
            return { data: [], error: null };
        },
    }),
};

// Placeholder for Redis client
const redisClient = {
    ping: async () => {
        return new Promise(resolve => setTimeout(() => resolve("PONG"), 10)); // Simulate 10ms latency
    },
};

// Placeholder for Socket.IO server instance
const io = {
    engine: {
        clientsCount: 150, // Simulate 150 active connections
    },
};

const OSRM_SERVICE_URL = process.env.OSRM_SERVICE_URL || "http://localhost:5000";
const DISK_SPACE_THRESHOLD = 0.90; // 90%
const MEMORY_THRESHOLD = 0.85; // 85% heap usage

class HealthService {
    constructor() {
        this.db = db; // Using placeholder db client
        this.redis = redisClient; // Using placeholder redis client
        this.io = io; // Using placeholder Socket.IO instance
    }

    /**
     * Exécute un check de service avec un timeout.
     * @param {string} serviceName - Nom du service.
     * @param {Function} checkFunction - Fonction asynchrone pour effectuer le check.
     * @param {number} timeout - Timeout en ms.
     * @returns {Promise<{status: string, response_time_ms: number, details: object}>}
     * @private
     */
    async _runCheckWithTimeout(serviceName, checkFunction, timeout = 5000) {
        const startTime = process.hrtime.bigint();
        let status = "unhealthy";
        let details = {};
        let responseTime = -1;

        try {
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
            );
            const result = await Promise.race([checkFunction(), timeoutPromise]);

            const endTime = process.hrtime.bigint();
            responseTime = Number(endTime - startTime) / 1_000_000; // Convert nanoseconds to milliseconds

            status = result.status || "healthy";
            details = result.details || {};

        } catch (error) {
            console.error(`Health Check Error for ${serviceName}:`, error.message);
            status = "unhealthy";
            details = { error: error.message };
            const endTime = process.hrtime.bigint();
            responseTime = Number(endTime - startTime) / 1_000_000; // Even on error, capture elapsed time
        }
        return { status, response_time_ms: Math.round(responseTime), details };
    }

    /**
     * Effectue un health check sur PostgreSQL.
     * @returns {Promise<{status: string, details: object}>}
     */
    async checkPostgreSQL() {
        try {
            const { data, error } = await this.db.from("users").select("id").limit(1);
            if (error) throw error;
            return { status: "healthy", details: { message: "Successfully connected to PostgreSQL." } };
        } catch (error) {
            return { status: "unhealthy", details: { error: error.message } };
        }
    }

    /**
     * Effectue un health check sur Redis.
     * @returns {Promise<{status: string, details: object}>}
     */
    async checkRedis() {
        try {
            const pong = await this.redis.ping();
            if (pong !== "PONG") throw new Error("Redis PING failed.");
            return { status: "healthy", details: { message: "Successfully connected to Redis." } };
        } catch (error) {
            return { status: "unhealthy", details: { error: error.message } };
        }
    }

    /**
     * Effectue un health check sur le service OSRM.
     * @returns {Promise<{status: string, details: object}>}
     */
    async checkOSRM() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000); // OSRM specific timeout

            // Simulate an OSRM request
            const response = await axios.get(`${OSRM_SERVICE_URL}/nearest/v1/driving/1,1`, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.status !== 200) throw new Error(`OSRM returned status ${response.status}`);
            return { status: "healthy", details: { message: "Successfully connected to OSRM." } };
        } catch (error) {
            return { status: "unhealthy", details: { error: error.message } };
        }
    }

    /**
     * Effectue un health check sur les connexions Socket.IO.
     * @returns {Promise<{status: string, details: object}>}
     */
    async checkSocketIO() {
        try {
            const activeConnections = this.io.engine.clientsCount;
            const status = activeConnections > 0 ? "healthy" : "degraded";
            return { status, details: { activeConnections } };
        } catch (error) {
            return { status: "unhealthy", details: { error: error.message } };
        }
    }

    /**
     * Effectue un health check sur l'espace disque.
     * Note: `df` command is not directly available in Node.js `os` module.
     * This is a simplified simulation. For actual disk space, a child process running `df` or a dedicated library would be needed.
     * @returns {Promise<{status: string, details: object}>}
     */
    async checkDiskSpace() {
        try {
            // Simulate disk usage for demonstration purposes
            const totalDiskSpace = 100 * 1024 * 1024 * 1024; // 100 GB
            const freeDiskSpace = 10 * 1024 * 1024 * 1024; // 10 GB
            const usedDiskSpace = totalDiskSpace - freeDiskSpace;
            const usagePercentage = usedDiskSpace / totalDiskSpace;

            const status = usagePercentage < DISK_SPACE_THRESHOLD ? "healthy" : "unhealthy";
            return { status, details: { total: totalDiskSpace, free: freeDiskSpace, used: usedDiskSpace, usagePercentage: usagePercentage.toFixed(2) } };
        } catch (error) {
            return { status: "unhealthy", details: { error: error.message } };
        }
    }

    /**
     * Effectue un health check sur l'utilisation de la mémoire.
     * @returns {Promise<{status: string, details: object}>}
     */
    async checkMemory() {
        try {
            const memoryUsage = process.memoryUsage();
            const heapUsedPercentage = memoryUsage.heapUsed / memoryUsage.heapTotal;

            const status = heapUsedPercentage < MEMORY_THRESHOLD ? "healthy" : "unhealthy";
            return { status, details: { heapUsed: memoryUsage.heapUsed, heapTotal: memoryUsage.heapTotal, heapUsedPercentage: heapUsedPercentage.toFixed(2) } };
        } catch (error) {
            return { status: "unhealthy", details: { error: error.message } };
        }
    }

    /**
     * Exécute tous les health checks et agrège leur statut.
     * @returns {Promise<{overallStatus: string, checks: object}>}
     */
    async runAllChecks() {
        const checks = {};
        let overallStatus = "healthy";

        const criticalChecks = [
            { name: "PostgreSQL", func: this.checkPostgreSQL.bind(this) },
            { name: "Redis", func: this.checkRedis.bind(this) },
        ];

        const nonCriticalChecks = [
            { name: "OSRM", func: this.checkOSRM.bind(this) },
            { name: "Socket.IO", func: this.checkSocketIO.bind(this) },
            { name: "DiskSpace", func: this.checkDiskSpace.bind(this) },
            { name: "Memory", func: this.checkMemory.bind(this) },
        ];

        // Run critical checks
        for (const check of criticalChecks) {
            const result = await this._runCheckWithTimeout(check.name, check.func);
            checks[check.name] = result;
            if (result.status === "unhealthy") {
                overallStatus = "unhealthy";
            }
        }

        // Run non-critical checks
        for (const check of nonCriticalChecks) {
            const result = await this._runCheckWithTimeout(check.name, check.func);
            checks[check.name] = result;
            if (overallStatus === "healthy" && result.status === "unhealthy") {
                overallStatus = "degraded";
            }
        }

        // Log to database
        try {
            await this.db.from("health_checks").insert({
                id: uuidv4(),
                service_name: "overall",
                status: overallStatus,
                details: checks,
                checked_at: new Date().toISOString(),
            });
        } catch (dbError) {
            console.error("Failed to log health check to database:", dbError.message);
        }

        return { overallStatus, checks };
    }
}

module.exports = new HealthService();
