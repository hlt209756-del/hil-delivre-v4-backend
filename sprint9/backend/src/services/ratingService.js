'use strict';

/**
 * @fileoverview Service de notation bidirectionnel pour Hil_Delivre v4.
 * Gère la création, la récupération et la modération des notations
 * entre clients, marchands et livreurs.
 * @module services/ratingService
 */

const supabase = require('../config/supabase');

/** Fenêtre de notation par défaut en heures */
const DEFAULT_RATING_WINDOW_HOURS = 72;

/** Score minimum */
const MIN_SCORE = 1;

/** Score maximum */
const MAX_SCORE = 5;

/**
 * Vérifie si un utilisateur peut noter un autre utilisateur pour une commande donnée.
 * Contrôles effectués :
 * - La commande existe et est au statut 'delivered'
 * - Le rater est partie prenante de la commande
 * - Le rated_user est partie prenante de la commande
 * - La fenêtre de notation (72h) n'est pas dépassée
 * - Aucune notation identique n'existe déjà
 * - Le rater ne se note pas lui-même
 *
 * @param {string} raterId - UUID de l'utilisateur qui note
 * @param {string} orderId - UUID de la commande
 * @param {string} ratedUserId - UUID de l'utilisateur noté
 * @returns {Promise<{canRate: boolean, reason: string|null, order: object|null}>}
 */
async function canUserRate(raterId, orderId, ratedUserId) {
    try {
        // Anti-auto-notation
        if (raterId === ratedUserId) {
            return { canRate: false, reason: 'Vous ne pouvez pas vous noter vous-même', order: null };
        }

        // Récupérer la commande
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, status, client_id, merchant_id, delivery_id, delivered_at, updated_at')
            .eq('id', orderId)
            .single();

        if (orderError || !order) {
            return { canRate: false, reason: 'Commande introuvable', order: null };
        }

        // Vérifier le statut
        if (order.status !== 'delivered') {
            return { canRate: false, reason: 'La commande doit être livrée pour pouvoir noter', order: null };
        }

        // Vérifier que le rater est partie de la commande
        const orderParties = [order.client_id, order.merchant_id, order.delivery_id].filter(Boolean);
        if (!orderParties.includes(raterId)) {
            return { canRate: false, reason: 'Vous n\'êtes pas partie prenante de cette commande', order: null };
        }

        // Vérifier que le rated_user est partie de la commande
        if (!orderParties.includes(ratedUserId)) {
            return { canRate: false, reason: 'L\'utilisateur noté n\'est pas partie prenante de cette commande', order: null };
        }

        // Récupérer la fenêtre de notation depuis la config
        let ratingWindowHours = DEFAULT_RATING_WINDOW_HOURS;
        const { data: configData } = await supabase
            .from('platform_config')
            .select('config_value')
            .eq('config_key', 'rating_window_hours')
            .single();

        if (configData) {
            ratingWindowHours = Number(configData.config_value);
        }

        // Vérifier la fenêtre de notation (72h après livraison)
        const deliveryTime = order.delivered_at || order.updated_at;
        const deadline = new Date(new Date(deliveryTime).getTime() + ratingWindowHours * 60 * 60 * 1000);
        if (new Date() > deadline) {
            return { canRate: false, reason: `La fenêtre de notation de ${ratingWindowHours}h est dépassée`, order: null };
        }

        // Vérifier l'unicité (pas de double notation)
        const { data: existingRating, error: existingError } = await supabase
            .from('ratings')
            .select('id')
            .eq('order_id', orderId)
            .eq('rater_id', raterId)
            .eq('rated_user_id', ratedUserId)
            .maybeSingle();

        if (existingError) {
            console.error('[RatingService] Erreur vérification unicité:', existingError);
            return { canRate: false, reason: 'Erreur lors de la vérification', order: null };
        }

        if (existingRating) {
            return { canRate: false, reason: 'Vous avez déjà noté cet utilisateur pour cette commande', order: null };
        }

        return { canRate: true, reason: null, order };
    } catch (error) {
        console.error('[RatingService] Erreur canUserRate:', error);
        return { canRate: false, reason: 'Erreur interne du serveur', order: null };
    }
}

