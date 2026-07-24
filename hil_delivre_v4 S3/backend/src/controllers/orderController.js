'use strict';

/**
 * @fileoverview Contrôleur de gestion des commandes pour Hil_Delivre v4.
 * Gère la création de commandes, la gestion du panier côté serveur,
 * les transitions de statut et la consultation.
 *
 * Flux de commande :
 * 1. Client ajoute des articles au panier (côté mobile, validé à la création)
 * 2. Client crée la commande (POST /api/orders) avec les items du panier
 * 3. Marchand accepte/refuse (PUT /api/orders/:id/status)
 * 4. Marchand prépare → prêt pour collecte
 * 5. Livreur collecte → en route → livré
 *
 * @module controllers/orderController
 */

const { supabaseAdmin } = require('../services/supabaseService');

// ============================================================
// CONSTANTES
// ============================================================

/**
 * Transitions de statut autorisées par rôle.
 * Clé = statut actuel, Valeur = { rôle: [statuts suivants possibles] }
 */
const STATUS_TRANSITIONS = {
  pending: {
    merchant: ['accepted', 'cancelled'],
    admin: ['accepted', 'cancelled'],
  },
  accepted: {
    merchant: ['preparing', 'cancelled'],
    admin: ['preparing', 'cancelled'],
  },
  preparing: {
    merchant: ['ready_for_pickup'],
    admin: ['ready_for_pickup', 'cancelled'],
  },
  ready_for_pickup: {
    delivery: ['on_the_way'],
    admin: ['on_the_way', 'cancelled'],
  },
  on_the_way: {
    delivery: ['delivered'],
    admin: ['delivered', 'cancelled'],
  },
  delivered: {
    admin: ['refunded'],
  },
  cancelled: {
    admin: ['refunded'],
  },
};

// ============================================================
// ENDPOINTS CLIENT
// ============================================================

