const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

// Configuration Redis
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

// Circuit Breaker States
const CIRCUIT_STATE = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN',
};

class CacheService {
    constructor() {
        this.redis = null;
        this.circuitState = CIRCUIT_STATE.CLOSED;
        this.failureCount = 0;
        this.resetTimeout = null;
        this.halfOpenTimeout = null;
        this.maxFailures = 5; // Open circuit after 5 failures
        this.resetTime = 30 * 1000; // Try half-open after 30 seconds

        this.cacheHit = 0;
        this.cacheMiss = 0;

        this.namespaces = {
            'dashboard:': 60,   // 60 seconds
            'user:': 300,      // 300 seconds (5 minutes)
            'menu:': 600,      // 600 seconds (10 minutes)
            'order:': 120,     // 120 seconds (2 minutes)
            'delivery:': 30,   // 30 seconds
            'stats:': 3600,    // 3600 seconds (1 hour)
        };

        this.connect();
    }

    /**
     * Établit la connexion à Redis avec une logique de retry et de circuit breaker.
     * @private
     */
    connect() {
        if (this.redis) {
            this.redis.disconnect();
        }

        let retries = 0;
        const maxRetries = 3;

        const connectWithRetry = () => {
            this.redis = new Redis(REDIS_URL, {
                password: REDIS_PASSWORD,
                maxRetriesPerRequest: null, // Disable ioredis's built-in retry logic
                enableOfflineQueue: true,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000); // Exponential backoff up to 2 seconds
                    console.warn(`Redis: Retrying connection (${times}/${maxRetries}). Delay: ${delay}ms`);
                    return delay;
                },
            });

            this.redis.on('connect', () => {
                console.info('Redis: Connected successfully.');
                this.circuitState = CIRCUIT_STATE.CLOSED;
                this.failureCount = 0;
                clearTimeout(this.resetTimeout);
                clearTimeout(this.halfOpenTimeout);
            });

            this.redis.on('error', (err) => {
                console.error('Redis: Connection error:', err.message);
                this.handleFailure();
                if (retries < maxRetries) {
                    retries++;
                    console.warn(`Redis: Attempting to reconnect... (Attempt ${retries})`);
                    setTimeout(connectWithRetry, Math.pow(2, retries) * 1000); // Exponential backoff for full reconnect
                } else {
                    console.error('Redis: Max retries reached. Connection failed permanently.');
                    this.redis.disconnect();
                }
            });

