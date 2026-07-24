'use strict';

/**
 * @fileoverview Service de fidélisation pour Hil_Delivre v4.
 * Gère l'attribution, la consultation, la conversion et l'expiration
 * des points de fidélité des clients.
 * @module services/loyaltyService
 */

const supabase = require('../config/supabase');

/** Points par défaut par tranche de 100 FCFA */
const DEFAULT_POINTS_PER_100FCFA = 1;

/** Durée d'expiration par défaut en mois */
const DEFAULT_EXPIRY_MONTHS = 6;

/** Taux de conversion par défaut (1 point = 5 FCFA) */
const DEFAULT_CONVERSION_RATE = 5;

/** Minimum de points pour une conversion */
const DEFAULT_MIN_REDEEM = 100;

/**
 * Récupère les paramètres de fidélité depuis platform_config.
 *
 * @returns {Promise<object>} Paramètres de configuration
 * @private
 */
async function getLoyaltyConfig() {
    try {
        const { data: configs } = await supabase
            .from('platform_config')
            .select('config_key, config_value')
            .in('config_key', [
                'loyalty_points_per_100fcfa',
                'loyalty_expiry_months',
                'loyalty_conversion_rate',
                'loyalty_min_redeem'
            ]);

        const configMap = {};
        if (configs) {
            configs.forEach(c => { configMap[c.config_key] = Number(c.config_value); });
        }

        return {
            pointsPer100Fcfa: configMap.loyalty_points_per_100fcfa || DEFAULT_POINTS_PER_100FCFA,
            expiryMonths: configMap.loyalty_expiry_months || DEFAULT_EXPIRY_MONTHS,
            conversionRate: configMap.loyalty_conversion_rate || DEFAULT_CONVERSION_RATE,
            minRedeem: configMap.loyalty_min_redeem || DEFAULT_MIN_REDEEM
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur getLoyaltyConfig:', error);
        return {
            pointsPer100Fcfa: DEFAULT_POINTS_PER_100FCFA,
            expiryMonths: DEFAULT_EXPIRY_MONTHS,
            conversionRate: DEFAULT_CONVERSION_RATE,
            minRedeem: DEFAULT_MIN_REDEEM
        };
    }
}

/**
 * Attribue des points de fidélité à un client après une commande livrée.
 * Calcul : 1 point par tranche de 100 FCFA de food_amount.
 *
 * @param {string} userId - UUID du client
 * @param {string} orderId - UUID de la commande
 * @param {number} foodAmount - Montant de la nourriture en FCFA
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function awardPoints(userId, orderId, foodAmount) {
    try {
        // Validation des entrées
        if (!userId || !orderId) {
            return { success: false, data: null, error: 'userId et orderId sont requis' };
        }

        if (typeof foodAmount !== 'number' || foodAmount <= 0) {
            return { success: false, data: null, error: 'Le montant doit être un nombre positif' };
        }

        // Vérifier que l'utilisateur est un client
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, role')
            .eq('id', userId)
            .single();

        if (userError || !user) {
            return { success: false, data: null, error: 'Utilisateur introuvable' };
        }

        if (user.role !== 'client') {
            return { success: false, data: null, error: 'Seuls les clients peuvent gagner des points de fidélité' };
        }

        // Vérifier que les points n'ont pas déjà été attribués pour cette commande
        const { data: existingPoints } = await supabase
            .from('loyalty_points')
            .select('id')
            .eq('user_id', userId)
            .eq('order_id', orderId)
            .eq('transaction_type', 'earned')
            .maybeSingle();

        if (existingPoints) {
            return { success: false, data: null, error: 'Les points ont déjà été attribués pour cette commande' };
        }

        // Récupérer la configuration
        const config = await getLoyaltyConfig();

        // Calculer les points
        const pointsEarned = Math.floor(foodAmount / 100) * config.pointsPer100Fcfa;

        if (pointsEarned <= 0) {
            return { success: true, data: { points_earned: 0, message: 'Montant insuffisant pour gagner des points' }, error: null };
        }

        // Calculer la date d'expiration
        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + config.expiryMonths);

        // Insérer les points
        const { data: pointsRecord, error: insertError } = await supabase
            .from('loyalty_points')
            .insert({
                user_id: userId,
                transaction_type: 'earned',
                points_earned: pointsEarned,
                points_balance: pointsEarned,
                order_id: orderId,
                description: `Points gagnés - Commande ${orderId.substring(0, 8)}`,
                expires_at: expiresAt.toISOString()
            })
            .select('id, points_earned, points_balance, expires_at, created_at')
            .single();

        if (insertError) {
            console.error('[LoyaltyService] Erreur insertion points:', insertError);
            return { success: false, data: null, error: 'Erreur lors de l\'attribution des points' };
        }

        // Mettre à jour le total dans profiles_data
        await updateTotalLoyaltyPoints(userId);

        return {
            success: true,
            data: {
                ...pointsRecord,
                food_amount: foodAmount,
                conversion_info: `${pointsEarned} points gagnés (${config.pointsPer100Fcfa} point par 100 FCFA)`
            },
            error: null
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur awardPoints:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère le solde de points disponibles d'un utilisateur.
 * Ne compte que les points non expirés et non entièrement dépensés.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getPointsBalance(userId) {
    try {
        // Points disponibles (non expirés, avec solde > 0)
        const { data: activePoints, error } = await supabase
            .from('loyalty_points')
            .select('points_balance, expires_at')
            .eq('user_id', userId)
            .eq('transaction_type', 'earned')
            .eq('is_expired', false)
            .gt('points_balance', 0);

        if (error) {
            console.error('[LoyaltyService] Erreur getPointsBalance:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération du solde' };
        }

        const totalAvailable = activePoints
            ? activePoints.reduce((sum, p) => sum + p.points_balance, 0)
            : 0;

        // Trouver la prochaine expiration
        const now = new Date();
        const nextExpiration = activePoints
            ? activePoints
                .filter(p => p.expires_at)
                .map(p => new Date(p.expires_at))
                .filter(d => d > now)
                .sort((a, b) => a - b)[0] || null
            : null;

        // Points expirant dans les 30 prochains jours
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const expiringPoints = activePoints
            ? activePoints
                .filter(p => p.expires_at && new Date(p.expires_at) <= thirtyDaysFromNow && new Date(p.expires_at) > now)
                .reduce((sum, p) => sum + p.points_balance, 0)
            : 0;

        // Récupérer la config pour afficher la valeur en FCFA
        const config = await getLoyaltyConfig();
        const valueInFcfa = totalAvailable * config.conversionRate;

        return {
            success: true,
            data: {
                available_points: totalAvailable,
                value_fcfa: valueInFcfa,
                expiring_soon: expiringPoints,
                next_expiration: nextExpiration ? nextExpiration.toISOString() : null,
                min_redeem: config.minRedeem,
                conversion_rate: config.conversionRate,
                can_redeem: totalAvailable >= config.minRedeem
            },
            error: null
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur getPointsBalance:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère l'historique des transactions de points (paginé).
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {object} options - Options de pagination
 * @param {number} [options.page=1] - Numéro de page
 * @param {number} [options.limit=20] - Nombre par page
 * @param {string} [options.type] - Filtrer par type (earned, redeemed, expired)
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getPointsHistory(userId, options = {}) {
    try {
        const { page = 1, limit = 20, type } = options;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('loyalty_points')
            .select('id, transaction_type, points_earned, points_spent, points_balance, description, expires_at, is_expired, order_id, created_at', { count: 'exact' })
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (type) {
            query = query.eq('transaction_type', type);
        }

        const { data: history, error, count } = await query;

        if (error) {
            console.error('[LoyaltyService] Erreur getPointsHistory:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération de l\'historique' };
        }

        return {
            success: true,
            data: {
                transactions: history || [],
                pagination: {
                    page,
                    limit,
                    total: count || 0,
                    totalPages: Math.ceil((count || 0) / limit)
                }
            },
            error: null
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur getPointsHistory:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Convertit des points de fidélité en crédit plateforme (wallet_balance).
 * Utilise une fonction SQL transactionnelle pour garantir l'atomicité.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @param {number} pointsToRedeem - Nombre de points à convertir
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function redeemPoints(userId, pointsToRedeem) {
    try {
        // Validation
        if (!Number.isInteger(pointsToRedeem) || pointsToRedeem <= 0) {
            return { success: false, data: null, error: 'Le nombre de points doit être un entier positif' };
        }

        const config = await getLoyaltyConfig();

        if (pointsToRedeem < config.minRedeem) {
            return { success: false, data: null, error: `Minimum ${config.minRedeem} points requis pour la conversion` };
        }

        // Vérifier que l'utilisateur est un client
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, role')
            .eq('id', userId)
            .single();

        if (userError || !user || user.role !== 'client') {
            return { success: false, data: null, error: 'Seuls les clients peuvent convertir des points' };
        }

        // Appeler la fonction SQL transactionnelle
        const { data: creditAmount, error: rpcError } = await supabase
            .rpc('redeem_loyalty_points', {
                p_user_id: userId,
                p_points_to_redeem: pointsToRedeem,
                p_conversion_rate: config.conversionRate
            });

        if (rpcError) {
            console.error('[LoyaltyService] Erreur RPC redeem_loyalty_points:', rpcError);

            // Messages d'erreur lisibles
            if (rpcError.message && rpcError.message.includes('Solde insuffisant')) {
                return { success: false, data: null, error: 'Solde de points insuffisant' };
            }
            if (rpcError.message && rpcError.message.includes('Minimum')) {
                return { success: false, data: null, error: `Minimum ${config.minRedeem} points requis` };
            }
            return { success: false, data: null, error: 'Erreur lors de la conversion des points' };
        }

        // Mettre à jour le total dans profiles_data
        await updateTotalLoyaltyPoints(userId);

        return {
            success: true,
            data: {
                points_redeemed: pointsToRedeem,
                credit_amount: Number(creditAmount),
                conversion_rate: config.conversionRate,
                message: `${pointsToRedeem} points convertis en ${Number(creditAmount)} FCFA de crédit`
            },
            error: null
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur redeemPoints:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Expire les points périmés. À appeler via un cron job.
 *
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function expirePoints() {
    try {
        const { data: expiredCount, error } = await supabase
            .rpc('expire_loyalty_points');

        if (error) {
            console.error('[LoyaltyService] Erreur RPC expire_loyalty_points:', error);
            return { success: false, data: null, error: 'Erreur lors de l\'expiration des points' };
        }

        // Mettre à jour les totaux des utilisateurs affectés
        const { data: affectedUsers } = await supabase
            .from('loyalty_points')
            .select('user_id')
            .eq('is_expired', true)
            .gte('created_at', new Date(Date.now() - 60000).toISOString()); // Modifiés dans la dernière minute

        if (affectedUsers && affectedUsers.length > 0) {
            const uniqueUsers = [...new Set(affectedUsers.map(u => u.user_id))];
            for (const uid of uniqueUsers) {
                await updateTotalLoyaltyPoints(uid);
            }
        }

        return {
            success: true,
            data: { expired_count: expiredCount || 0 },
            error: null
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur expirePoints:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère les statistiques du programme de fidélité (admin).
 *
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getLoyaltyStats() {
    try {
        // Total des points en circulation
        const { data: activeData } = await supabase
            .from('loyalty_points')
            .select('points_balance')
            .eq('transaction_type', 'earned')
            .eq('is_expired', false)
            .gt('points_balance', 0);

        const totalActivePoints = activeData
            ? activeData.reduce((sum, p) => sum + p.points_balance, 0)
            : 0;

        // Total des points convertis (tout le temps)
        const { data: redeemedData } = await supabase
            .from('loyalty_points')
            .select('points_spent')
            .eq('transaction_type', 'redeemed');

        const totalRedeemed = redeemedData
            ? redeemedData.reduce((sum, p) => sum + p.points_spent, 0)
            : 0;

        // Nombre d'utilisateurs avec des points actifs
        const { data: usersWithPoints } = await supabase
            .from('loyalty_points')
            .select('user_id')
            .eq('transaction_type', 'earned')
            .eq('is_expired', false)
            .gt('points_balance', 0);

        const uniqueUsersCount = usersWithPoints
            ? new Set(usersWithPoints.map(u => u.user_id)).size
            : 0;

        const config = await getLoyaltyConfig();

        return {
            success: true,
            data: {
                total_active_points: totalActivePoints,
                total_active_value_fcfa: totalActivePoints * config.conversionRate,
                total_redeemed_points: totalRedeemed,
                total_redeemed_value_fcfa: totalRedeemed * config.conversionRate,
                active_users_count: uniqueUsersCount,
                config: {
                    points_per_100fcfa: config.pointsPer100Fcfa,
                    expiry_months: config.expiryMonths,
                    conversion_rate: config.conversionRate,
                    min_redeem: config.minRedeem
                }
            },
            error: null
        };
    } catch (error) {
        console.error('[LoyaltyService] Erreur getLoyaltyStats:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Met à jour le total de points de fidélité dans profiles_data.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<void>}
 * @private
 */
async function updateTotalLoyaltyPoints(userId) {
    try {
        const { data: activePoints } = await supabase
            .from('loyalty_points')
            .select('points_balance')
            .eq('user_id', userId)
            .eq('transaction_type', 'earned')
            .eq('is_expired', false)
            .gt('points_balance', 0);

        const total = activePoints
            ? activePoints.reduce((sum, p) => sum + p.points_balance, 0)
            : 0;

        await supabase
            .from('profiles_data')
            .update({ total_loyalty_points: total, updated_at: new Date().toISOString() })
            .eq('user_id', userId);
    } catch (error) {
        console.error('[LoyaltyService] Erreur updateTotalLoyaltyPoints:', error);
    }
}

module.exports = {
    awardPoints,
    getPointsBalance,
    getPointsHistory,
    redeemPoints,
    expirePoints,
    getLoyaltyStats
};
