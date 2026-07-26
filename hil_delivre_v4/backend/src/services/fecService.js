/**
 * @file fecService.js
 * @description Service de génération de factures FEC (Facturation Électronique Certifiée).
 * Conforme aux exigences de la DGI du Burkina Faso.
 * Hil_Delivre facture UNIQUEMENT ses propres services (commission + frais de livraison).
 * La TVA de 18% s'applique exclusivement sur ces services propres.
 */

'use strict';

const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');
const { getConfig } = require('./platformConfigService');

// ============================================================================
// CONSTANTES
// ============================================================================

const COMPANY_INFO = {
  name: 'Hil_Delivre SARL',
  rccm: process.env.COMPANY_RCCM || 'BF-OUA-XXXX-XXXXX',
  ifu: process.env.COMPANY_IFU || 'XXXXXXXXX',
  address: 'Ouagadougou, Burkina Faso',
  phone: process.env.STORE_PHONE || '+22670000000',
  email: process.env.COMPANY_EMAIL || 'facturation@hildelivre.bf'
};

const INVOICE_STATUS = {
  GENERATED: 'generated',
  SUBMITTED: 'submitted',
  FAILED: 'failed'
};

// ============================================================================
// FONCTIONS UTILITAIRES INTERNES
// ============================================================================

/**
 * Génère un numéro de facture séquentiel via la séquence PostgreSQL.
 * Format : HIL-YYYY-NNNNNN (ex: HIL-2024-000001)
 * @returns {Promise<string>} Numéro de facture unique
 */
async function generateInvoiceNumber() {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('generate_invoice_number');

    if (error) {
      throw new Error(`Failed to generate invoice number: ${error.message}`);
    }

    return data;
  } catch (err) {
    // Fallback : générer un numéro basé sur le timestamp si la séquence échoue
    const year = new Date().getFullYear();
    const timestamp = Date.now().toString().slice(-6);
    const fallback = `HIL-${year}-${timestamp}`;

    // Log l'erreur mais ne pas bloquer la facturation
    console.error(`[FEC] Sequence fallback used: ${err.message}`);
    return fallback;
  }
}

/**
 * Construit les données FEC complètes au format JSONB.
 * @param {Object} order - Commande
 * @param {Object} merchant - Profil marchand
 * @param {Object} client - Profil client
 * @param {string} invoiceNumber - Numéro de facture
 * @param {Object} amounts - Montants calculés
 * @returns {Object} Données FEC structurées
 */
function buildFecData(order, merchant, client, invoiceNumber, amounts) {
  const now = new Date();

  return {
    // Identification de la facture
    numero_facture: invoiceNumber,
    date_facture: now.toISOString(),
    date_commande: order.created_at,
    type_document: 'FACTURE',
    devise: 'XOF',

    // Émetteur (Hil_Delivre)
    emetteur: {
      raison_sociale: COMPANY_INFO.name,
      rccm: COMPANY_INFO.rccm,
      ifu: COMPANY_INFO.ifu,
      adresse: COMPANY_INFO.address,
      telephone: COMPANY_INFO.phone,
      email: COMPANY_INFO.email
    },

    // Client
    client: {
      nom: client.display_name || `${client.first_name || ''} ${client.last_name || ''}`.trim(),
      telephone: client.phone_number || '',
      adresse: order.delivery_address || client.address || ''
    },

    // Marchand (pour référence)
    marchand: {
      nom: merchant.display_name || merchant.first_name || '',
      ifu: merchant.business_registration_number || 'N/A'
    },

    // Lignes de facturation (services propres de Hil_Delivre uniquement)
    lignes: [
      {
        designation: 'Commission plateforme sur vente alimentaire',
        quantite: 1,
        prix_unitaire_ht: amounts.commission_ht,
        taux_tva: amounts.vat_rate * 100,
        montant_tva: Math.ceil(amounts.commission_ht * amounts.vat_rate),
        montant_ttc: Math.ceil(amounts.commission_ht * (1 + amounts.vat_rate))
      },
      {
        designation: 'Frais de livraison',
        quantite: 1,
        prix_unitaire_ht: amounts.delivery_fee_ht,
        taux_tva: amounts.vat_rate * 100,
        montant_tva: Math.ceil(amounts.delivery_fee_ht * amounts.vat_rate),
        montant_ttc: Math.ceil(amounts.delivery_fee_ht * (1 + amounts.vat_rate))
      }
    ],

    // Totaux
    totaux: {
      total_ht: amounts.total_ht,
      total_tva: amounts.total_tva,
      total_ttc: amounts.total_ttc
    },

    // Référence commande
    reference_commande: order.id,
    methode_paiement: order.payment_method,

    // Métadonnées de conformité
    conformite: {
      norme: 'FEC-BF',
      version: '1.0',
      genere_par: 'Hil_Delivre v4',
      genere_le: now.toISOString()
    }
  };
}

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Génère une facture FEC pour une commande après confirmation du paiement.
 * La facture concerne UNIQUEMENT les services propres de Hil_Delivre :
 * - Commission sur la vente (5% du food_amount)
 * - Frais de livraison
 * TVA de 18% appliquée sur ces deux éléments.
 *
 * @param {string} orderId - UUID de la commande
 * @returns {Promise<Object>} Facture FEC générée
 * @throws {Error} Si la commande n'existe pas ou si une facture existe déjà
 */