/**
 * Crée une notation pour une commande.
 * Vérifie toutes les conditions préalables avant insertion.
 *
 * @param {string} raterId - UUID de l'utilisateur qui note
 * @param {string} orderId - UUID de la commande
 * @param {string} ratedUserId - UUID de l'utilisateur noté
 * @param {number} score - Score de 1 à 5
 * @param {string|null} comment - Commentaire optionnel (max 500 chars)
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function createRating(raterId, orderId, ratedUserId, score, comment = null) {
    try {
        // Validation du score
        if (!Number.isInteger(score) || score < MIN_SCORE || score > MAX_SCORE) {
            return { success: false, data: null, error: `Le score doit être un entier entre ${MIN_SCORE} et ${MAX_SCORE}` };
        }

        // Validation du commentaire
        if (comment !== null && comment.length > 500) {
            return { success: false, data: null, error: 'Le commentaire ne doit pas dépasser 500 caractères' };
        }

        // Sanitization du commentaire (suppression des balises HTML)
        const sanitizedComment = comment ? sanitizeComment(comment) : null;

        // Vérifier les conditions
        const { canRate, reason } = await canUserRate(raterId, orderId, ratedUserId);
        if (!canRate) {
            return { success: false, data: null, error: reason };
        }

        // Insérer la notation
        const { data: rating, error: insertError } = await supabase
            .from('ratings')
            .insert({
                order_id: orderId,
                rater_id: raterId,
                rated_user_id: ratedUserId,
                score,
                comment: sanitizedComment
            })
            .select('id, order_id, rater_id, rated_user_id, score, comment, created_at')
            .single();

        if (insertError) {
            console.error('[RatingService] Erreur insertion notation:', insertError);

            // Gestion de la contrainte UNIQUE
            if (insertError.code === '23505') {
                return { success: false, data: null, error: 'Vous avez déjà noté cet utilisateur pour cette commande' };
            }
            return { success: false, data: null, error: 'Erreur lors de la création de la notation' };
        }

        // Note : Le trigger SQL met automatiquement à jour avg_rating et ratings_count

        return { success: true, data: rating, error: null };
    } catch (error) {
        console.error('[RatingService] Erreur createRating:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère les notations reçues par un utilisateur (paginées).
 *
 * @param {string} userId - UUID de l'utilisateur noté
 * @param {object} options - Options de pagination et filtrage
 * @param {number} [options.page=1] - Numéro de page
 * @param {number} [options.limit=20] - Nombre d'éléments par page
 * @param {number} [options.minScore] - Score minimum (filtre)
 * @param {number} [options.maxScore] - Score maximum (filtre)
 * @param {string} [options.sortBy='created_at'] - Champ de tri
 * @param {string} [options.sortOrder='desc'] - Ordre de tri
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getRatingsForUser(userId, options = {}) {
    try {
        const {
            page = 1,
            limit = 20,
            minScore,
            maxScore,
            sortBy = 'created_at',
            sortOrder = 'desc'
        } = options;

        const offset = (page - 1) * limit;
        const validSortFields = ['created_at', 'score'];
        const actualSortBy = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const ascending = sortOrder === 'asc';

        let query = supabase
            .from('ratings')
            .select(`
                id, score, comment, created_at,
                rater:rater_id (
                    id,
                    profiles_data!inner (display_name, first_name)
                )
            `, { count: 'exact' })
            .eq('rated_user_id', userId)
            .eq('is_visible', true)
            .order(actualSortBy, { ascending })
            .range(offset, offset + limit - 1);

        // Filtres optionnels
        if (minScore !== undefined) {
            query = query.gte('score', minScore);
        }
        if (maxScore !== undefined) {
            query = query.lte('score', maxScore);
        }

        const { data: ratings, error, count } = await query;

        if (error) {
            console.error('[RatingService] Erreur getRatingsForUser:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération des notations' };
        }

        return {
            success: true,
            data: {
                ratings,
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
        console.error('[RatingService] Erreur getRatingsForUser:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère toutes les notations d'une commande.
 *
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<{success: boolean, data: object[]|null, error: string|null}>}
 */
