const cron = require("node-cron");
const cacheService = require("./cacheService");
const healthService = require("./healthService");
const exportService = require("./exportService"); // Assuming exportService has cleanup method

// Placeholder for RPC calls
const rpcClient = {
    /**
     * Simule un appel RPC pour calculer les statistiques quotidiennes.
     * @returns {Promise<void>}
     */
    calculate_daily_stats: async () => {
        console.log("RPC: Simulating calculate_daily_stats...");
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate async work
        console.log("RPC: calculate_daily_stats completed.");
    },
    /**
     * Simule un appel RPC pour nettoyer les OTP expirés.
     * @returns {Promise<void>}
     */
    cleanup_expired_otps: async () => {
        console.log("RPC: Simulating cleanup_expired_otps...");
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log("RPC: cleanup_expired_otps completed.");
    },
    /**
     * Simule un appel RPC pour nettoyer les sockets obsolètes.
     * @returns {Promise<void>}
     */
    cleanup_stale_sockets: async () => {
        console.log("RPC: Simulating cleanup_stale_sockets...");
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log("RPC: cleanup_stale_sockets completed.");
    },
    /**
     * Simule un appel RPC pour agréger les métriques horaires.
     * @param {Date} p_hour - L'heure pour laquelle agréger les métriques.
     * @returns {Promise<void>}
     */
    aggregate_hourly_metrics: async (p_hour) => {
        console.log(`RPC: Simulating aggregate_hourly_metrics for ${p_hour.toISOString()}...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        console.log("RPC: aggregate_hourly_metrics completed.");
    },
};

class CronService {
    constructor() {
        this.jobs = {};
        this.jobConfigs = [
            {
                name: "daily_stats",
                schedule: "0 1 * * *", // Tous les jours à 1h
                task: async () => rpcClient.calculate_daily_stats(),
                disabledEnv: "CRON_DISABLE_DAILY_STATS",
                lockTTL: 5 * 60, // 5 minutes
            },
            {
                name: "cleanup_otp",
                schedule: "0 * * * *", // Toutes les heures
                task: async () => rpcClient.cleanup_expired_otps(),
                disabledEnv: "CRON_DISABLE_CLEANUP_OTP",
                lockTTL: 2 * 60, // 2 minutes
            },
            {
                name: "cleanup_sockets",
                schedule: "*/30 * * * *", // Toutes les 30 min
                task: async () => rpcClient.cleanup_stale_sockets(),
                disabledEnv: "CRON_DISABLE_CLEANUP_SOCKETS",
                lockTTL: 1 * 60, // 1 minute
            },
            {
                name: "cleanup_exports",
                schedule: "0 2 * * *", // Tous les jours à 2h
                task: async () => exportService.cleanupExpiredExports(),
                disabledEnv: "CRON_DISABLE_CLEANUP_EXPORTS",
                lockTTL: 10 * 60, // 10 minutes
            },
            {
                name: "health_check",
                schedule: "*/5 * * * *", // Toutes les 5 min
                task: async () => healthService.runAllChecks(),
                disabledEnv: "CRON_DISABLE_HEALTH_CHECK",
                lockTTL: 1 * 60, // 1 minute
            },
            {
                name: "cache_warmup",
                schedule: "30 0 * * *", // Tous les jours à 0h30
                task: async () => {
                    console.log("Cron: Simulating cache warmup for dashboard metrics...");
                    // Example: await cacheService.getOrSet("dashboard:metrics", async () => fetchDashboardMetrics());
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    console.log("Cron: Cache warmup completed.");
                },
                disabledEnv: "CRON_DISABLE_CACHE_WARMUP",
                lockTTL: 5 * 60, // 5 minutes
            },
            {
                name: "metrics_aggregate",
                schedule: "5 * * * *", // Toutes les heures à :05
                task: async () => rpcClient.aggregate_hourly_metrics(new Date(Date.now() - 60 * 60 * 1000)), // Aggregate for previous hour
                disabledEnv: "CRON_DISABLE_METRICS_AGGREGATE",
                lockTTL: 5 * 60, // 5 minutes
            },
        ];
    }

    /**
     * Acquiert un verrou distribué via Redis pour éviter les exécutions multiples.
     * @param {string} jobName - Nom du job.
     * @param {number} ttl - Durée de vie du verrou en secondes.
     * @returns {Promise<boolean>} Vrai si le verrou a été acquis, faux sinon.
     * @private
     */
    async _acquireLock(jobName, ttl) {
        const lockKey = `cron_lock:${jobName}`;
        try {
            // SETNX (SET if Not eXists) with EX (expire) option
            const result = await cacheService.executeCommand(cacheService.redis.set.bind(cacheService.redis), [lockKey, "locked", "EX", ttl, "NX"]);
            return result === "OK";
        } catch (error) {
            console.error(`CronService: Error acquiring lock for ${jobName}:`, error.message);
            return false;
        }
    }

    /**
     * Relâche un verrou distribué via Redis.
     * @param {string} jobName - Nom du job.
     * @returns {Promise<void>}
     * @private
     */
    async _releaseLock(jobName) {
        const lockKey = `cron_lock:${jobName}`;
        try {
            await cacheService.executeCommand(cacheService.redis.del.bind(cacheService.redis), [lockKey]);
        } catch (error) {
            console.error(`CronService: Error releasing lock for ${jobName}:`, error.message);
        }
    }

    /**
     * Exécute une tâche cron avec gestion des logs, erreurs et verrous distribués.
     * @param {object} jobConfig - Configuration du job.
     * @private
     */
    async _executeTask(jobConfig) {
        const { name, task, lockTTL } = jobConfig;
        const startTime = process.hrtime.bigint();
        let status = "failure";
        let errorMessage = null;

        console.log(`Cron: Job '${name}' started at ${new Date().toISOString()}`);

        try {
            if (process.env[jobConfig.disabledEnv] === "true") {
                console.warn(`Cron: Job '${name}' is disabled by environment variable ${jobConfig.disabledEnv}. Skipping.`);
                status = "skipped";
                return;
            }

            const lockAcquired = await this._acquireLock(name, lockTTL);
            if (!lockAcquired) {
                console.warn(`Cron: Job '${name}' skipped due to existing lock.`);
                status = "skipped_locked";
                return;
            }

            await task();
            status = "success";
        } catch (error) {
            console.error(`Cron: Job '${name}' failed:`, error.message);
            errorMessage = error.message;
        } finally {
            await this._releaseLock(name);
            const endTime = process.hrtime.bigint();
            const durationMs = Number(endTime - startTime) / 1_000_000;
            console.log(`Cron: Job '${name}' finished with status '${status}' in ${durationMs.toFixed(2)}ms. ${errorMessage ? `Error: ${errorMessage}` : ""}`);
            // In a real app, you might log this to a dedicated cron_logs table or a structured logger like Logtail
        }
    }

    /**
     * Démarre tous les jobs cron configurés.
     */
    start() {
        console.log("CronService: Starting all scheduled jobs...");
        this.jobConfigs.forEach(jobConfig => {
            if (process.env[jobConfig.disabledEnv] !== "true") {
                this.jobs[jobConfig.name] = cron.schedule(jobConfig.schedule, () => this._executeTask(jobConfig), {
                    scheduled: true,
                    timezone: "Africa/Ouagadougou" // Assuming Burkina Faso timezone
                });
                console.log(`Cron: Job '${jobConfig.name}' scheduled with pattern '${jobConfig.schedule}'.`);
            } else {
                console.warn(`Cron: Job '${jobConfig.name}' is disabled by environment variable ${jobConfig.disabledEnv}.`);
            }
        });
    }

    /**
     * Arrête tous les jobs cron en cours.
     */
    stop() {
        console.log("CronService: Stopping all scheduled jobs...");
        for (const jobName in this.jobs) {
            if (this.jobs[jobName]) {
                this.jobs[jobName].stop();
                console.log(`Cron: Job '${jobName}' stopped.`);
            }
        }
        this.jobs = {};
    }

    /**
     * Retourne le statut de tous les jobs cron.
     * @returns {object} Un objet mappant les noms de job à leur statut (running/stopped).
     */
    getStatus() {
        const status = {};
        this.jobConfigs.forEach(jobConfig => {
            status[jobConfig.name] = this.jobs[jobConfig.name] ? "running" : "stopped";
        });
        return status;
    }

    /**
     * Déclenche manuellement un job cron par son nom.
     * @param {string} jobName - Le nom du job à déclencher.
     * @returns {Promise<boolean>} Vrai si le job a été trouvé et déclenché, faux sinon.
     */
    async triggerJob(jobName) {
        const jobConfig = this.jobConfigs.find(config => config.name === jobName);
        if (jobConfig) {
            console.log(`Cron: Manually triggering job '${jobName}'...`);
            await this._executeTask(jobConfig);
            return true;
        } else {
            console.warn(`Cron: Job '${jobName}' not found for manual triggering.`);
            return false;
        }
    }
}

module.exports = new CronService();
