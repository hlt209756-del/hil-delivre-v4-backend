'use strict';

/**
 * @fileoverview Schémas de validation Joi pour le Sprint 3 (Menu, Commandes).
 *
 * @module middlewares/validationSprint3
 */

const Joi = require('joi');

// ============================================================
// SCHÉMAS MENU
// ============================================================

/**
 * Schéma de création d'un article de menu.
 */
const createMenuItemSchema = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(200)
    .required()
    .messages({
      'any.required': 'Le nom de l\'article est requis.',
      'string.min': 'Le nom doit contenir au moins 2 caractères.',
      'string.max': 'Le nom ne doit pas dépasser 200 caractères.',
    }),

  description: Joi.string()
    .trim()
    .max(1000)
    .allow(null, '')
    .messages({
      'string.max': 'La description ne doit pas dépasser 1000 caractères.',
    }),

  price: Joi.number()
    .positive()
    .precision(2)
    .max(1000000) // Max 1M FCFA
    .required()
    .messages({
      'any.required': 'Le prix est requis.',
      'number.positive': 'Le prix doit être positif.',
      'number.max': 'Le prix ne doit pas dépasser 1 000 000 FCFA.',
    }),

  category: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .default('general')
    .messages({
      'string.min': 'La catégorie doit contenir au moins 2 caractères.',
      'string.max': 'La catégorie ne doit pas dépasser 100 caractères.',
    }),

  image_url: Joi.string()
    .uri({ scheme: ['https'] })
    .allow(null, '')
    .messages({
      'string.uri': 'L\'URL de l\'image doit être une URL HTTPS valide.',
    }),

  is_available: Joi.boolean().default(true),

  stock_quantity: Joi.number()
    .integer()
    .min(0)
    .max(99999)
    .allow(null)
    .messages({
      'number.min': 'La quantité en stock ne peut pas être négative.',
      'number.max': 'La quantité en stock ne doit pas dépasser 99 999.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de mise à jour d'un article de menu.
 * Tous les champs sont optionnels.
 */
const updateMenuItemSchema = Joi.object({
  name: Joi.string().trim().min(2).max(200),
  description: Joi.string().trim().max(1000).allow(null, ''),
  price: Joi.number().positive().precision(2).max(1000000),
  category: Joi.string().trim().min(2).max(100),
  image_url: Joi.string().uri({ scheme: ['https'] }).allow(null, ''),
  is_available: Joi.boolean(),
  stock_quantity: Joi.number().integer().min(0).max(99999).allow(null),
})
  .min(1)
  .options({ stripUnknown: true })
  .messages({
    'object.min': 'Au moins un champ à mettre à jour est requis.',
  });

// ============================================================
// SCHÉMAS COMMANDES
// ============================================================

/**
 * Schéma de création de commande.
 */
const createOrderSchema = Joi.object({
  merchant_id: Joi.string()
    .uuid()
    .required()
    .messages({
      'any.required': 'L\'identifiant du marchand est requis.',
      'string.guid': 'Identifiant du marchand invalide.',
    }),

  items: Joi.array()
    .items(
      Joi.object({
        menu_item_id: Joi.string().uuid().required().messages({
          'any.required': 'L\'identifiant de l\'article est requis.',
          'string.guid': 'Identifiant d\'article invalide.',
        }),
        quantity: Joi.number().integer().min(1).max(99).required().messages({
          'any.required': 'La quantité est requise.',
          'number.min': 'La quantité minimum est 1.',
          'number.max': 'La quantité maximum est 99 par article.',
        }),
      })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      'any.required': 'Les articles de la commande sont requis.',
      'array.min': 'Au moins un article est requis.',
      'array.max': 'Maximum 50 articles par commande.',
    }),

  delivery_address: Joi.string()
    .trim()
    .max(500)
    .allow(null, '')
    .messages({
      'string.max': 'L\'adresse de livraison ne doit pas dépasser 500 caractères.',
    }),

  delivery_latitude: Joi.number().min(-90).max(90).allow(null),
  delivery_longitude: Joi.number().min(-180).max(180).allow(null),

  client_note: Joi.string()
    .trim()
    .max(500)
    .allow(null, '')
    .messages({
      'string.max': 'La note ne doit pas dépasser 500 caractères.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma de mise à jour du statut d'une commande.
 */
const updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid(
      'pending', 'accepted', 'preparing', 'ready_for_pickup',
      'on_the_way', 'delivered', 'cancelled', 'refunded'
    )
    .required()
    .messages({
      'any.required': 'Le nouveau statut est requis.',
      'any.only': 'Statut invalide.',
    }),

  cancellation_reason: Joi.string()
    .trim()
    .max(500)
    .when('status', {
      is: 'cancelled',
      then: Joi.required(),
      otherwise: Joi.optional().allow(null, ''),
    })
    .messages({
      'any.required': 'La raison de l\'annulation est requise.',
    }),
}).options({ stripUnknown: true });

/**
 * Schéma d'annulation de commande par le client.
 */
const cancelOrderSchema = Joi.object({
  reason: Joi.string()
    .trim()
    .max(500)
    .allow(null, '')
    .messages({
      'string.max': 'La raison ne doit pas dépasser 500 caractères.',
    }),
}).options({ stripUnknown: true });

module.exports = {
  createMenuItemSchema,
  updateMenuItemSchema,
  createOrderSchema,
  updateOrderStatusSchema,
  cancelOrderSchema,
};
