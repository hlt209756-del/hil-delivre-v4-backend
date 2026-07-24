'use strict';

/**
 * @fileoverview Schémas de validation Joi et middleware de validation pour Hil_Delivre v4.
 * Tous les inputs utilisateur sont validés AVANT d'atteindre les contrôleurs.
 *
 * @module middlewares/validationMiddleware
 */

const Joi = require('joi');

// ============================================================
// CONSTANTES DE VALIDATION
// ============================================================

/**
 * Regex pour numéro de téléphone au format Burkina Faso.
 * Formats acceptés : +226XXXXXXXX, 226XXXXXXXX, 0XXXXXXXX, XXXXXXXX (8 chiffres)
 * Opérateurs : Orange (07), Moov (06, 05), Telecel (02)
 */
const PHONE_REGEX_BF = /^(\+?226)?(0?[0-9]{8})$/;

/**
 * Mot de passe fort : minimum 8 caractères, au moins 1 majuscule, 1 minuscule,
 * 1 chiffre et 1 caractère spécial.
 */
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,72}$/;

// ============================================================
// SCHÉMAS DE VALIDATION
// ============================================================

/**
 * Schéma d'inscription utilisateur.
 */
const registerSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .max(255)
    .lowercase()
    .trim()
    .messages({
      'string.email': 'Adresse email invalide.',
      'any.required': 'L\'adresse email est requise.',
      'string.max': 'L\'adresse email ne doit pas dépasser 255 caractères.',
    }),

  password: Joi.string()
    .required()
    .min(8)
    .max(72)
    .pattern(PASSWORD_REGEX)
    .messages({
      'any.required': 'Le mot de passe est requis.',
      'string.min': 'Le mot de passe doit contenir au moins 8 caractères.',
      'string.max': 'Le mot de passe ne doit pas dépasser 72 caractères.',
      'string.pattern.base': 'Le mot de passe doit contenir au moins 1 majuscule, 1 minuscule, 1 chiffre et 1 caractère spécial.',
    }),

  phone_number: Joi.string()
    .pattern(PHONE_REGEX_BF)
    .required()
    .messages({
      'string.pattern.base': 'Numéro de téléphone invalide. Format attendu : +226XXXXXXXX ou XXXXXXXX.',
      'any.required': 'Le numéro de téléphone est requis.',
    }),

  first_name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'any.required': 'Le prénom est requis.',
      'string.min': 'Le prénom doit contenir au moins 2 caractères.',
      'string.max': 'Le prénom ne doit pas dépasser 100 caractères.',
    }),

  last_name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'any.required': 'Le nom est requis.',
      'string.min': 'Le nom doit contenir au moins 2 caractères.',
      'string.max': 'Le nom ne doit pas dépasser 100 caractères.',
    }),

  preferred_language: Joi.string()
    .valid('fr', 'mo', 'di')
    .default('fr')
    .messages({
      'any.only': 'Langue non supportée. Valeurs acceptées : fr, mo, di.',
    }),

  // Consentement CIL obligatoire
  cil_consent: Joi.boolean()
    .valid(true)
    .required()
    .messages({
      'any.only': 'Vous devez accepter la politique de confidentialité et le traitement de vos données.',
      'any.required': 'Le consentement au traitement des données est requis.',
    }),

  // Consentement conditions d'utilisation
  terms_accepted: Joi.boolean()
    .valid(true)
    .required()
    .messages({
      'any.only': 'Vous devez accepter les conditions d\'utilisation.',
      'any.required': 'L\'acceptation des conditions d\'utilisation est requise.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de connexion.
 */
const loginSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .max(255)
    .lowercase()
    .trim()
    .messages({
      'string.email': 'Adresse email invalide.',
      'any.required': 'L\'adresse email est requise.',
    }),

  password: Joi.string()
    .required()
    .max(72)
    .messages({
      'any.required': 'Le mot de passe est requis.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de rafraîchissement de token.
 */
const refreshTokenSchema = Joi.object({
  refresh_token: Joi.string()
    .required()
    .messages({
      'any.required': 'Le refresh_token est requis.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de mot de passe oublié.
 */
const forgotPasswordSchema = Joi.object({
  email: Joi.string()
    .email({ tlds: { allow: false } })
    .required()
    .max(255)
    .lowercase()
    .trim()
    .messages({
      'string.email': 'Adresse email invalide.',
      'any.required': 'L\'adresse email est requise.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de réinitialisation de mot de passe.
 */
const resetPasswordSchema = Joi.object({
  access_token: Joi.string()
    .required()
    .messages({
      'any.required': 'Le token de réinitialisation est requis.',
    }),

  new_password: Joi.string()
    .required()
    .min(8)
    .max(72)
    .pattern(PASSWORD_REGEX)
    .messages({
      'any.required': 'Le nouveau mot de passe est requis.',
      'string.min': 'Le mot de passe doit contenir au moins 8 caractères.',
      'string.max': 'Le mot de passe ne doit pas dépasser 72 caractères.',
      'string.pattern.base': 'Le mot de passe doit contenir au moins 1 majuscule, 1 minuscule, 1 chiffre et 1 caractère spécial.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de mise à jour du profil.
 * Tous les champs sont optionnels (PATCH-like).
 */
const updateProfileSchema = Joi.object({
  first_name: Joi.string().trim().min(2).max(100),
  last_name: Joi.string().trim().min(2).max(100),
  display_name: Joi.string().trim().min(2).max(100),
  phone_number: Joi.string().pattern(PHONE_REGEX_BF).messages({
    'string.pattern.base': 'Numéro de téléphone invalide. Format attendu : +226XXXXXXXX ou XXXXXXXX.',
  }),
  address: Joi.string().trim().max(500),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
  preferred_language: Joi.string().valid('fr', 'mo', 'di'),
  default_waypoints: Joi.array().items(
    Joi.object({
      label: Joi.string().trim().max(100).required(),
      latitude: Joi.number().min(-90).max(90).required(),
      longitude: Joi.number().min(-180).max(180).required(),
    })
  ).max(5),
})
  .min(1) // Au moins un champ à mettre à jour
  .options({ stripUnknown: true })
  .messages({
    'object.min': 'Au moins un champ à mettre à jour est requis.',
  });

/**
 * Schéma de soumission KYC pour les marchands.
 */
const kycMerchantSchema = Joi.object({
  requested_role: Joi.string()
    .valid('merchant')
    .required()
    .messages({
      'any.only': 'Rôle demandé invalide.',
      'any.required': 'Le rôle demandé est requis.',
    }),

  business_registration_number: Joi.string()
    .trim()
    .min(5)
    .max(50)
    .required()
    .messages({
      'any.required': 'Le numéro d\'enregistrement commercial (IFU/RCCM) est requis.',
      'string.min': 'Le numéro d\'enregistrement doit contenir au moins 5 caractères.',
    }),

  id_document_url: Joi.string()
    .uri({ scheme: ['https'] })
    .required()
    .messages({
      'any.required': 'L\'URL du document d\'identité (CNIB) est requise.',
      'string.uri': 'L\'URL du document doit être une URL HTTPS valide.',
    }),

  display_name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      'any.required': 'Le nom commercial est requis.',
    }),

  address: Joi.string()
    .trim()
    .max(500)
    .required()
    .messages({
      'any.required': 'L\'adresse du commerce est requise.',
    }),

  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
}).options({ stripUnknown: true });

/**
 * Schéma de soumission KYC pour les livreurs.
 */
const kycDeliverySchema = Joi.object({
  requested_role: Joi.string()
    .valid('delivery')
    .required()
    .messages({
      'any.only': 'Rôle demandé invalide.',
      'any.required': 'Le rôle demandé est requis.',
    }),

  id_document_url: Joi.string()
    .uri({ scheme: ['https'] })
    .required()
    .messages({
      'any.required': 'L\'URL du document d\'identité (CNIB) est requise.',
      'string.uri': 'L\'URL du document doit être une URL HTTPS valide.',
    }),

  phone_number: Joi.string()
    .pattern(PHONE_REGEX_BF)
    .required()
    .messages({
      'string.pattern.base': 'Numéro de téléphone invalide.',
      'any.required': 'Le numéro de téléphone est requis.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de revue KYC par un admin.
 */
const kycReviewSchema = Joi.object({
  decision: Joi.string()
    .valid('approved', 'rejected')
    .required()
    .messages({
      'any.only': 'Décision invalide. Valeurs acceptées : approved, rejected.',
      'any.required': 'La décision est requise.',
    }),

  rejection_reason: Joi.string()
    .trim()
    .max(500)
    .when('decision', {
      is: 'rejected',
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      'any.required': 'La raison du rejet est requise lorsque la décision est "rejected".',
    }),

  approved_role: Joi.string()
    .valid('merchant', 'delivery')
    .when('decision', {
      is: 'approved',
      then: Joi.required(),
      otherwise: Joi.optional(),
    })
    .messages({
      'any.required': 'Le rôle approuvé est requis lorsque la décision est "approved".',
      'any.only': 'Rôle approuvé invalide. Valeurs acceptées : merchant, delivery.',
    }),
}).options({ stripUnknown: true });

// ============================================================
// MIDDLEWARE FACTORY
// ============================================================

/**
 * Factory de middleware de validation.
 * Valide req.body contre le schéma Joi fourni.
 *
 * @param {Joi.ObjectSchema} schema - Schéma Joi à utiliser pour la validation
 * @returns {import('express').RequestHandler} Middleware Express
 *
 * @example
 * router.post('/register', validate(registerSchema), authController.register);
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Retourner TOUTES les erreurs, pas seulement la première
    });

    if (error) {
      const details = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(422).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Données invalides. Veuillez corriger les erreurs ci-dessous.',
          details,
        },
      });
    }

    // Remplacer req.body par les valeurs validées et nettoyées
    req.body = value;
    next();
  };
}

module.exports = {
  validate,
  schemas: {
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    updateProfileSchema,
    kycMerchantSchema,
    kycDeliverySchema,
    kycReviewSchema,
  },
};
