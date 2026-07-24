'use strict';

/**
 * @fileoverview Middleware d'authentification pour Hil_Delivre v4.
 * Vérifie le JWT Supabase, extrait l'utilisateur et charge le profil/rôle
 * depuis profiles_data.
 *
 * @module middlewares/authMiddleware
 */

const { supabaseAdmin } = require('../services/supabaseService');

/**
 * Middleware d'authentification.
 * Extrait le Bearer token du header Authorization, le vérifie via Supabase Auth,
 * puis charge le profil utilisateur depuis profiles_data.
 *
 * Ajoute à req :
 * - req.user : { id, email, ... } (données auth.users)
 * - req.profile : { role, kyc_status, is_active, ... } (données profiles_data)
 * - req.accessToken : le JWT brut (pour créer un client Supabase authentifié si besoin)
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function authenticate(req, res, next) {
  try {
    // 1. Extraire le token du header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_TOKEN_MISSING',
          message: 'Token d\'authentification requis. Format attendu : Bearer <token>',
        },
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token || token.trim() === '') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_TOKEN_INVALID',
          message: 'Token d\'authentification invalide ou vide.',
        },
      });
    }

    // 2. Vérifier le JWT via Supabase Auth (service_role pour getUser)
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_TOKEN_EXPIRED',
          message: 'Token expiré ou invalide. Veuillez vous reconnecter.',
        },
      });
    }

    // 3. Charger le profil depuis profiles_data (source de vérité pour le rôle)
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles_data')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile) {
      // Cas extrême : utilisateur auth sans profil (ne devrait pas arriver grâce au trigger)
      console.error(`[authMiddleware] Profil introuvable pour user_id=${user.id}:`, profileError?.message);
      return res.status(403).json({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Profil utilisateur introuvable. Contactez le support.',
        },
      });
    }

    // 4. Vérifier que le compte est actif
    if (!profile.is_active) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Votre compte a été désactivé. Contactez le support.',
        },
      });
    }

    // 5. Attacher les données à la requête
    req.user = user;
    req.profile = profile;
    req.accessToken = token;

    next();
  } catch (error) {
    console.error('[authMiddleware] Erreur inattendue:', error.message);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_INTERNAL_ERROR',
        message: 'Erreur interne lors de l\'authentification.',
      },
    });
  }
}

/**
 * Middleware optionnel : authentifie si un token est présent, sinon continue.
 * Utile pour les endpoints publics qui offrent des fonctionnalités supplémentaires
 * aux utilisateurs authentifiés.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  // Si un token est présent, tenter l'authentification sans bloquer en cas d'échec
  try {
    await authenticate(req, res, () => {});
    // Si authenticate a envoyé une réponse d'erreur, ne pas continuer
    if (res.headersSent) {
      return;
    }
  } catch {
    // Ignorer les erreurs — l'utilisateur reste non-authentifié
  }

  next();
}

module.exports = {
  authenticate,
  optionalAuthenticate,
};
