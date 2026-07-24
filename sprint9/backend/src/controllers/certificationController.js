'use strict';

/**
 * @fileoverview Controller pour les endpoints de certification hygiène.
 * Gère les requêtes HTTP liées aux certifications "Hil_Delivre Qualité".
 * @module controllers/certificationController
 */

const certificationService = require('../services/certificationService');

/**
 * POST /api/merchant/certify
 * Demande une certification hygiène.
 * Rôle : merchant
 */
async function requestCertification(req, res) {
    try {
        const merchantId = req.user.id;

        const result = await certificationService.requestCertification(merchantId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(201).json({
            success: true,
            message: result.data.message,
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur requestCertification:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * POST /api/merchant/certify/renew
 * Renouvelle une certification expirée.
 * Rôle : merchant
 */
async function renewCertification(req, res) {
    try {
        const merchantId = req.user.id;

        const result = await certificationService.renewCertification(merchantId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(201).json({
            success: true,
            message: 'Demande de renouvellement soumise',
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur renewCertification:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/merchant/certification
 * Récupère le statut de certification du marchand connecté.
 * Rôle : merchant
 */
async function getMyStatus(req, res) {
    try {
        const merchantId = req.user.id;

        const result = await certificationService.getCertificationStatus(merchantId);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Statut de certification récupéré',
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur getMyStatus:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * GET /api/admin/certification-hygiene
 * Liste des certifications (admin, paginée avec filtres).
 * Rôle : admin
 */
async function adminGetCertifications(req, res) {
    try {
        const { page, limit, status, merchant_id, expiring_soon } = req.query;

        const result = await certificationService.getCertifications({
            page: page ? parseInt(page, 10) : 1,
            limit: limit ? parseInt(limit, 10) : 20,
            status: status || undefined,
            merchantId: merchant_id || undefined,
            expiringWithin30Days: expiring_soon === 'true'
        });

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Certifications récupérées',
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur adminGetCertifications:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * PUT /api/admin/certification-hygiene/:certificationId/approve
 * Approuve une certification (admin).
 * Rôle : admin
 */
async function adminApprove(req, res) {
    try {
        const { certificationId } = req.params;
        const { notes } = req.body;
        const adminId = req.user.id;

        const result = await certificationService.approveCertification(certificationId, adminId, notes);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Certification approuvée',
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur adminApprove:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * PUT /api/admin/certification-hygiene/:certificationId/revoke
 * Révoque une certification (admin).
 * Rôle : admin
 */
async function adminRevoke(req, res) {
    try {
        const { certificationId } = req.params;
        const { reason } = req.body;
        const adminId = req.user.id;

        const result = await certificationService.revokeCertification(certificationId, adminId, reason);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Certification révoquée',
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur adminRevoke:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

/**
 * POST /api/admin/certification-hygiene/check-expirations
 * Déclenche la vérification des expirations (admin/cron).
 * Rôle : admin
 */
async function adminCheckExpirations(req, res) {
    try {
        const result = await certificationService.checkExpirations();

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error,
                error: result.error
            });
        }

        // Logger l'action admin
        const supabase = require('../config/supabase');
        await supabase.from('admin_actions').insert({
            admin_id: req.user.id,
            action_type: 'certification_expiration_check',
            target_type: 'certification_hygiene',
            target_id: null,
            reason: 'Vérification manuelle des expirations',
            metadata: result.data
        });

        return res.status(200).json({
            success: true,
            message: `${result.data.expired_count} certification(s) expirée(s)`,
            data: result.data
        });
    } catch (error) {
        console.error('[CertificationController] Erreur adminCheckExpirations:', error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur',
            error: 'INTERNAL_SERVER_ERROR'
        });
    }
}

module.exports = {
    requestCertification,
    renewCertification,
    getMyStatus,
    adminGetCertifications,
    adminApprove,
    adminRevoke,
    adminCheckExpirations
};
