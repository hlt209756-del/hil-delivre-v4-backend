'use strict';

/**
 * @fileoverview Contrôleur de gestion des menus pour Hil_Delivre v4.
 * Gère le CRUD des articles de menu par les marchands et la consultation
 * publique par les clients.
 *
 * @module controllers/menuController
 */

const { supabaseAdmin } = require('../services/supabaseService');

// ============================================================
// ENDPOINTS PUBLICS
// ============================================================

/**
 * GET /api/merchants
 * Liste des marchands actifs avec KYC approuvé.
 * Endpoint public — pas d'authentification requise.
 *
 * Query params :
 * - page (int, default 1)
 * - limit (int, default 20, max 50)
 * - search (string, optionnel) : recherche par nom
 * - latitude, longitude (float, optionnel) : tri par proximité
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function listMerchants(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 20), 50);
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim();

    let query = supabaseAdmin
      .from('profiles_data')
      .select('user_id, display_name, address, latitude, longitude, score_rating, total_ratings', { count: 'exact' })
      .eq('role', 'merchant')
      .eq('kyc_status', 'approved')
      .eq('is_active', true);

    // Recherche par nom
    if (search) {
      query = query.ilike('display_name', `%${search}%`);
    }

    // Tri par note décroissante par défaut
    query = query.order('score_rating', { ascending: false });

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: merchants, error, count } = await query;

    if (error) {
      console.error('[menuController.listMerchants] Erreur requête:', error.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Erreur lors de la récupération des marchands.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        merchants: merchants || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          total_pages: Math.ceil((count || 0) / limit),
        },
      },
    });
  } catch (error) {
    console.error('[menuController.listMerchants] Erreur inattendue:', error.message);
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
 * GET /api/merchants/:merchantId/menu
 * Menu d'un marchand spécifique.
 * Endpoint public — pas d'authentification requise.
 *
 * Query params :
 * - category (string, optionnel) : filtrer par catégorie
 * - available_only (boolean, default true) : n'afficher que les articles disponibles
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getMerchantMenu(req, res) {
  try {
    const { merchantId } = req.params;
    const category = req.query.category?.trim();
    const availableOnly = req.query.available_only !== 'false';

    // Vérifier que le marchand existe et est actif
    const { data: merchant, error: merchantError } = await supabaseAdmin
      .from('profiles_data')
      .select('user_id, display_name, address, latitude, longitude, score_rating')
      .eq('user_id', merchantId)
      .eq('role', 'merchant')
      .eq('is_active', true)
      .single();

    if (merchantError || !merchant) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'MERCHANT_NOT_FOUND',
          message: 'Marchand introuvable ou inactif.',
        },
      });
    }

    // Récupérer les articles du menu
    let query = supabaseAdmin
      .from('menu_items')
      .select('id, name, description, price, category, image_url, is_available, stock_quantity')
      .eq('merchant_id', merchantId);

    if (availableOnly) {
      query = query.eq('is_available', true);
    }

    if (category) {
      query = query.eq('category', category);
    }

    query = query.order('category', { ascending: true }).order('name', { ascending: true });

    const { data: menuItems, error: menuError } = await query;

    if (menuError) {
      console.error('[menuController.getMerchantMenu] Erreur requête:', menuError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Erreur lors de la récupération du menu.',
        },
      });
    }

    // Grouper par catégorie pour l'affichage
    const categories = {};
    (menuItems || []).forEach((item) => {
      const cat = item.category || 'Autres';
      if (!categories[cat]) {
        categories[cat] = [];
      }
      categories[cat].push(item);
    });

    return res.status(200).json({
      success: true,
      data: {
        merchant,
        menu_items: menuItems || [],
        categories,
        total_items: (menuItems || []).length,
      },
    });
  } catch (error) {
    console.error('[menuController.getMerchantMenu] Erreur inattendue:', error.message);
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
// ENDPOINTS MARCHAND (CRUD)
// ============================================================

/**
 * POST /api/menu/items
 * Créer un nouvel article de menu (marchand uniquement).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function createMenuItem(req, res) {
  try {
    const merchantId = req.user.id;
    const { name, description, price, category, image_url, is_available, stock_quantity } = req.body;

    const { data: item, error } = await supabaseAdmin
      .from('menu_items')
      .insert({
        merchant_id: merchantId,
        name,
        description: description || null,
        price,
        category: category || 'general',
        image_url: image_url || null,
        is_available: is_available !== undefined ? is_available : true,
        stock_quantity: stock_quantity !== undefined ? stock_quantity : null,
      })
      .select('*')
      .single();

    if (error) {
      console.error('[menuController.createMenuItem] Erreur insertion:', error.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'CREATE_FAILED',
          message: 'Erreur lors de la création de l\'article.',
        },
      });
    }

    console.info(`[AUDIT] Menu item créé: merchant_id=${merchantId}, item_id=${item.id}, name="${name}"`);

    return res.status(201).json({
      success: true,
      message: 'Article créé avec succès.',
      data: { item },
    });
  } catch (error) {
    console.error('[menuController.createMenuItem] Erreur inattendue:', error.message);
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
 * PUT /api/menu/items/:itemId
 * Mettre à jour un article de menu (marchand propriétaire uniquement).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function updateMenuItem(req, res) {
  try {
    const merchantId = req.user.id;
    const { itemId } = req.params;
    const updateData = req.body;

    // Vérifier que l'article appartient au marchand
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('menu_items')
      .select('id, merchant_id')
      .eq('id', itemId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ITEM_NOT_FOUND',
          message: 'Article introuvable.',
        },
      });
    }

    if (existing.merchant_id !== merchantId && req.profile.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Vous ne pouvez modifier que vos propres articles.',
        },
      });
    }

    // Supprimer les champs protégés
    delete updateData.id;
    delete updateData.merchant_id;
    delete updateData.created_at;
    delete updateData.updated_at;

    const { data: updatedItem, error: updateError } = await supabaseAdmin
      .from('menu_items')
      .update(updateData)
      .eq('id', itemId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[menuController.updateMenuItem] Erreur mise à jour:', updateError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'UPDATE_FAILED',
          message: 'Erreur lors de la mise à jour de l\'article.',
        },
      });
    }

    console.info(`[AUDIT] Menu item mis à jour: merchant_id=${merchantId}, item_id=${itemId}`);

    return res.status(200).json({
      success: true,
      message: 'Article mis à jour avec succès.',
      data: { item: updatedItem },
    });
  } catch (error) {
    console.error('[menuController.updateMenuItem] Erreur inattendue:', error.message);
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
 * DELETE /api/menu/items/:itemId
 * Supprimer un article de menu (marchand propriétaire uniquement).
 * Soft-delete : marque l'article comme indisponible plutôt que de le supprimer.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function deleteMenuItem(req, res) {
  try {
    const merchantId = req.user.id;
    const { itemId } = req.params;

    // Vérifier que l'article appartient au marchand
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('menu_items')
      .select('id, merchant_id')
      .eq('id', itemId)
      .single();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ITEM_NOT_FOUND',
          message: 'Article introuvable.',
        },
      });
    }

    if (existing.merchant_id !== merchantId && req.profile.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Vous ne pouvez supprimer que vos propres articles.',
        },
      });
    }

    // Soft-delete : marquer comme indisponible
    const { error: deleteError } = await supabaseAdmin
      .from('menu_items')
      .update({ is_available: false })
      .eq('id', itemId);

    if (deleteError) {
      console.error('[menuController.deleteMenuItem] Erreur suppression:', deleteError.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'DELETE_FAILED',
          message: 'Erreur lors de la suppression de l\'article.',
        },
      });
    }

    console.info(`[AUDIT] Menu item supprimé (soft): merchant_id=${merchantId}, item_id=${itemId}`);

    return res.status(200).json({
      success: true,
      message: 'Article supprimé avec succès.',
    });
  } catch (error) {
    console.error('[menuController.deleteMenuItem] Erreur inattendue:', error.message);
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
 * GET /api/menu/my-items
 * Liste des articles du marchand authentifié (incluant les indisponibles).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function getMyMenuItems(req, res) {
  try {
    const merchantId = req.user.id;

    const { data: items, error } = await supabaseAdmin
      .from('menu_items')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[menuController.getMyMenuItems] Erreur requête:', error.message);
      return res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_FAILED',
          message: 'Erreur lors de la récupération de vos articles.',
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        items: items || [],
        total: (items || []).length,
      },
    });
  } catch (error) {
    console.error('[menuController.getMyMenuItems] Erreur inattendue:', error.message);
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
  listMerchants,
  getMerchantMenu,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getMyMenuItems,
};
