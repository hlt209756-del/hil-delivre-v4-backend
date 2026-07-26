'use strict';

/**
 * @fileoverview Service de certification hygiène "Hil_Delivre Qualité" pour Hil_Delivre v4.
 * Gère les demandes, approbations, révocations et renouvellements
 * des certifications d'hygiène des marchands.
 * @module services/certificationService
 */

const supabase = require('../config/supabase');

/** Frais de certification par défaut en FCFA */
const DEFAULT_CERTIFICATION_FEE = 5000;

/** Durée de validité en mois */
const CERTIFICATION_VALIDITY_MONTHS = 12;

/**
 * Récupère les frais de certification depuis platform_config.
 *
 * @returns {Promise<number>} Montant des frais en FCFA
 * @private
 */
async function getCertificationFee() {
    try {
        const { data } = await supabase
            .from('platform_config')
            .select('config_value')
            .eq('config_key', 'certification_fee')
            .single();

        return data ? Number(data.config_value) : DEFAULT_CERTIFICATION_FEE;
    } catch (error) {
        console.error('[CertificationService] Erreur getCertificationFee:', error);
        return DEFAULT_CERTIFICATION_FEE;
    }
}

/**
 * Demande une certification hygiène pour un marchand.
 * Vérifie le KYC, le wallet_balance, et qu'aucune certification active n'existe.
 * Débite le wallet du marchand.
 *
 * @param {string} merchantId - UUID du marchand
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function requestCertification(merchantId) {
    try {
        // Vérifier que l'utilisateur est un marchand avec KYC approuvé
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, role')
            .eq('id', merchantId)
            .eq('role', 'merchant')
            .single();

        if (userError || !user) {
            return { success: false, data: null, error: 'Marchand introuvable' };
        }

        // Vérifier le statut KYC
        const { data: profile, error: profileError } = await supabase
            .from('profiles_data')
            .select('kyc_status, wallet_balance, is_certified')
            .eq('user_id', merchantId)
            .single();

        if (profileError || !profile) {
            return { success: false, data: null, error: 'Profil marchand introuvable' };
        }

        if (profile.kyc_status !== 'approved') {
            return { success: false, data: null, error: 'Le KYC doit être approuvé avant de demander la certification' };
        }

        // Vérifier qu'il n'y a pas de certification active ou en attente
        const { data: existingCert } = await supabase
            .from('certification_hygiene')
            .select('id, status, expiration_date')
            .eq('merchant_id', merchantId)
            .in('status', ['pending', 'certified'])
            .maybeSingle();

        if (existingCert) {
            if (existingCert.status === 'pending') {
                return { success: false, data: null, error: 'Une demande de certification est déjà en attente' };
            }
            if (existingCert.status === 'certified' && new Date(existingCert.expiration_date) > new Date()) {
                return { success: false, data: null, error: 'Vous avez déjà une certification active. Utilisez le renouvellement.' };
            }
        }

        // Vérifier le solde du wallet
        const fee = await getCertificationFee();
        const walletBalance = Number(profile.wallet_balance) || 0;

        if (walletBalance < fee) {
            return {
                success: false,
                data: null,
                error: `Solde insuffisant. Frais de certification : ${fee} FCFA. Votre solde : ${walletBalance} FCFA`
            };
        }

        // Débiter le wallet du marchand
        const { error: debitError } = await supabase
            .from('profiles_data')
            .update({
                wallet_balance: walletBalance - fee,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', merchantId);

        if (debitError) {
            console.error('[CertificationService] Erreur débit wallet:', debitError);
            return { success: false, data: null, error: 'Erreur lors du débit du portefeuille' };
        }

        // Créer la demande de certification
        const { data: certification, error: insertError } = await supabase
            .from('certification_hygiene')
            .insert({
                merchant_id: merchantId,
                status: 'pending',
                fee_amount: fee,
                fee_paid: true,
                payment_reference: `CERT-${Date.now()}-${merchantId.substring(0, 8)}`
            })
            .select('id, merchant_id, status, fee_amount, fee_paid, payment_reference, created_at')
            .single();

        if (insertError) {
            console.error('[CertificationService] Erreur création certification:', insertError);
            // Rembourser en cas d'échec
            await supabase
                .from('profiles_data')
                .update({
                    wallet_balance: walletBalance,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', merchantId);
            return { success: false, data: null, error: 'Erreur lors de la création de la demande' };
        }

        // Logger la transaction dans admin_wallet_transactions
        await supabase.from('admin_wallet_transactions').insert({
            type: 'certification_fee_in',
            amount: fee,
            related_entity_id: certification.id,
            description: `Frais de certification hygiène - Marchand ${merchantId.substring(0, 8)}`
        });

        return {
            success: true,
            data: {
                ...certification,
                message: `Demande de certification soumise. ${fee} FCFA débités de votre portefeuille.`
            },
            error: null
        };
    } catch (error) {
        console.error('[CertificationService] Erreur requestCertification:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Approuve une certification hygiène (action admin).
 * Définit la date de certification et d'expiration (+1 an).
 *
 * @param {string} certificationId - UUID de la certification
 * @param {string} adminId - UUID de l'administrateur
 * @param {string} [notes] - Notes optionnelles de l'admin
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function approveCertification(certificationId, adminId, notes = null) {
    try {
        // Récupérer la certification
        const { data: cert, error: fetchError } = await supabase
            .from('certification_hygiene')
            .select('id, merchant_id, status')
            .eq('id', certificationId)
            .single();

        if (fetchError || !cert) {
            return { success: false, data: null, error: 'Certification introuvable' };
        }

        if (cert.status !== 'pending') {
            return { success: false, data: null, error: `Impossible d'approuver une certification au statut "${cert.status}"` };
        }

        // Calculer les dates
        const certificationDate = new Date();
        const expirationDate = new Date();
        expirationDate.setMonth(expirationDate.getMonth() + CERTIFICATION_VALIDITY_MONTHS);

        // Mettre à jour la certification
        const { data: updated, error: updateError } = await supabase
            .from('certification_hygiene')
            .update({
                status: 'certified',
                certification_date: certificationDate.toISOString(),
                expiration_date: expirationDate.toISOString(),
                admin_id: adminId,
                notes: notes ? notes.trim() : null
            })
            .eq('id', certificationId)
            .select('id, merchant_id, status, certification_date, expiration_date, admin_id, notes, updated_at')
            .single();

        if (updateError) {
            console.error('[CertificationService] Erreur approbation:', updateError);
            return { success: false, data: null, error: 'Erreur lors de l\'approbation' };
        }

        // Mettre à jour le badge dans profiles_data
        await supabase
            .from('profiles_data')
            .update({ is_certified: true, updated_at: new Date().toISOString() })
            .eq('user_id', cert.merchant_id);

        // Logger l'action admin
        await supabase.from('admin_actions').insert({
            admin_id: adminId,
            action_type: 'certification_approved',
            target_type: 'certification_hygiene',
            target_id: certificationId,
            reason: notes || 'Certification approuvée',
            metadata: { merchant_id: cert.merchant_id, expiration_date: expirationDate.toISOString() }
        });

        return { success: true, data: updated, error: null };
    } catch (error) {
        console.error('[CertificationService] Erreur approveCertification:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Révoque une certification hygiène (action admin).
 *
 * @param {string} certificationId - UUID de la certification
 * @param {string} adminId - UUID de l'administrateur
 * @param {string} reason - Raison de la révocation (obligatoire)
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function revokeCertification(certificationId, adminId, reason) {
    try {
        if (!reason || reason.trim().length === 0) {
            return { success: false, data: null, error: 'Une raison de révocation est requise' };
        }

        // Récupérer la certification
        const { data: cert, error: fetchError } = await supabase
            .from('certification_hygiene')
            .select('id, merchant_id, status')
            .eq('id', certificationId)
            .single();

        if (fetchError || !cert) {
            return { success: false, data: null, error: 'Certification introuvable' };
        }

        if (cert.status === 'revoked') {
            return { success: false, data: null, error: 'Cette certification est déjà révoquée' };
        }

        if (cert.status !== 'certified' && cert.status !== 'pending') {
            return { success: false, data: null, error: `Impossible de révoquer une certification au statut "${cert.status}"` };
        }

        // Révoquer
        const { data: updated, error: updateError } = await supabase
            .from('certification_hygiene')
            .update({
                status: 'revoked',
                admin_id: adminId,
                rejection_reason: reason.trim()
            })
            .eq('id', certificationId)
            .select('id, merchant_id, status, rejection_reason, updated_at')
            .single();

        if (updateError) {
            console.error('[CertificationService] Erreur révocation:', updateError);
            return { success: false, data: null, error: 'Erreur lors de la révocation' };
        }

        // Retirer le badge
        await supabase
            .from('profiles_data')
            .update({ is_certified: false, updated_at: new Date().toISOString() })
            .eq('user_id', cert.merchant_id);

        // Logger l'action admin
        await supabase.from('admin_actions').insert({
            admin_id: adminId,
            action_type: 'certification_revoked',
            target_type: 'certification_hygiene',
            target_id: certificationId,
            reason: reason.trim(),
            metadata: { merchant_id: cert.merchant_id }
        });

        return { success: true, data: updated, error: null };
    } catch (error) {
        console.error('[CertificationService] Erreur revokeCertification:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère le statut de certification actuel d'un marchand.
 *
 * @param {string} merchantId - UUID du marchand
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getCertificationStatus(merchantId) {
    try {
        // Récupérer la certification la plus récente
        const { data: cert, error } = await supabase
            .from('certification_hygiene')
            .select('id, status, certification_date, expiration_date, fee_amount, fee_paid, created_at, updated_at')
            .eq('merchant_id', merchantId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('[CertificationService] Erreur getCertificationStatus:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération du statut' };
        }

        if (!cert) {
            return {
                success: true,
                data: {
                    is_certified: false,
                    status: 'none',
                    message: 'Aucune certification. Vous pouvez en demander une.',
                    fee: await getCertificationFee()
                },
                error: null
            };
        }

        // Vérifier si la certification est expirée (mais pas encore marquée)
        const isExpired = cert.status === 'certified' &&
            cert.expiration_date &&
            new Date(cert.expiration_date) < new Date();

        // Calculer les jours restants
        let daysRemaining = null;
        if (cert.status === 'certified' && cert.expiration_date && !isExpired) {
            daysRemaining = Math.ceil(
                (new Date(cert.expiration_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
        }

        return {
            success: true,
            data: {
                ...cert,
                is_certified: cert.status === 'certified' && !isExpired,
                is_expired: isExpired,
                days_remaining: daysRemaining,
                can_renew: isExpired || cert.status === 'expired' || cert.status === 'revoked',
                fee: await getCertificationFee()
            },
            error: null
        };
    } catch (error) {
        console.error('[CertificationService] Erreur getCertificationStatus:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Récupère la liste des certifications (admin, paginée avec filtres).
 *
 * @param {object} options - Options de filtrage et pagination
 * @param {number} [options.page=1] - Numéro de page
 * @param {number} [options.limit=20] - Nombre par page
 * @param {string} [options.status] - Filtrer par statut
 * @param {string} [options.merchantId] - Filtrer par marchand
 * @param {boolean} [options.expiringWithin30Days] - Certifications expirant dans 30 jours
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function getCertifications(options = {}) {
    try {
        const { page = 1, limit = 20, status, merchantId, expiringWithin30Days } = options;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('certification_hygiene')
            .select(`
                id, merchant_id, status, certification_date, expiration_date,
                fee_amount, fee_paid, payment_reference, admin_id, rejection_reason, notes,
                created_at, updated_at
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) {
            query = query.eq('status', status);
        }
        if (merchantId) {
            query = query.eq('merchant_id', merchantId);
        }
        if (expiringWithin30Days) {
            const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            query = query
                .eq('status', 'certified')
                .lte('expiration_date', thirtyDaysFromNow)
                .gte('expiration_date', new Date().toISOString());
        }

        const { data: certifications, error, count } = await query;

        if (error) {
            console.error('[CertificationService] Erreur getCertifications:', error);
            return { success: false, data: null, error: 'Erreur lors de la récupération des certifications' };
        }

        return {
            success: true,
            data: {
                certifications: certifications || [],
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
        console.error('[CertificationService] Erreur getCertifications:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Renouvelle une certification expirée ou révoquée.
 * Même processus que requestCertification mais pour un renouvellement.
 *
 * @param {string} merchantId - UUID du marchand
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function renewCertification(merchantId) {
    try {
        // Vérifier qu'il existe une certification expirée ou révoquée
        const { data: lastCert } = await supabase
            .from('certification_hygiene')
            .select('id, status, expiration_date')
            .eq('merchant_id', merchantId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!lastCert) {
            return { success: false, data: null, error: 'Aucune certification précédente trouvée. Utilisez la demande initiale.' };
        }

        if (lastCert.status === 'pending') {
            return { success: false, data: null, error: 'Une demande est déjà en attente d\'approbation' };
        }

        if (lastCert.status === 'certified' && new Date(lastCert.expiration_date) > new Date()) {
            return { success: false, data: null, error: 'Votre certification est encore active. Le renouvellement sera possible 30 jours avant expiration.' };
        }

        // Permettre le renouvellement si expirée, révoquée, ou dans les 30 derniers jours
        const canRenew = lastCert.status === 'expired' ||
            lastCert.status === 'revoked' ||
            (lastCert.status === 'certified' && lastCert.expiration_date &&
                new Date(lastCert.expiration_date).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000);

        if (!canRenew) {
            return { success: false, data: null, error: 'Le renouvellement n\'est pas disponible actuellement' };
        }

        // Utiliser le même processus que la demande initiale
        return await requestCertification(merchantId);
    } catch (error) {
        console.error('[CertificationService] Erreur renewCertification:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

/**
 * Vérifie et marque les certifications expirées. À appeler via un cron job.
 *
 * @returns {Promise<{success: boolean, data: object|null, error: string|null}>}
 */
