'use strict';

/**
 * @fileoverview Schémas de validation Joi pour le Sprint 9.
 * Valide toutes les entrées des endpoints de notation, fidélisation et certification.
 * @module middlewares/validationSprint9
 */

const Joi = require('joi');

/** Options Joi globales : supprime les champs inconnus */
const JOI_OPTIONS = {
    abortEarly: false,
    stripUnknown: true,
    errors: { wrap: { label: '' } }
};

/**
 * Middleware factory : valide req.body, req.params ou req.query selon le schéma.
 *
 * @param {Joi.Schema} schema - Schéma Joi
 * @param {string} [source='body'] - Source de données ('body', 'params', 'query')
 * @returns {Function} Middleware Express
 */
function validate(schema, source = 'body') {
    return (req, res, next) => {
        const { error, value } = schema.validate(req[source], JOI_OPTIONS);

        if (error) {
            const details = error.details.map(d => ({
                field: d.path.join('.'),
                message: d.message
            }));

            return res.status(400).json({
                success: false,
                message: 'Erreur de validation',
                error: 'VALIDATION_ERROR',
                details
            });
        }

        req[source] = value;
        next();
    };
}

// ============================================================================
// SCHEMAS : NOTATION
// ============================================================================

/** Validation params pour orderId */
const ratingParamsSchema = Joi.object({
    orderId: Joi.string().uuid().required().messages({
        'string.guid': 'orderId doit être un UUID valide',
        'any.required': 'orderId est requis'
    })
});

/** Validation body pour créer une notation */
const createRatingSchema = Joi.object({
    rated_user_id: Joi.string().uuid().required().messages({
        'string.guid': 'rated_user_id doit être un UUID valide',
        'any.required': 'rated_user_id est requis'
    }),
    score: Joi.number().integer().min(1).max(5).required().messages({
        'number.min': 'Le score doit être au minimum 1',
        'number.max': 'Le score doit être au maximum 5',
        'number.integer': 'Le score doit être un entier',
        'any.required': 'Le score est requis'
    }),
    comment: Joi.string().max(500).allow(null, '').optional().messages({
        'string.max': 'Le commentaire ne doit pas dépasser 500 caractères'
    })
});

/** Validation query pour récupérer les notations d'un utilisateur */
const getUserRatingsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    min_score: Joi.number().integer().min(1).max(5).optional(),
    max_score: Joi.number().integer().min(1).max(5).optional(),
    sort_by: Joi.string().valid('created_at', 'score').default('created_at'),
    sort_order: Joi.string().valid('asc', 'desc').default('desc')
});

/** Validation params pour userId */
const userIdParamsSchema = Joi.object({
    userId: Joi.string().uuid().required().messages({
        'string.guid': 'userId doit être un UUID valide',
        'any.required': 'userId est requis'
    })
});

/** Validation query pour vérifier si on peut noter */
const canRateQuerySchema = Joi.object({
    rated_user_id: Joi.string().uuid().required().messages({
        'string.guid': 'rated_user_id doit être un UUID valide',
        'any.required': 'rated_user_id est requis'
    })
});

/** Validation body pour modérer une notation (admin) */
const moderateRatingSchema = Joi.object({
    reason: Joi.string().min(5).max(500).required().messages({
        'string.min': 'La raison doit contenir au moins 5 caractères',
        'string.max': 'La raison ne doit pas dépasser 500 caractères',
        'any.required': 'La raison de modération est requise'
    })
});

/** Validation params pour ratingId */
const ratingIdParamsSchema = Joi.object({
    ratingId: Joi.string().uuid().required().messages({
        'string.guid': 'ratingId doit être un UUID valide',
        'any.required': 'ratingId est requis'
    })
});

/** Validation query pour admin ratings */
const adminRatingsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    include_hidden: Joi.string().valid('true', 'false').default('false'),
    min_score: Joi.number().integer().min(1).max(5).optional(),
    max_score: Joi.number().integer().min(1).max(5).optional(),
    user_id: Joi.string().uuid().optional()
});

// ============================================================================
// SCHEMAS : FIDÉLISATION
// ============================================================================

/** Validation body pour convertir des points */
const redeemPointsSchema = Joi.object({
    points: Joi.number().integer().min(100).required().messages({
        'number.min': 'Minimum 100 points requis pour la conversion',
        'number.integer': 'Le nombre de points doit être un entier',
        'any.required': 'Le nombre de points est requis'
    })
});

/** Validation query pour l'historique des points */
const loyaltyHistoryQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    type: Joi.string().valid('earned', 'redeemed', 'expired').optional()
});

// ============================================================================
// SCHEMAS : CERTIFICATION
// ============================================================================

/** Validation params pour certificationId */
const certificationIdParamsSchema = Joi.object({
    certificationId: Joi.string().uuid().required().messages({
        'string.guid': 'certificationId doit être un UUID valide',
        'any.required': 'certificationId est requis'
    })
});

/** Validation body pour approuver une certification (admin) */
const approveCertificationSchema = Joi.object({
    notes: Joi.string().max(1000).allow(null, '').optional().messages({
        'string.max': 'Les notes ne doivent pas dépasser 1000 caractères'
    })
});

/** Validation body pour révoquer une certification (admin) */
const revokeCertificationSchema = Joi.object({
    reason: Joi.string().min(5).max(500).required().messages({
        'string.min': 'La raison doit contenir au moins 5 caractères',
        'string.max': 'La raison ne doit pas dépasser 500 caractères',
        'any.required': 'La raison de révocation est requise'
    })
});

/** Validation query pour lister les certifications (admin) */
const adminCertificationsQuerySchema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid('pending', 'certified', 'expired', 'revoked').optional(),
    merchant_id: Joi.string().uuid().optional(),
    expiring_soon: Joi.string().valid('true', 'false').default('false')
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    validate,

    // Notation
    validateRatingParams: validate(ratingParamsSchema, 'params'),
    validateCreateRating: validate(createRatingSchema, 'body'),
    validateGetUserRatingsQuery: validate(getUserRatingsQuerySchema, 'query'),
    validateUserIdParams: validate(userIdParamsSchema, 'params'),
    validateCanRateQuery: validate(canRateQuerySchema, 'query'),
    validateModerateRating: validate(moderateRatingSchema, 'body'),
    validateRatingIdParams: validate(ratingIdParamsSchema, 'params'),
    validateAdminRatingsQuery: validate(adminRatingsQuerySchema, 'query'),

    // Fidélisation
    validateRedeemPoints: validate(redeemPointsSchema, 'body'),
    validateLoyaltyHistoryQuery: validate(loyaltyHistoryQuerySchema, 'query'),

    // Certification
    validateCertificationIdParams: validate(certificationIdParamsSchema, 'params'),
    validateApproveCertification: validate(approveCertificationSchema, 'body'),
    validateRevokeCertification: validate(revokeCertificationSchema, 'body'),
    validateAdminCertificationsQuery: validate(adminCertificationsQuerySchema, 'query')
};