async function getRatingsByOrder(orderId) {
    try {
        const { data: ratings, error } = await supabase
            .from('ratings')
            .select(`
                id, score, comment, created_at,
                rater:rater_id (id),
                rated_user:rated_user_id (id)
            `)
            .eq('order_id', orderId)
            .eq('is_visible', true)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('[RatingService] Erreur getRatingsByOrder:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération des notations' };
        }

        return { success: true, data: ratings, error: null };
    } catch (error) {
        console.error('[RatingService] Erreur getRatingsByOrder:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Supprime (masque) une notation — action admin uniquement.
 * La notation n'est pas physiquement supprimée mais marquée invisible.
 * L'action est loggée dans admin_actions.
 *
 * @param {string} ratingId - UUID de la notation
 * @param {string} adminId - UUID de l'administrateur
 * @param {string} reason - Raison de la modération
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function deleteRating(ratingId, adminId, reason) {
    try {
        if (!reason || reason.trim().length === 0) {
            return { success: false, data: null, error: 'Une raison de modération est requise' };
        }

        // Vérifier que la notation existe
        const { data: rating, error: fetchError } = await supabase
            .from('ratings')
            .select('id, rated_user_id, is_visible')
            .eq('id', ratingId)
            .single();

        if (fetchError || !rating) {
            return { success: false, data: null, error: 'Notation introuvable' };
        }

        if (!rating.is_visible) {
            return { success: false, data: null, error: 'Cette notation est déjà modérée' };
        }

        // Masquer la notation
        const { data: updated, error: updateError } = await supabase
            .from('ratings')
            .update({
                is_visible: false,
                moderated_at: new Date().toISOString(),
                moderated_by: adminId,
                moderation_reason: reason.trim()
            })
            .eq('id', ratingId)
            .select('id, rated_user_id, is_visible, moderated_at')
            .single();

        if (updateError) {
            console.error('[RatingService] Erreur modération notation:', updateError);
            return { success: false, data: null, error: 'Erreur lors de la modération' };
        }

        // Logger l'action admin
        await supabase.from('admin_actions').insert({
            admin_id: adminId,
            action_type: 'rating_moderated',
            target_type: 'rating',
            target_id: ratingId,
            reason: reason.trim(),
            metadata: { rated_user_id: rating.rated_user_id }
        });

        // Note : Le trigger SQL recalcule automatiquement avg_rating

        return { success: true, data: updated, error: null };
    } catch (error) {
        console.error('[RatingService] Erreur deleteRating:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère la note moyenne d'un utilisateur.
 *
 * @param {string} userId - UUID de l'utilisateur
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getAverageRating(userId) {
    try {
        const { data: profile, error } = await supabase
            .from('profiles_data')
            .select('avg_rating, ratings_count')
            .eq('user_id', userId)
            .single();

        if (error) {
            console.error('[RatingService] Erreur getAverageRating:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération de la note moyenne' };
        }

        return {
            success: true,
            data: {
                avg_rating: Number(profile.avg_rating) || 0,
                ratings_count: profile.ratings_count || 0
            },
            error: null
        };
    } catch (error) {
        console.error('[RatingService] Erreur getAverageRating:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère la liste des notations pour l'admin (modération).
 *
 * @param {object} options - Options de filtrage et pagination
 * @param {number} [options.page=1] - Numéro de page
 * @param {number} [options.limit=20] - Nombre par page
 * @param {boolean} [options.includeHidden=false] - Inclure les notations modérées
 * @param {number} [options.minScore] - Score minimum
 * @param {number} [options.maxScore] - Score maximum
 * @param {string} [options.userId] - Filtrer par utilisateur noté
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getAdminRatings(options = {}) {
    try {
        const {
            page = 1,
            limit = 20,
            includeHidden = false,
            minScore,
            maxScore,
            userId
        } = options;

        const offset = (page - 1) * limit;

        let query = supabase
            .from('ratings')
            .select(`
                id, score, comment, is_visible, created_at, moderated_at, moderation_reason,
                rater:rater_id (id, email),
                rated_user:rated_user_id (id, email),
                order:order_id (id)
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (!includeHidden) {
            query = query.eq('is_visible', true);
        }
        if (minScore !== undefined) {
            query = query.gte('score', minScore);
        }
        if (maxScore !== undefined) {
            query = query.lte('score', maxScore);
        }
        if (userId) {
            query = query.eq('rated_user_id', userId);
        }

        const { data: ratings, error, count } = await query;

        if (error) {
            console.error('[RatingService] Erreur getAdminRatings:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération des notations' };
        }

        return {
            success: true,
            data: {
                ratings,
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
        console.error('[RatingService] Erreur getAdminRatings:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Sanitize un commentaire en supprimant les balises HTML potentiellement dangereuses.
 *
 * @param {string} text - Texte à sanitizer
 * @returns {string} Texte nettoyé
 * @private
 */
function sanitizeComment(text) {
    if (!text) return null;
    return text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .trim();
}

module.exports = {
    canUserRate,
    createRating,
    getRatingsForUser,
    getRatingsByOrder,
    deleteRating,
    getAverageRating,
    getAdminRatings
};