            this.redis.on('end', () => {
                console.warn('Redis: Connection ended.');
            });
        };

        connectWithRetry();
    }

    /**
     * Gère les échecs de connexion ou d'opération Redis pour le circuit breaker.
     * @private
     */
    handleFailure() {
        this.failureCount++;
        if (this.failureCount >= this.maxFailures && this.circuitState === CIRCUIT_STATE.CLOSED) {
            this.circuitState = CIRCUIT_STATE.OPEN;
            console.error(`Redis: Circuit breaker opened due to ${this.maxFailures} failures.`);
            this.resetTimeout = setTimeout(() => {
                this.circuitState = CIRCUIT_STATE.HALF_OPEN;
                console.warn('Redis: Circuit breaker is now half-open. Probing...');
            }, this.resetTime);
        }
    }

    /**
     * Exécute une commande Redis si le circuit breaker est fermé ou à moitié ouvert.
     * En cas d'échec, gère le circuit breaker.
     * @param {Function} command - La fonction à exécuter (e.g., this.redis.get).
     * @param {Array<any>} args - Les arguments de la fonction.
     * @returns {Promise<any>} Le résultat de la commande ou null en cas d'échec/circuit ouvert.
     * @private
     */
    async executeCommand(command, args) {
        if (this.circuitState === CIRCUIT_STATE.OPEN) {
            console.warn('Redis: Circuit breaker is OPEN. Falling back to null.');
            return null; // Fallback if circuit is open
        }

        try {
            const result = await command(...args);
            if (this.circuitState === CIRCUIT_STATE.HALF_OPEN) {
                this.circuitState = CIRCUIT_STATE.CLOSED;
                this.failureCount = 0;
                console.info('Redis: Circuit breaker is now CLOSED (probe successful).');
            }
            return result;
        } catch (error) {
            console.error('Redis: Command execution error:', error.message);
            this.handleFailure();
            return null; // Graceful error handling
        }
    }

    /**
     * Récupère une valeur du cache Redis.
     * @param {string} key - La clé du cache.
     * @returns {Promise<any|null>} La valeur désérialisée ou null si non trouvée ou erreur.
     */
    async get(key) {
        try {
            const data = await this.executeCommand(this.redis.get.bind(this.redis), [key]);
            if (data) {
                this.cacheHit++;
                return JSON.parse(data);
            } else {
                this.cacheMiss++;
                return null;
            }
        } catch (error) {
            console.error(`CacheService.get(${key}): Error parsing JSON or executing command:`, error.message);
            return null;
        }
    }

    /**
     * Définit une valeur dans le cache Redis avec un TTL.
     * Le TTL est déterminé par le namespace de la clé.
     * @param {string} key - La clé du cache.
     * @param {any} value - La valeur à stocker.
     * @returns {Promise<string|null>} Le statut de l'opération (OK) ou null en cas d'erreur.
     */
    async set(key, value) {
        try {
            const serializedValue = JSON.stringify(value);
            let ttl = 3600; // Default TTL to 1 hour

            for (const namespace in this.namespaces) {
                if (key.startsWith(namespace)) {
                    ttl = this.namespaces[namespace];
                    break;
                }
            }
            return await this.executeCommand(this.redis.setex.bind(this.redis), [key, ttl, serializedValue]);
        } catch (error) {
            console.error(`CacheService.set(${key}): Error serializing JSON or executing command:`, error.message);
            return null;
        }
    }

    /**
     * Supprime une ou plusieurs clés du cache Redis.
     * @param {...string} keys - Les clés à supprimer.
     * @returns {Promise<number|null>} Le nombre de clés supprimées ou null en cas d'erreur.
     */
    async del(...keys) {
        try {
            return await this.executeCommand(this.redis.del.bind(this.redis), keys);
        } catch (error) {
            console.error(`CacheService.del(${keys.join(', ')}): Error executing command:`, error.message);
            return null;
        }
    }

    /**
     * Récupère une valeur du cache. Si elle n'existe pas, exécute une fonction pour la générer,
     * la stocke dans le cache, puis la retourne (cache-aside pattern).
     * @param {string} key - La clé du cache.
     * @param {Function} fetchFunction - La fonction asynchrone pour générer la valeur si elle n'est pas en cache.
     * @returns {Promise<any|null>} La valeur du cache ou le résultat de fetchFunction.
     */
    async getOrSet(key, fetchFunction) {
        try {
            const cachedData = await this.get(key);
            if (cachedData !== null) {
                return cachedData;
            }

            const freshData = await fetchFunction();
            if (freshData !== null && freshData !== undefined) {
                await this.set(key, freshData);
            }
            return freshData;
        } catch (error) {
            console.error(`CacheService.getOrSet(${key}): Error in fetchFunction or cache operation:`, error.message);
            return await fetchFunction(); // Fallback to fetching data directly without caching
        }
    }

    /**
     * Invalide les clés du cache correspondant à un motif donné.
     * Utilise SCAN pour éviter de bloquer le serveur Redis sur de grands datasets.
     * @param {string} pattern - Le motif des clés à invalider (e.g., 'user:*').
     * @param {string} reason - La raison de l'invalidation.
     * @param {string|null} invalidatedBy - L'ID de l'utilisateur ou du système qui a initié l'invalidation.
     * @returns {Promise<number|null>} Le nombre de clés invalidées ou null en cas d'erreur.
     */
    async invalidatePattern(pattern, reason = 'Unknown', invalidatedBy = null) {
        if (this.circuitState === CIRCUIT_STATE.OPEN) {
            console.warn('Redis: Circuit breaker is OPEN. Cannot invalidate pattern.');
            return null;
        }

        let cursor = '0';
        let keys = [];
        try {
            do {
                const [nextCursor, scannedKeys] = await this.executeCommand(this.redis.scan.bind(this.redis), [cursor, 'MATCH', pattern, 'COUNT', '100']);
                cursor = nextCursor;
                keys = keys.concat(scannedKeys);
            } while (cursor !== '0');

            if (keys.length > 0) {
                const deletedCount = await this.del(...keys);
                for (const key of keys) {
                    // Log invalidation to DB
                    // This part would typically interact with a DB client, e.g., Supabase client
                    // For now, we'll just log to console as DB client is not available here.
                    console.info(`Cache Invalidation Log: Key '${key}' invalidated. Reason: '${reason}', By: '${invalidatedBy}'`);
                    // In a real app, you'd do something like:
                    // await db.from('cache_invalidation_log').insert({ id: uuidv4(), cache_key: key, reason, invalidated_by: invalidatedBy });
                }
                return deletedCount;
            }
            return 0;
        } catch (error) {
            console.error(`CacheService.invalidatePattern(${pattern}): Error executing command:`, error.message);
            return null;
        }
    }

    /**
     * Vide complètement le cache Redis.
     * @param {string} reason - La raison de l'invalidation globale.
     * @param {string|null} invalidatedBy - L'ID de l'utilisateur ou du système qui a initié l'invalidation.
     * @returns {Promise<string|null>} Le statut de l'opération (OK) ou null en cas d'erreur.
     */
    async flush(reason = 'Manual Flush', invalidatedBy = null) {
        if (this.circuitState === CIRCUIT_STATE.OPEN) {
            console.warn('Redis: Circuit breaker is OPEN. Cannot flush cache.');
            return null;
        }
        try {
            const result = await this.executeCommand(this.redis.flushdb.bind(this.redis), []);
            console.info(`Cache Invalidation Log: Cache flushed. Reason: '${reason}', By: '${invalidatedBy}'`);
            // await db.from('cache_invalidation_log').insert({ id: uuidv4(), cache_key: '*', reason, invalidated_by: invalidatedBy });
            return result;
        } catch (error) {
            console.error('CacheService.flush: Error executing command:', error.message);
            return null;
        }
    }

    /**
     * Retourne le ratio de hits/miss du cache.
     * @returns {{hit: number, miss: number, ratio: number}}
     */
    getCacheHitRatio() {
        const total = this.cacheHit + this.cacheMiss;
        const ratio = total === 0 ? 0 : (this.cacheHit / total);
        return { hit: this.cacheHit, miss: this.cacheMiss, ratio: parseFloat(ratio.toFixed(2)) };
    }

    /**
     * Déconnecte le client Redis.
     */
    disconnect() {
        if (this.redis) {
            this.redis.disconnect();
            console.info('Redis: Disconnected.');
        }
        clearTimeout(this.resetTimeout);
        clearTimeout(this.halfOpenTimeout);
    }
}

module.exports = new CacheService();