/**
 * POST /api/orders
 * Créer une nouvelle commande.
 *
 * Le panier est géré côté mobile. Le client envoie la liste complète
 * des articles avec quantités. Le serveur valide la disponibilité,
 * calcule les montants et crée la commande.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function createOrder(req, res) {
  try {
    const clientId = req.user.id;
    const {
      merchant_id,
      items,
      delivery_address,
      delivery_latitude,
      delivery_longitude,
      client_note,
    } = req.body;

    // 1. Vérifier que le marchand existe et est actif
    const { data: merchant, error: merchantError } = await supabaseAdmin
      .from('profiles_data')
      .select('user_id, display_name, address, latitude, longitude, is_active, kyc_status')
      .eq('user_id', merchant_id)
      .eq('role', 'merchant')
      .single();

    if (merchantError || !merchant) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'MERCHANT_NOT_FOUND',
          message: 'Marchand introuvable.',
        },
      });
    }

    if (!merchant.is_active || merchant.kyc_status !== 'approved') {
      return res.status(422).json({
        success: false,
        error: {
          code: 'MERCHANT_UNAVAILABLE',
          message: 'Ce marchand n\'est pas disponible actuellement.',
        },
      });
    }

    // 2. Valider les articles et vérifier la disponibilité
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'EMPTY_CART',
          message: 'Le panier est vide. Ajoutez au moins un article.',
        },
      });
    }

    // Limiter le nombre d'articles par commande
    if (items.length > 50) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'TOO_MANY_ITEMS',
          message: 'Maximum 50 articles par commande.',
        },
      });
    }

    const menuItemIds = items.map((item) => item.menu_item_id);

    // Récupérer les articles depuis la BDD
    const { data: menuItems, error: menuError } = await supabaseAdmin
      .from('menu_items')
      .select('id, merchant_id, name, price, is_available, stock_quantity')
      .in('id', menuItemIds)
      .eq('merchant_id', merchant_id);

    if (menuError) {
      console.error('[orderController.createOrder] Erreur récupération menu:', menuError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Erreur lors de la vérification des articles.',
        },
      });
    }

    // Vérifier que tous les articles existent et appartiennent au marchand
    const menuItemsMap = new Map(menuItems.map((mi) => [mi.id, mi]));
    const unavailableItems = [];
    const outOfStockItems = [];
    let foodAmount = 0;
    const orderItems = [];

    for (const cartItem of items) {
      const menuItem = menuItemsMap.get(cartItem.menu_item_id);

      if (!menuItem) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: `Article "${cartItem.menu_item_id}" introuvable dans le menu de ce marchand.`,
          },
        });
      }

      if (!menuItem.is_available) {
        unavailableItems.push(menuItem.name);
        continue;
      }

      // Vérifier le stock si géré
      if (menuItem.stock_quantity !== null && menuItem.stock_quantity < cartItem.quantity) {
        outOfStockItems.push({
          name: menuItem.name,
          available: menuItem.stock_quantity,
          requested: cartItem.quantity,
        });
        continue;
      }

      const itemTotal = menuItem.price * cartItem.quantity;
      foodAmount += itemTotal;

      orderItems.push({
        menu_item_id: menuItem.id,
        quantity: cartItem.quantity,
        unit_price: menuItem.price,
        total_price: itemTotal,
        item_name_snapshot: menuItem.name,
      });
    }

    // Retourner les erreurs de disponibilité
    if (unavailableItems.length > 0) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'ITEMS_UNAVAILABLE',
          message: `Articles indisponibles : ${unavailableItems.join(', ')}`,
          details: { unavailable_items: unavailableItems },
        },
      });
    }

    if (outOfStockItems.length > 0) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'ITEMS_OUT_OF_STOCK',
          message: 'Certains articles n\'ont pas assez de stock.',
          details: { out_of_stock_items: outOfStockItems },
        },
      });
    }

    if (orderItems.length === 0) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'NO_VALID_ITEMS',
          message: 'Aucun article valide dans la commande.',
        },
      });
    }

    // 3. Charger les paramètres de la plateforme pour les calculs
    const { data: platformConfig } = await supabaseAdmin
      .from('platform_config')
      .select('config_key, config_value');

    const config = {};
    (platformConfig || []).forEach((c) => {
      config[c.config_key] = parseFloat(c.config_value);
    });

    const merchantCommissionRate = config.merchant_commission_rate || 0.05; // 5%
    const platformVatRate = config.platform_vat_rate || 0.18; // 18%

    // 4. Calculer les montants
    const commissionAmount = Math.round(foodAmount * merchantCommissionRate);
    // Note : delivery_fee et surge seront calculés au Sprint 5 (dispatch)
    const deliveryFee = 0;
    const surgeAmount = 0;
    const deliveryCommission = 0;

    // TVA sur les services de la plateforme uniquement (commission + frais livraison)
    const platformVatAmount = Math.round((commissionAmount + deliveryFee) * platformVatRate);

    // Service fees = commission + TVA plateforme
    const serviceFees = commissionAmount + platformVatAmount;

    // Total = nourriture + frais de service + livraison + surge
    const totalAmount = foodAmount + serviceFees + deliveryFee + surgeAmount;

    // 5. Créer la commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        client_id: clientId,
        merchant_id: merchant_id,
        status: 'pending',
        food_amount: foodAmount,
        commission_amount: commissionAmount,
        delivery_fee: deliveryFee,
        surge_amount: surgeAmount,
        platform_vat_amount: platformVatAmount,
        service_fees: serviceFees,
        delivery_commission_amount: deliveryCommission,
        total_amount: totalAmount,
        delivery_address: delivery_address || null,
        delivery_latitude: delivery_latitude || null,
        delivery_longitude: delivery_longitude || null,
        pickup_address: merchant.address,
        pickup_latitude: merchant.latitude,
        pickup_longitude: merchant.longitude,
        client_note: client_note || null,
      })
      .select('*')
      .single();

    if (orderError) {
      console.error('[orderController.createOrder] Erreur création commande:', orderError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'ORDER_CREATE_FAILED',
          message: 'Erreur lors de la création de la commande.',
        },
      });
    }

    // 6. Insérer les articles de la commande
    const orderItemsToInsert = orderItems.map((item) => ({
      ...item,
      order_id: order.id,
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItemsToInsert);

    if (itemsError) {
      console.error('[orderController.createOrder] Erreur insertion items:', itemsError.message);
      // Annuler la commande si les items échouent
      await supabaseAdmin
        .from('orders')
        .update({ status: 'cancelled', cancellation_reason: 'Erreur technique lors de la création' })
        .eq('id', order.id);

      return res.status(500).json({
        success: false,
        error: {
          code: 'ORDER_ITEMS_FAILED',
          message: 'Erreur lors de l\'ajout des articles. La commande a été annulée.',
        },
      });
    }

    // 7. Décrémenter les stocks
    for (const cartItem of items) {
      const menuItem = menuItemsMap.get(cartItem.menu_item_id);
      if (menuItem && menuItem.stock_quantity !== null) {
        await supabaseAdmin.rpc('decrement_stock', {
          p_item_id: menuItem.id,
          p_quantity: cartItem.quantity,
        }).catch(() => {
          // Fallback : mise à jour directe si la RPC n'existe pas encore
          supabaseAdmin
            .from('menu_items')
            .update({ stock_quantity: menuItem.stock_quantity - cartItem.quantity })
            .eq('id', menuItem.id);
        });
      }
    }

    console.info(`[AUDIT] Commande créée: order_id=${order.id}, client_id=${clientId}, merchant_id=${merchant_id}, total=${totalAmount} FCFA`);

    return res.status(201).json({
      success: true,
      message: 'Commande créée avec succès.',
      data: {
        order: {
          id: order.id,
          status: order.status,
          food_amount: order.food_amount,
          commission_amount: order.commission_amount,
          delivery_fee: order.delivery_fee,
          service_fees: order.service_fees,
          total_amount: order.total_amount,
          merchant_name: merchant.display_name,
          created_at: order.created_at,
        },
        items: orderItems,
      },
    });
  } catch (error) {
    console.error('[orderController.createOrder] Erreur inattendue:', error.message);
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
 * GET /api/orders
 * Liste des commandes de l'utilisateur authentifié.
 * Filtre automatiquement selon le rôle (client, marchand, livreur).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listOrders(req, res) {
  try {
    const userId = req.user.id;
    const role = req.profile.role;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 50);
    const offset = (page - 1) * limit;
    const status = req.query.status;

    let query = supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact' });

    // Filtrer selon le rôle
    if (role === 'client') {
      query = query.eq('client_id', userId);
    } else if (role === 'merchant') {
      query = query.eq('merchant_id', userId);
    } else if (role === 'delivery') {
      query = query.eq('delivery_id', userId);
    }
    // Admin voit tout (pas de filtre)

    // Filtre par statut optionnel
    if (status) {
      query = query.eq('status', status);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: orders, error, count } = await query;

    if (error) {
      console.error('[orderController.listOrders] Erreur requête:', error.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Erreur lors de la récupération des commandes.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        orders: orders || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          total_pages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error('[orderController.listOrders] Erreur inattendue:', error.message);
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
 * GET /api/orders/:orderId
 * Détails d'une commande spécifique avec ses articles.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getOrderDetails(req, res) {
  try {
    const userId = req.user.id;
    const role = req.profile.role;
    const { orderId } = req.params;

    // Récupérer la commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Commande introuvable.',
        },
      });
    }

    // Vérifier l'accès (seules les parties concernées peuvent voir la commande)
    if (role !== 'admin') {
      const isParty = [order.client_id, order.merchant_id, order.delivery_id].includes(userId);
      if (!isParty) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Vous n\'avez pas accès à cette commande.',
          },
        });
      }
    }

    // Récupérer les articles
    const { data: orderItems, error: itemsError } = await supabaseAdmin
      .from('order_items')
      .select('id, menu_item_id, quantity, unit_price, total_price, item_name_snapshot')
      .eq('order_id', orderId);

    if (itemsError) {
      console.error('[orderController.getOrderDetails] Erreur items:', itemsError.message);
    }

    return res.status(200).json({
      success: true,
      data: {
        order,
        items: orderItems || [],
      },
    });
  } catch (error) {
    console.error('[orderController.getOrderDetails] Erreur inattendue:', error.message);
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
 * PUT /api/orders/:orderId/status
 * Mettre à jour le statut d'une commande.
 * Les transitions autorisées dépendent du rôle et du statut actuel.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateOrderStatus(req, res) {
  try {
    const userId = req.user.id;
    const role = req.profile.role;
    const { orderId } = req.params;
    const { status: newStatus, cancellation_reason } = req.body;

    // 1. Récupérer la commande actuelle
    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Commande introuvable.',
        },
      });
    }

    // 2. Vérifier que l'utilisateur est une partie de la commande
    if (role !== 'admin') {
      const roleToField = {
        client: 'client_id',
        merchant: 'merchant_id',
        delivery: 'delivery_id',
      };
      const userField = roleToField[role];
      if (!userField || order[userField] !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Vous n\'avez pas accès à cette commande.',
          },
        });
      }
    }

    // 3. Vérifier la transition de statut
    const currentStatus = order.status;
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus]?.[role];

    if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          message: `Transition de "${currentStatus}" vers "${newStatus}" non autorisée pour le rôle "${role}".`,
          details: {
            current_status: currentStatus,
            requested_status: newStatus,
            allowed_transitions: allowedTransitions || [],
          },
        },
      });
    }

    // 4. Préparer les données de mise à jour
    const updateData = { status: newStatus };

    if (newStatus === 'cancelled') {
      updateData.cancellation_reason = cancellation_reason || `Annulé par ${role}`;
    }

    if (newStatus === 'delivered') {
      updateData.actual_delivery_time = new Date().toISOString();
    }

    // 5. Mettre à jour
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[orderController.updateOrderStatus] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'Erreur lors de la mise à jour du statut.',
        },
      });
    }

    // 6. Si annulation, restaurer les stocks
    if (newStatus === 'cancelled') {
      await restoreStocks(orderId);
    }

    console.info(`[AUDIT] Statut commande mis à jour: order_id=${orderId}, ${currentStatus} → ${newStatus}, by=${userId} (${role})`);

    return res.status(200).json({
      success: true,
      message: `Commande mise à jour : ${newStatus}.`,
      data: { order: updatedOrder },
    });
  } catch (error) {
    console.error('[orderController.updateOrderStatus] Erreur inattendue:', error.message);
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
 * POST /api/orders/:orderId/cancel
 * Annuler une commande (client uniquement, si statut = pending).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function cancelOrder(req, res) {
  try {
    const clientId = req.user.id;
    const { orderId } = req.params;
    const { reason } = req.body;

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('id, client_id, status')
      .eq('id', orderId)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Commande introuvable.',
        },
      });
    }

    if (order.client_id !== clientId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Vous ne pouvez annuler que vos propres commandes.',
        },
      });
    }

    // Le client ne peut annuler que si la commande est en pending ou accepted
    if (!['pending', 'accepted'].includes(order.status)) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'CANCELLATION_NOT_ALLOWED',
          message: `Impossible d'annuler une commande en statut "${order.status}". Contactez le support.`,
        },
      });
    }

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        status: 'cancelled',
        cancellation_reason: reason || 'Annulé par le client',
      })
      .eq('id', orderId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[orderController.cancelOrder] Erreur annulation:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'CANCELLATION_FAILED',
          message: 'Erreur lors de l\'annulation.',
        },
      });
    }

    // Restaurer les stocks
    await restoreStocks(orderId);

    console.info(`[AUDIT] Commande annulée par client: order_id=${orderId}, client_id=${clientId}`);

    return res.status(200).json({
      success: true,
      message: 'Commande annulée avec succès.',
      data: { order: updatedOrder },
    });
  } catch (error) {
    console.error('[orderController.cancelOrder] Erreur inattendue:', error.message);
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
 * Restaure les stocks des articles d'une commande annulée.
 *
 * @param {string} orderId - ID de la commande
 */
async function restoreStocks(orderId) {
  try {
    const { data: orderItems } = await supabaseAdmin
      .from('order_items')
      .select('menu_item_id, quantity')
      .eq('order_id', orderId);

    if (!orderItems || orderItems.length === 0) return;

    for (const item of orderItems) {
      const { data: menuItem } = await supabaseAdmin
        .from('menu_items')
        .select('id, stock_quantity')
        .eq('id', item.menu_item_id)
        .single();

      if (menuItem && menuItem.stock_quantity !== null) {
        await supabaseAdmin
          .from('menu_items')
          .update({ stock_quantity: menuItem.stock_quantity + item.quantity })
          .eq('id', item.menu_item_id);
      }
    }
  } catch (error) {
    console.error('[orderController.restoreStocks] Erreur restauration stocks:', error.message);
  }
}

module.exports = {
  createOrder,
  listOrders,
  getOrderDetails,
  updateOrderStatus,
  cancelOrder,
};
