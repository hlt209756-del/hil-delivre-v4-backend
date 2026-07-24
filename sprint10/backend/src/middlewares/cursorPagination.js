'use strict';

/**
 * @fileoverview Middleware de pagination par curseur pour le Sprint 10 de Hil_Delivre v4.
 * Remplace la pagination par offset (OFFSET/LIMIT) par une pagination par curseur
 * pour des performances optimales sur les grandes tables.
 * @module middlewares/cursorPagination
 */

const Joi = require('joi');

/**
 * Schéma de validation des paramètres de pagination par curseur.
 */
const paginationSchema = Joi.object({
  cursor: Joi.string().optional().allow(null, ''),
  limit: Joi.number().integer().min(1).max(100).default(20),
  direction: Joi.string().valid('next', 'prev').default('next'),
  sort_by: Joi.string().max(50).default('created_at'),
  sort_order: Joi.string().valid('asc', 'desc').default('desc'),
});

/**
 * Décode un curseur encodé en Base64.
 * Le curseur contient les valeurs de tri et l'ID pour une pagination déterministe.
 * @param {string} cursor - Le curseur encodé.
 * @returns {Object|null} L'objet curseur décodé ou null si invalide.
 */
const decodeCursor = (cursor) => {
  if (!cursor) return null;

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const parsed = JSON.parse(decoded);

    // Validation basique de la structure du curseur
    if (!parsed || typeof parsed !== 'object' || !parsed.id) {
      console.warn('[CursorPagination] Curseur invalide: structure incorrecte.');
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn('[CursorPagination] Erreur décodage curseur:', error.message);
    return null;
  }
};

/**
 * Encode un objet curseur en Base64 URL-safe.
 * @param {Object} data - Les données du curseur (sort_value + id).
 * @returns {string} Le curseur encodé.
 */
const encodeCursor = (data) => {
  try {
    const json = JSON.stringify(data);
    return Buffer.from(json, 'utf-8').toString('base64url');
  } catch (error) {
    console.error('[CursorPagination] Erreur encodage curseur:', error.message);
    return '';
  }
};

/**
 * Construit les conditions WHERE pour la pagination par curseur.
 * Utilise la méthode "keyset pagination" pour des performances O(log n).
 *
 * @param {Object} options - Options de construction.
 * @param {Object|null} options.cursor - Le curseur décodé.
 * @param {string} options.sortBy - La colonne de tri.
 * @param {string} options.sortOrder - L'ordre de tri ('asc' ou 'desc').
 * @param {string} options.direction - La direction de navigation ('next' ou 'prev').
 * @param {string} options.tableAlias - L'alias de la table (optionnel).
 * @returns {Object} { whereClause: string, params: Array }
 */
const buildCursorCondition = ({ cursor, sortBy, sortOrder, direction, tableAlias = '' }) => {
  if (!cursor) {
    return { whereClause: '', params: [] };
  }

  const prefix = tableAlias ? `${tableAlias}.` : '';
  const sortValue = cursor.sort_value;
  const id = cursor.id;

  // Déterminer l'opérateur de comparaison
  let operator;
  if (direction === 'next') {
    operator = sortOrder === 'desc' ? '<' : '>';
  } else {
    operator = sortOrder === 'desc' ? '>' : '<';
  }

  // Condition composite pour une pagination déterministe
  // (sort_column, id) > (cursor_sort_value, cursor_id)
  const whereClause = `(${prefix}${sortBy}, ${prefix}id) ${operator} ($CURSOR_SORT, $CURSOR_ID)`;

  return {
    whereClause,
    params: [sortValue, id],
    paramNames: { sort: '$CURSOR_SORT', id: '$CURSOR_ID' },
  };
};

/**
 * Construit la réponse paginée avec les curseurs next/prev.
 *
 * @param {Array} rows - Les lignes de résultats.
 * @param {Object} options - Options de construction.
 * @param {number} options.limit - La limite demandée.
 * @param {string} options.sortBy - La colonne de tri.
 * @param {string} options.sortOrder - L'ordre de tri.
 * @param {boolean} options.hasMore - S'il y a plus de résultats.
 * @returns {Object} { data, pagination }
 */
const buildPaginatedResponse = (rows, { limit, sortBy, sortOrder, hasMore }) => {
  if (!rows || rows.length === 0) {
    return {
      data: [],
      pagination: {
        next_cursor: null,
        prev_cursor: null,
        has_more: false,
        limit,
      },
    };
  }

  const firstRow = rows[0];
  const lastRow = rows[rows.length - 1];

  const nextCursor = hasMore
    ? encodeCursor({ sort_value: lastRow[sortBy], id: lastRow.id })
    : null;

  const prevCursor = encodeCursor({ sort_value: firstRow[sortBy], id: firstRow.id });

  return {
    data: rows,
    pagination: {
      next_cursor: nextCursor,
      prev_cursor: prevCursor,
      has_more: hasMore,
      count: rows.length,
      limit,
    },
  };
};

/**
 * Middleware Express de pagination par curseur.
 * Parse les paramètres de query et les attache à req.pagination.
 *
 * @param {Object} [options={}] - Options de configuration.
 * @param {number} [options.defaultLimit=20] - Limite par défaut.
 * @param {number} [options.maxLimit=100] - Limite maximale.
 * @param {string} [options.defaultSort='created_at'] - Colonne de tri par défaut.
 * @param {string[]} [options.allowedSorts] - Colonnes de tri autorisées.
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.get('/items', cursorPagination({ defaultLimit: 25, allowedSorts: ['created_at', 'name'] }), controller.list);
 */
const cursorPagination = (options = {}) => {
  const {
    defaultLimit = 20,
    maxLimit = 100,
    defaultSort = 'created_at',
    allowedSorts = ['created_at', 'updated_at', 'id'],
  } = options;

  return (req, res, next) => {
    try {
      const { error, value } = paginationSchema.validate(req.query, {
        stripUnknown: false,
        allowUnknown: true,
      });

      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Paramètres de pagination invalides.',
          details: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
        });
      }

      // Valider la colonne de tri
      const sortBy = allowedSorts.includes(value.sort_by) ? value.sort_by : defaultSort;

      // Appliquer les limites
      const limit = Math.min(value.limit || defaultLimit, maxLimit);

      // Décoder le curseur
      const cursor = decodeCursor(value.cursor);

      // Attacher à req.pagination
      req.pagination = {
        cursor,
        limit,
        direction: value.direction,
        sortBy,
        sortOrder: value.sort_order,
        // Helpers pour le service
        buildCondition: (tableAlias) =>
          buildCursorCondition({
            cursor,
            sortBy,
            sortOrder: value.sort_order,
            direction: value.direction,
            tableAlias,
          }),
        buildResponse: (rows, hasMore) =>
          buildPaginatedResponse(rows, {
            limit,
            sortBy,
            sortOrder: value.sort_order,
            hasMore,
          }),
      };

      next();
    } catch (error) {
      console.error('[CursorPagination] Erreur middleware:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Erreur interne de pagination.',
      });
    }
  };
};

module.exports = {
  cursorPagination,
  decodeCursor,
  encodeCursor,
  buildCursorCondition,
  buildPaginatedResponse,
};
