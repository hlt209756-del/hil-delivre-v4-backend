'use strict';

/**
 * @fileoverview Contrôleur d'authentification pour Hil_Delivre v4.
 * Gère l'inscription, la connexion, la déconnexion, le refresh token,
 * le mot de passe oublié et la réinitialisation.
 *
 * Utilise Supabase Auth comme provider d'identité.
 * Le backend ne stocke JAMAIS les mots de passe.
 *
 * @module controllers/authController
 */

const { supabaseAdmin } = require('../services/supabaseService');

/**
 * POST /api/auth/register
 * Inscription d'un nouvel utilisateur.
 *
 * Flux :
 * 1. Valider les entrées (fait par le middleware validate)
 * 2. Créer l'utilisateur via Supabase Auth (signUp)
 * 3. Le trigger handle_new_user crée automatiquement le profil avec role='client'
 * 4. Mettre à jour le profil avec les données supplémentaires (nom, prénom, téléphone)
 * 5. Retourner les tokens et le profil
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function register(req, res) {
  try {
    const {
      email,
      password,
      phone_number,
      first_name,
      last_name,
      preferred_language,
      // cil_consent et terms_accepted sont validés par Joi mais pas stockés en BDD
      // (le fait d'arriver ici prouve le consentement — horodaté via created_at)
    } = req.body;

    // 1. Vérifier si l'email existe déjà (éviter les erreurs Supabase peu claires)
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const emailExists = existingUsers?.users?.some(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (emailExists) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'Un compte avec cette adresse email existe déjà.',
        },
      });
    }

    // 2. Créer l'utilisateur via Supabase Auth
    // NOTE : On ne passe PAS le rôle dans user_metadata (FIX-2 du schéma)
    const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Confirmer immédiatement (OTP SMS sera ajouté Sprint 6)
      user_metadata: {
        // Métadonnées non-sensibles uniquement (jamais le rôle)
        first_name,
        last_name,
      },
    });

    if (signUpError) {
      console.error('[authController.register] Erreur Supabase signUp:', signUpError.message);

      // Gestion des erreurs Supabase connues
      if (signUpError.message.includes('already registered')) {
        return res.status(409).json({
          success: false,
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'Un compte avec cette adresse email existe déjà.',
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: 'REGISTRATION_FAILED',
          message: 'Erreur lors de la création du compte. Veuillez réessayer.',
        },
      });
    }

    const userId = authData.user.id;

    // 3. Mettre à jour le profil créé par le trigger avec les données supplémentaires
    const { error: profileUpdateError } = await supabaseAdmin
      .from('profiles_data')
      .update({
        first_name,
        last_name,
        phone_number,
        preferred_language: preferred_language || 'fr',
      })
      .eq('user_id', userId);

    if (profileUpdateError) {
      console.error('[authController.register] Erreur mise à jour profil:', profileUpdateError.message);
      // Ne pas bloquer l'inscription — le profil pourra être complété plus tard
    }

    // 4. Générer une session pour l'utilisateur (signIn automatique après inscription)
    const { data: sessionData, error: signInError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    // Connexion directe pour retourner les tokens
    const { data: loginData, error: loginError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      // L'inscription a réussi mais la connexion auto a échoué
      // L'utilisateur devra se connecter manuellement
      return res.status(201).json({
        success: true,
        message: 'Compte créé avec succès. Veuillez vous connecter.',
        data: {
          user_id: userId,
        },
      });
    }

    // 5. Charger le profil complet
    const { data: profile } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', userId)
      .single();

    // 6. Log d'audit
    console.info(`[AUDIT] Inscription réussie: user_id=${userId}, email=${email}, ip=${req.ip}`);

    return res.status(201).json({
      success: true,
      message: 'Compte créé avec succès.',
      data: {
        user: {
          id: userId,
          email: authData.user.email,
        },
        profile: sanitizeProfile(profile),
        session: {
          access_token: loginData.session.access_token,
          refresh_token: loginData.session.refresh_token,
          expires_in: loginData.session.expires_in,
          expires_at: loginData.session.expires_at,
        },
      },
    });
  } catch (error) {
    console.error('[authController.register] Erreur inattendue:', error.message);
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
 * POST /api/auth/login
 * Connexion d'un utilisateur existant.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // 1. Authentifier via Supabase Auth
    const { data, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // Message générique pour ne pas révéler si l'email existe ou non
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Email ou mot de passe incorrect.',
        },
      });
    }

    const userId = data.user.id;

    // 2. Charger le profil
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error(`[authController.login] Profil introuvable pour user_id=${userId}`);
      return res.status(500).json({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Erreur de chargement du profil. Contactez le support.',
        },
      });
    }

    // 3. Vérifier que le compte est actif
    if (!profile.is_active) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Votre compte a été désactivé. Contactez le support.',
        },
      });
    }

    // 4. Log d'audit
    console.info(`[AUDIT] Connexion réussie: user_id=${userId}, email=${email}, role=${profile.role}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Connexion réussie.',
      data: {
        user: {
          id: userId,
          email: data.user.email,
        },
        profile: sanitizeProfile(profile),
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          expires_at: data.session.expires_at,
        },
      },
    });
  } catch (error) {
    console.error('[authController.login] Erreur inattendue:', error.message);
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
 * POST /api/auth/logout
 * Déconnexion de l'utilisateur (invalidation du token côté Supabase).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function logout(req, res) {
  try {
    // Invalider la session côté Supabase via le token admin
    const { error } = await supabaseAdmin.auth.admin.signOut(req.accessToken);

    if (error) {
      // Log mais ne pas bloquer — le token expirera de toute façon
      console.warn(`[authController.logout] Erreur Supabase signOut: ${error.message}`);
    }

    console.info(`[AUDIT] Déconnexion: user_id=${req.user.id}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Déconnexion réussie.',
    });
  } catch (error) {
    console.error('[authController.logout] Erreur inattendue:', error.message);
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
 * POST /api/auth/refresh
 * Rafraîchir le token d'accès avec un refresh_token.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function refreshToken(req, res) {
  try {
    const { refresh_token } = req.body;

    const { data, error } = await supabaseAdmin.auth.refreshSession({
      refresh_token,
    });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'REFRESH_TOKEN_INVALID',
          message: 'Token de rafraîchissement invalide ou expiré. Veuillez vous reconnecter.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Token rafraîchi avec succès.',
      data: {
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_in: data.session.expires_in,
          expires_at: data.session.expires_at,
        },
      },
    });
  } catch (error) {
    console.error('[authController.refreshToken] Erreur inattendue:', error.message);
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
 * POST /api/auth/forgot-password
 * Envoyer un email de réinitialisation de mot de passe.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    // Toujours retourner un succès pour ne pas révéler si l'email existe
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.APP_URL || 'https://app.hildelivre.bf'}/reset-password`,
    });

    if (error) {
      console.warn(`[authController.forgotPassword] Erreur Supabase: ${error.message}`);
      // Ne pas révéler l'erreur au client
    }

    console.info(`[AUDIT] Demande de réinitialisation mot de passe: email=${email}, ip=${req.ip}`);

    // Réponse identique que l'email existe ou non (sécurité)
    return res.status(200).json({
      success: true,
      message: 'Si un compte existe avec cette adresse, un email de réinitialisation a été envoyé.',
    });
  } catch (error) {
    console.error('[authController.forgotPassword] Erreur inattendue:', error.message);
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
 * POST /api/auth/reset-password
 * Réinitialiser le mot de passe avec un token de réinitialisation.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function resetPassword(req, res) {
  try {
    const { access_token, new_password } = req.body;

    // Vérifier le token et mettre à jour le mot de passe
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(access_token);

    if (verifyError || !user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'RESET_TOKEN_INVALID',
          message: 'Token de réinitialisation invalide ou expiré.',
        },
      });
    }

    // Mettre à jour le mot de passe via admin
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: new_password,
    });

    if (updateError) {
      console.error('[authController.resetPassword] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'PASSWORD_UPDATE_FAILED',
          message: 'Erreur lors de la mise à jour du mot de passe.',
        },
      });
    }

    console.info(`[AUDIT] Mot de passe réinitialisé: user_id=${user.id}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.',
    });
  } catch (error) {
    console.error('[authController.resetPassword] Erreur inattendue:', error.message);
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
 * Retire les champs internes/sensibles.
 *
 * @param {object} profile - Profil brut depuis la BDD
 * @returns {object} Profil nettoyé
 */
function sanitizeProfile(profile) {
  if (!profile) return null;

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
  register,
  login,
  logout,
  refreshToken,
  forgotPassword,
  resetPassword,
};
