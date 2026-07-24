'use strict';

/**
 * @fileoverview Contrôleur KYC (Know Your Customer) pour Hil_Delivre v4.
 * Gère la soumission des documents KYC par les marchands/livreurs
 * et la revue par les administrateurs.
 *
 * Flux KYC :
 * 1. Client crée un compte (role='client')
 * 2. Client soumet une demande KYC pour devenir marchand ou livreur
 * 3. Admin approuve ou rejette la demande
 * 4. Si approuvé, le rôle est mis à jour et l'accès aux fonctionnalités est débloqué
 *
 * @module controllers/kycController
 */

const { supabaseAdmin } = require('../services/supabaseService');

/**
 * POST /api/user/kyc
 * Soumettre une demande KYC pour devenir marchand ou livreur.
 *
 * Prérequis :
 * - L'utilisateur doit être authentifié
 * - L'utilisateur doit actuellement avoir le rôle 'client'
 * - Le KYC ne doit pas être déjà en cours (status != 'pending')
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function submitKYC(req, res) {
  try {
    const userId = req.user.id;
    const profile = req.profile;

    // 1. Vérifier que l'utilisateur est un client (seuls les clients peuvent demander un KYC)
    if (profile.role !== 'client') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'KYC_ALREADY_COMPLETED',
          message: `Vous avez déjà le rôle "${profile.role}". La demande KYC n'est pas applicable.`,
        },
      });
    }

    // 2. Vérifier qu'il n'y a pas déjà une demande KYC en cours
    if (profile.kyc_status === 'pending' && profile.id_document_url) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'KYC_ALREADY_PENDING',
          message: 'Une demande KYC est déjà en cours d\'examen. Veuillez patienter.',
        },
      });
    }

    const { requested_role, id_document_url, business_registration_number, display_name, address, latitude, longitude, phone_number } = req.body;

    // 3. Préparer les données de mise à jour
    const updateData = {
      kyc_status: 'pending',
      id_document_url,
    };

    // Champs spécifiques au rôle demandé
    if (requested_role === 'merchant') {
      updateData.business_registration_number = business_registration_number;
      updateData.display_name = display_name;
      updateData.address = address;
      if (latitude !== undefined) updateData.latitude = latitude;
      if (longitude !== undefined) updateData.longitude = longitude;
    }

    if (requested_role === 'delivery') {
      if (phone_number) updateData.phone_number = phone_number;
    }

    // 4. Mettre à jour le profil avec les données KYC
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles_data')
      .update(updateData)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[kycController.submitKYC] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'KYC_SUBMISSION_FAILED',
          message: 'Erreur lors de la soumission de la demande KYC.',
        },
      });
    }

    console.info(`[AUDIT] Demande KYC soumise: user_id=${userId}, requested_role=${requested_role}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Demande KYC soumise avec succès. Elle sera examinée sous 24-48h.',
      data: {
        kyc_status: updatedProfile.kyc_status,
        requested_role,
      },
    });
  } catch (error) {
    console.error('[kycController.submitKYC] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne. Veuillez réessayer ultérieurement.',
      },
    });
  }
}

/**
 * GET /api/user/kyc/status
 * Récupérer le statut KYC de l'utilisateur authentifié.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getKYCStatus(req, res) {
  try {
    const profile = req.profile;

    return res.status(200).json({
      success: true,
      data: {
        kyc_status: profile.kyc_status,
        role: profile.role,
        has_document: !!profile.id_document_url,
        has_business_registration: !!profile.business_registration_number,
      },
    });
  } catch (error) {
    console.error('[kycController.getKYCStatus] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne. Veuillez réessayer ultérieurement.',
      },
    });
  }
}

/**
 * PUT /api/admin/kyc/:userId/review
 * Approuver ou rejeter une demande KYC (admin uniquement).
 *
 * Si approuvé :
 * - Le rôle de l'utilisateur est mis à jour (client → merchant ou delivery)
 * - Le kyc_status passe à 'approved'
 *
 * Si rejeté :
 * - Le kyc_status passe à 'rejected'
 * - Les documents sont conservés pour référence
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function reviewKYC(req, res) {
  try {
    const { userId } = req.params;
    const { decision, rejection_reason, approved_role } = req.body;

    // 1. Vérifier que l'utilisateur cible existe
    const { data: targetProfile, error: fetchError } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (fetchError || !targetProfile) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Utilisateur introuvable.',
        },
      });
    }

    // 2. Vérifier que le KYC est en attente
    if (targetProfile.kyc_status !== 'pending') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'KYC_NOT_PENDING',
          message: `Le KYC de cet utilisateur n'est pas en attente (statut actuel : ${targetProfile.kyc_status}).`,
        },
      });
    }

    // 3. Vérifier que des documents ont été soumis
    if (!targetProfile.id_document_url) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'KYC_NO_DOCUMENTS',
          message: 'Aucun document KYC n\'a été soumis par cet utilisateur.',
        },
      });
    }

    // 4. Appliquer la décision
    const updateData = {
      kyc_status: decision,
    };

    if (decision === 'approved') {
      // Changer le rôle de l'utilisateur
      updateData.role = approved_role;
    }

    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles_data')
      .update(updateData)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[kycController.reviewKYC] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'KYC_REVIEW_FAILED',
          message: 'Erreur lors de la mise à jour du statut KYC.',
        },
      });
    }

    // 5. Log d'audit détaillé
    const auditDetails = {
      admin_id: req.user.id,
      target_user_id: userId,
      decision,
      approved_role: decision === 'approved' ? approved_role : null,
      rejection_reason: decision === 'rejected' ? rejection_reason : null,
    };
    console.info(`[AUDIT] KYC Review: ${JSON.stringify(auditDetails)}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: decision === 'approved'
        ? `KYC approuvé. L'utilisateur a maintenant le rôle "${approved_role}".`
        : `KYC rejeté. Raison : ${rejection_reason}`,
      data: {
        user_id: userId,
        kyc_status: updatedProfile.kyc_status,
        role: updatedProfile.role,
      },
    });
  } catch (error) {
    console.error('[kycController.reviewKYC] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne. Veuillez réessayer ultérieurement.',
      },
    });
  }
}

/**
 * GET /api/admin/kyc/pending
 * Lister toutes les demandes KYC en attente (admin uniquement).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listPendingKYC(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const { data: pendingProfiles, error, count } = await supabaseAdmin
      .from('profiles_data')
      .select('*', { count: 'exact' })
      .eq('kyc_status', 'pending')
      .not('id_document_url', 'is', null)
      .order('updated_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[kycController.listPendingKYC] Erreur requête:', error.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Erreur lors de la récupération des demandes KYC.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        profiles: pendingProfiles,
        pagination: {
          page,
          limit,
          total: count || 0,
          total_pages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error('[kycController.listPendingKYC] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne. Veuillez réessayer ultérieurement.',
      },
    });
  }
}

module.exports = {
  submitKYC,
  getKYCStatus,
  reviewKYC,
  listPendingKYC,
};