async function checkExpirations() {
    try {
        // Trouver les certifications expirées non encore marquées
        const { data: expiredCerts, error: fetchError } = await supabase
            .from('certification_hygiene')
            .select('id, merchant_id')
            .eq('status', 'certified')
            .lt('expiration_date', new Date().toISOString());

        if (fetchError) {
            console.error('[CertificationService] Erreur checkExpirations fetch:', fetchError);
            return { success: false, data: null, error: 'Erreur lors de la vérification des expirations' };
        }

        if (!expiredCerts || expiredCerts.length === 0) {
            return { success: true, data: { expired_count: 0 }, error: null };
        }

        // Marquer comme expirées
        const expiredIds = expiredCerts.map(c => c.id);
        const { error: updateError } = await supabase
            .from('certification_hygiene')
            .update({ status: 'expired' })
            .in('id', expiredIds);

        if (updateError) {
            console.error('[CertificationService] Erreur checkExpirations update:', updateError);
            return { success: false, data: null, error: 'Erreur lors de la mise à jour des expirations' };
        }

        // Retirer les badges
        const merchantIds = expiredCerts.map(c => c.merchant_id);
        await supabase
            .from('profiles_data')
            .update({ is_certified: false, updated_at: new Date().toISOString() })
            .in('user_id', merchantIds);

        return {
            success: true,
            data: {
                expired_count: expiredCerts.length,
                merchant_ids: merchantIds
            },
            error: null
        };
    } catch (error) {
        console.error('[CertificationService] Erreur checkExpirations:', error);
        return { success: false, data: null, error: 'Erreur interne du serveur' };
    }
}

module.exports = {
    requestCertification,
    approveCertification,
    revokeCertification,
    getCertificationStatus,
    getCertifications,
    renewCertification,
    checkExpirations
};