async function generateInvoice(orderId) {
  try {
    // 1. Vérifier qu'une facture n'existe pas déjà (idempotence)
    const { data: existingInvoice } = await supabaseAdmin
      .from('invoices_fec')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (existingInvoice) {
      return {
        invoice: existingInvoice,
        isExisting: true,
        message: 'Invoice already exists for this order'
      };
    }

    // 2. Récupérer la commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    // 3. Récupérer les profils marchand et client
    const { data: merchant, error: merchantError } = await supabaseAdmin
      .from('profiles_data')
      .select('user_id, first_name, last_name, display_name, business_registration_number')
      .eq('user_id', order.merchant_id)
      .single();

    if (merchantError || !merchant) {
      throw new Error('Merchant profile not found');
    }

    const { data: clientProfile, error: clientError } = await supabaseAdmin
      .from('profiles_data')
      .select('user_id, first_name, last_name, display_name, address')
      .eq('user_id', order.client_id)
      .single();

    // Récupérer le numéro de téléphone du client
    const { data: clientUser } = await supabaseAdmin
      .from('users')
      .select('phone_number')
      .eq('id', order.client_id)
      .single();

    const client = {
      ...(clientProfile || {}),
      phone_number: clientUser?.phone_number || ''
    };

    // 4. Récupérer le taux de TVA actuel
    let vatRate;
    try {
      vatRate = await getConfig('platform_vat_rate');
    } catch {
      vatRate = 0.18; // Valeur par défaut
    }

    // 5. Calculer les montants de la facture
    const commission_ht = Math.ceil(order.commission_amount || 0);
    const delivery_fee_ht = Math.ceil(order.delivery_fee || 0);
    const total_ht = commission_ht + delivery_fee_ht;
    const total_tva = Math.ceil(total_ht * vatRate);
    const total_ttc = total_ht + total_tva;

    const amounts = {
      commission_ht,
      delivery_fee_ht,
      total_ht,
      total_tva,
      total_ttc,
      vat_rate: vatRate
    };

    // 6. Générer le numéro de facture
    const invoiceNumber = await generateInvoiceNumber();

    // 7. Construire les données FEC
    const fecData = buildFecData(order, merchant, client, invoiceNumber, amounts);

    // 8. Insérer la facture en base
    const { data: invoice, error: insertError } = await supabaseAdmin
      .from('invoices_fec')
      .insert({
        order_id: orderId,
        merchant_id: order.merchant_id,
        client_id: order.client_id,
        invoice_number: invoiceNumber,
        invoice_date: new Date().toISOString(),
        commission_ht,
        delivery_fee_ht,
        total_ht,
        total_tva,
        total_ttc,
        vat_rate: vatRate,
        fec_data: fecData,
        status: INVOICE_STATUS.GENERATED
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to insert invoice: ${insertError.message}`);
    }

    // 9. Audit trail
    await logAuditEvent({
      userId: order.client_id,
      actionType: 'invoice_fec_generated',
      entityType: 'invoices_fec',
      entityId: invoice.id,
      newValue: {
        invoice_number: invoiceNumber,
        order_id: orderId,
        total_ttc,
        vat_rate: vatRate
      }
    });

    return {
      invoice,
      isExisting: false,
      message: 'Invoice generated successfully'
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`generateInvoice failed: ${err.message}`);
  }
}

/**
 * Récupère la facture FEC d'une commande.
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID de l'utilisateur demandant
 * @returns {Promise<Object|null>} Facture FEC ou null
 */
async function getInvoiceByOrder(orderId, userId) {
  try {
    // Vérifier l'accès à la commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, client_id, merchant_id')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    // Vérifier que l'utilisateur est client, marchand ou admin
    const isParty = [order.client_id, order.merchant_id].includes(userId);
    if (!isParty) {
      const { data: profile } = await supabaseAdmin
        .from('profiles_data')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (!profile || profile.role !== 'admin') {
        const err = new Error('Unauthorized: access denied to this invoice');
        err.statusCode = 403;
        throw err;
      }
    }

    // Récupérer la facture
    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices_fec')
      .select('*')
      .eq('order_id', orderId)
      .single();

    if (invoiceError || !invoice) {
      return null;
    }

    return invoice;
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`getInvoiceByOrder failed: ${err.message}`);
  }
}

/**
 * Récupère toutes les factures d'un marchand (pour ses rapports de ventes).
 * @param {string} merchantId - UUID du marchand
 * @param {Object} options - Options de pagination
 * @param {number} options.page - Page (défaut 1)
 * @param {number} options.limit - Limite par page (défaut 20)
 * @param {string} options.startDate - Date de début (ISO)
 * @param {string} options.endDate - Date de fin (ISO)
 * @returns {Promise<Object>} Liste paginée de factures
 */
async function getMerchantInvoices(merchantId, options = {}) {
  try {
    const { page = 1, limit = 20, startDate, endDate } = options;
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('invoices_fec')
      .select('*', { count: 'exact' })
      .eq('merchant_id', merchantId)
      .order('invoice_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (startDate) {
      query = query.gte('invoice_date', startDate);
    }
    if (endDate) {
      query = query.lte('invoice_date', endDate);
    }

    const { data: invoices, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch merchant invoices: ${error.message}`);
    }

    return {
      invoices: invoices || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    };
  } catch (err) {
    throw new Error(`getMerchantInvoices failed: ${err.message}`);
  }
}

module.exports = {
  generateInvoice,
  getInvoiceByOrder,
  getMerchantInvoices,
  generateInvoiceNumber,
  INVOICE_STATUS
};
