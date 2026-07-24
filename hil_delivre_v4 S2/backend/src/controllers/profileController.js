'use strict';

/**
 * @fileoverview Contrôleur de gestion des profils utilisateur pour Hil_Delivre v4.
 * Gère la récupération et la mise à jour du profil, ainsi que la suppression
 * du compte (droit CIL).
 *
 * @module controllers/profileController
 */

const { supabaseAdmin } = require('../services/supabaseService');

/**
 * GET /api/user/profile
 * Récupérer le profil de l'utilisateur authentifié.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getProfile(req, res) {
  try {
    // Le profil est déjà chargé par le middleware authenticate
    const profile = req.profile;

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Profil introuvable.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        profile: sanitizeProfile(profile),
        user: {
          id: req.user.id,
          email: req.user.email,
        },
      },
    });
  } catch (error) {
    console.error('[profileController.getProfile] Erreur inattendue:', error.message);
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
 * PUT /api/user/profile
 * Mettre à jour le profil de l'utilisateur authentifié.
 *
 * Champs modifiables : first_name, last_name, display_name, phone_number,
 * address, latitude, longitude, preferred_language, default_waypoints.
 *
 * Champs NON modifiables par l'utilisateur : role, kyc_status, is_active,
 * wallet_balance, is_subscribed, score_rating (protégés côté serveur).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const updateData = req.body; // Déjà validé et nettoyé par le middleware validate

    // Double protection : s'assurer qu'aucun champ protégé n'est modifiable
    const PROTECTED_FIELDS = [
      'id', 'user_id', 'role', 'kyc_status', 'is_active',
      'wallet_balance', 'is_subscribed', 'subscription_start_date',
      'subscription_end_date', 'onboarding_fee_paid', 'score_rating',
      'total_ratings', 'id_document_url', 'business_registration_number',
      'created_at', 'updated_at',
    ];

    for (const field of PROTECTED_FIELDS) {
      delete updateData[field];
    }

    // Vérifier qu'il reste des données à mettre à jour
    if (Object.keys(updateData).length === 0) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'NO_UPDATABLE_FIELDS',
          message: 'Aucun champ modifiable fourni.',
        },
      });
    }

    // Mettre à jour via supabaseAdmin (bypass RLS pour garantir la mise à jour)
    const { data: updatedProfile, error: updateError } = await supabaseAdmin
      .from('profiles_data')
      .update(updateData)
      .eq('user_id', userId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[profileController.updateProfile] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'Erreur lors de la mise à jour du profil.',
        },
      });
    }

    console.info(`[AUDIT] Profil mis à jour: user_id=${userId}, champs=${Object.keys(updateData).join(',')}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Profil mis à jour avec succès.',
      data: {
        profile: sanitizeProfile(updatedProfile),
      },
    });
  } catch (error) {
    console.error('[profileController.updateProfile] Erreur inattendue:', error.message);
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
 * DELETE /api/user/profile
 * Supprimer le compte utilisateur (droit CIL — droit à l'effacement).
 * Désactive le compte et anonymise les données personnelles.
 * La suppression complète est différée (30 jours) pour permettre la récupération.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function deleteProfile(req, res) {
  try {
    const userId = req.user.id;

    // 1. Désactiver le profil et anonymiser les données personnelles
    const { error: updateError } = await supabaseAdmin
      .from('profiles_data')
      .update({
        is_active: false,
        first_name: '[SUPPRIMÉ]',
        last_name: '[SUPPRIMÉ]',
        display_name: '[SUPPRIMÉ]',
        phone_number: null,
        address: null,
        latitude: null,
        longitude: null,
        default_waypoints: '[]',
        id_document_url: null,
        business_registration_number: null,
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('[profileController.deleteProfile] Erreur anonymisation:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'DELETION_FAILED',
          message: 'Erreur lors de la suppression du compte.',
        },
      });
    }

    // 2. Désactiver l'utilisateur dans Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      ban_duration: '876000h', // ~100 ans — effectivement permanent
    });

    if (authError) {
      console.error('[profileController.deleteProfile] Erreur ban auth:', authError.message);
    }

    console.info(`[AUDIT] Compte supprimé (anonymisé): user_id=${userId}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Votre compte a été supprimé. Vos données personnelles ont été anonymisées conformément à la réglementation CIL.',
    });
  } catch (error) {
    console.error('[profileController.deleteProfile] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erreur interne. Veuillez réessayer ultérieurement.',
      },
    });
  }
}

// ============================================================
// HELPERS PRIVÉS
// ============================================================

/**
 * Nettoie le profil avant de l'envoyer au client.
 *
 * @param {object} profile - Profil brut depuis la BDD
 * @returns {object} Profil nettoyé
 */
function sanitizeProfile(profile) {
  if (!profile) return null;

  // Exclure id_document_url pour les non-admins (donnée sensible KYC)
  const {
    id,
    user_id,
    role,
    first_name,
    last_name,
    display_name,
    phone_number,
    address,
    latitude,
    longitude,
    preferred_language,
    default_waypoints,
    score_rating,
    total_ratings,
    kyc_status,
    is_subscribed,
    subscription_start_date,
    subscription_end_date,
    onboarding_fee_paid,
    wallet_balance,
    is_active,
    created_at,
    updated_at,
  } = profile;

  return {
    id,
    user_id,
    role,
    first_name,
    last_name,
    display_name,
    phone_number,
    address,
    latitude,
    longitude,
    preferred_language,
    default_waypoints,
    score_rating,
    total_ratings,
    kyc_status,
    is_subscribed,
    subscription_start_date,
    subscription_end_date,
    onboarding_fee_paid,
    wallet_balance,
    is_active,
    created_at,
    updated_at,
  };
}

module.exports = {
  getProfile,
  updateProfile,
  deleteProfile,
};
