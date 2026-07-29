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
 * Helper de log détaillé pour les erreurs Supabase/PostgREST.
 * Affiche TOUT ce que l'objet erreur contient (code, message, details, hint).
 */
function logSupabaseError(context, error) {
  console.error(`[${context}] Erreur Supabase détaillée:`, JSON.stringify(error, Object.getOwnPropertyNames(error || {}), 2));
}

/**
 * POST /api/auth/register
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
    } = req.body;

    // 1. Vérifier si l'email existe déjà
    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      logSupabaseError('authController.register.listUsers', listError);
    }
    const emailExists = existingUsers?.users?.some(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (emailExists) {
      return res.status(409).json({
        success: false,
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'Un compte avec cette adresse email existe déjà.' },
      });
    }

    // 2. Créer l'utilisateur via Supabase Auth
    const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name, last_name },
    });

    if (signUpError) {
      console.error('[authController.register] Erreur Supabase signUp:', signUpError.message);
      logSupabaseError('authController.register.signUp', signUpError);

      if (signUpError.message.includes('already registered')) {
        return res.status(409).json({
          success: false,
          error: { code: 'EMAIL_ALREADY_EXISTS', message: 'Un compte avec cette adresse email existe déjà.' },
        });
      }

      return res.status(500).json({
        success: false,
        error: { code: 'REGISTRATION_FAILED', message: 'Erreur lors de la création du compte. Veuillez réessayer.' },
      });
    }

    const userId = authData.user.id;
    console.info(`[authController.register] Utilisateur auth créé: userId=${userId}`);

    // 3. Mettre à jour le profil créé par le trigger
    const { data: updatedProfile, error: profileUpdateError } = await supabaseAdmin
      .from('profiles_data')
      .update({
        first_name,
        last_name,
        phone_number,
        preferred_language: preferred_language || 'fr',
      })
      .eq('user_id', userId)
      .select();

    if (profileUpdateError) {
      console.error('[authController.register] Erreur mise à jour profil:', profileUpdateError.message);
      logSupabaseError('authController.register.updateProfile', profileUpdateError);
    } else {
      console.info(`[authController.register] UPDATE profil résultat: ${JSON.stringify(updatedProfile)}`);
    }

    // 4. Connexion directe pour retourner les tokens
    const { data: loginData, error: loginError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (loginError) {
      logSupabaseError('authController.register.autoLogin', loginError);
      return res.status(201).json({
        success: true,
        message: 'Compte créé avec succès. Veuillez vous connecter.',
        data: { user_id: userId },
      });
    }

    // 5. Charger le profil complet
    const { data: profile, error: profileFetchError } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileFetchError) {
      console.error('[authController.register] Erreur chargement profil final:', profileFetchError.message);
      logSupabaseError('authController.register.fetchProfile', profileFetchError);
    } else {
      console.info(`[authController.register] Profil chargé après inscription: ${profile ? 'trouvé' : 'NULL'}`);
    }

    // 6. Log d'audit
    console.info(`[AUDIT] Inscription réussie: user_id=${userId}, email=${email}, ip=${req.ip}`);

    return res.status(201).json({
      success: true,
      message: 'Compte créé avec succès.',
      data: {
        user: { id: userId, email: authData.user.email },
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
    console.error('[authController.register] Erreur inattendue:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne. Veuillez réessayer ultérieurement.' },
    });
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // 1. Authentifier via Supabase Auth
    const { data, error: signInError } = await supabaseAdmin.auth.signInWithPassword({ email, password });

    if (signInError) {
      logSupabaseError('authController.login.signIn', signInError);
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email ou mot de passe incorrect.' },
      });
    }

    const userId = data.user.id;
    console.info(`[authController.login] Auth réussie, recherche profil pour userId=${userId}`);

    // 2. Charger le profil — maybeSingle() au lieu de single() pour ne pas throw sur 0 ligne
    const { data: profile, error: profileError, status, statusText } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    console.info(`[authController.login] Résultat requête profil — status=${status} statusText=${statusText}`);

    if (profileError) {
      console.error(`[authController.login] Erreur lors du chargement du profil pour user_id=${userId}`);
      logSupabaseError('authController.login.fetchProfile', profileError);
      return res.status(500).json({
        success: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'Erreur de chargement du profil. Contactez le support.' },
      });
    }

    if (!profile) {
      console.error(`[authController.login] Aucun profil retourné (profile=null) pour user_id=${userId} — mais aucune erreur Supabase.`);
      return res.status(500).json({
        success: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'Erreur de chargement du profil. Contactez le support.' },
      });
    }

    // 3. Vérifier que le compte est actif
    if (!profile.is_active) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCOUNT_DEACTIVATED', message: 'Votre compte a été désactivé. Contactez le support.' },
      });
    }

    // 4. Log d'audit
    console.info(`[AUDIT] Connexion réussie: user_id=${userId}, email=${email}, role=${profile.role}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Connexion réussie.',
      data: {
        user: { id: userId, email: data.user.email },
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
    console.error('[authController.login] Erreur inattendue:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne. Veuillez réessayer ultérieurement.' },
    });
  }
}

/**
 * POST /api/auth/logout
 */
