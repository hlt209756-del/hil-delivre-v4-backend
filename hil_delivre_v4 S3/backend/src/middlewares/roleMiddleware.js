'use strict';

/**
 * @fileoverview Middleware de vérification des rôles et gating pour Hil_Delivre v4.
 * Implémente le contrôle d'accès basé sur les rôles (RBAC) et le statut KYC.
 *
 * @module middlewares/roleMiddleware
 */

/**
 * Middleware factory : vérifie que l'utilisateur possède l'un des rôles autorisés.
 * Doit être utilisé APRÈS le middleware authenticate.
 *
 * @param {...string} allowedRoles - Rôles autorisés ('client', 'merchant', 'delivery', 'admin')
 * @returns {import('express').RequestHandler} Middleware Express
 *
 * @example
 * router.get('/admin/users', authenticate, requireRole('admin'), controller.listUsers);
 * router.post('/menu', authenticate, requireRole('merchant'), controller.createMenu);
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.profile) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentification requise.',
        },
      });
    }

    const userRole = req.profile.role;

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_ROLE',
          message: `Accès refusé. Rôle requis : ${allowedRoles.join(' ou ')}.`,
        },
      });
    }

    next();
  };
}

/**
 * Middleware : vérifie que le KYC de l'utilisateur est approuvé.
 * Utilisé pour les fonctionnalités métier des marchands et livreurs.
 * Doit être utilisé APRÈS authenticate et requireRole.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 *
 * @example
 * router.post('/menu', authenticate, requireRole('merchant'), requireKYC, controller.createMenu);
 */
function requireKYC(req, res, next) {
  if (!req.profile) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentification requise.',
      },
    });
  }

  const { kyc_status, role } = req.profile;

  // Les clients et admins n'ont pas besoin de KYC
  if (role === 'client' || role === 'admin') {
    return next();
  }

  // Pour les marchands et livreurs, le KYC doit être approuvé
  if (kyc_status !== 'approved') {
    const messages = {
      pending: 'Votre vérification KYC est en cours d\'examen. Veuillez patienter.',
      rejected: 'Votre vérification KYC a été rejetée. Veuillez soumettre de nouveaux documents.',
    };

    return res.status(403).json({
      success: false,
      error: {
        code: 'KYC_NOT_APPROVED',
        message: messages[kyc_status] || 'Vérification KYC requise pour accéder à cette fonctionnalité.',
        kyc_status,
      },
    });
  }

  next();
}

/**
 * Middleware : vérifie que l'utilisateur a un abonnement actif.
 * Utilisé pour les fonctionnalités nécessitant un abonnement (marchands/livreurs).
 * Doit être utilisé APRÈS authenticate et requireRole.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireSubscription(req, res, next) {
  if (!req.profile) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Authentification requise.',
      },
    });
  }

  const { is_subscribed, subscription_end_date, role } = req.profile;

  // Les clients et admins n'ont pas besoin d'abonnement
  if (role === 'client' || role === 'admin') {
    return next();
  }

  // Vérifier l'abonnement actif et non expiré
  if (!is_subscribed) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Un abonnement actif est requis pour accéder à cette fonctionnalité.',
      },
    });
  }

  // Vérifier la date d'expiration
  if (subscription_end_date && new Date(subscription_end_date) < new Date()) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'SUBSCRIPTION_EXPIRED',
        message: 'Votre abonnement a expiré. Veuillez le renouveler.',
      },
    });
  }

  next();
}

module.exports = {
  requireRole,
  requireKYC,
  requireSubscription,
};