async function logout(req, res) {
  try {
    const { error } = await supabaseAdmin.auth.admin.signOut(req.accessToken);
    if (error) {
      console.warn(`[authController.logout] Erreur Supabase signOut: ${error.message}`);
    }
    console.info(`[AUDIT] Déconnexion: user_id=${req.user.id}, ip=${req.ip}`);
    return res.status(200).json({ success: true, message: 'Déconnexion réussie.' });
  } catch (error) {
    console.error('[authController.logout] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne. Veuillez réessayer ultérieurement.' },
    });
  }
}

/**
 * POST /api/auth/refresh
 */
async function refreshToken(req, res) {
  try {
    const { refresh_token } = req.body;
    const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });

    if (error || !data.session) {
      return res.status(401).json({
        success: false,
        error: { code: 'REFRESH_TOKEN_INVALID', message: 'Token de rafraîchissement invalide ou expiré. Veuillez vous reconnecter.' },
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
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne. Veuillez réessayer ultérieurement.' },
    });
  }
}

/**
 * POST /api/auth/forgot-password
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.APP_URL || 'https://app.hildelivre.bf'}/reset-password`,
    });

    if (error) {
      console.warn(`[authController.forgotPassword] Erreur Supabase: ${error.message}`);
    }

    console.info(`[AUDIT] Demande de réinitialisation mot de passe: email=${email}, ip=${req.ip}`);

    return res.status(200).json({
      success: true,
      message: 'Si un compte existe avec cette adresse, un email de réinitialisation a été envoyé.',
    });
  } catch (error) {
    console.error('[authController.forgotPassword] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne. Veuillez réessayer ultérieurement.' },
    });
  }
}

/**
 * POST /api/auth/reset-password
 */
async function resetPassword(req, res) {
  try {
    const { access_token, new_password } = req.body;
    const { data: { user }, error: verifyError } = await supabaseAdmin.auth.getUser(access_token);

    if (verifyError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'RESET_TOKEN_INVALID', message: 'Token de réinitialisation invalide ou expiré.' },
      });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: new_password });

    if (updateError) {
      console.error('[authController.resetPassword] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: { code: 'PASSWORD_UPDATE_FAILED', message: 'Erreur lors de la mise à jour du mot de passe.' },
      });
    }

    console.info(`[AUDIT] Mot de passe réinitialisé: user_id=${user.id}, ip=${req.ip}`);

    return res.status(200).json({ success: true, message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.' });
  } catch (error) {
    console.error('[authController.resetPassword] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Erreur interne. Veuillez réessayer ultérieurement.' },
    });
  }
}

// ============================================================
// HELPERS PRIVÉS
// ============================================================

function sanitizeProfile(profile) {
  if (!profile) return null;

  const {
    id, user_id, role, first_name, last_name, display_name, phone_number,
    address, latitude, longitude, preferred_language, default_waypoints,
    score_rating, total_ratings, kyc_status, is_subscribed,
    subscription_start_date, subscription_end_date, onboarding_fee_paid,
    wallet_balance, is_active, created_at, updated_at,
  } = profile;

  return {
    id, user_id, role, first_name, last_name, display_name, phone_number,
    address, latitude, longitude, preferred_language, default_waypoints,
    score_rating, total_ratings, kyc_status, is_subscribed,
    subscription_start_date, subscription_end_date, onboarding_fee_paid,
    wallet_balance, is_active, created_at, updated_at,
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