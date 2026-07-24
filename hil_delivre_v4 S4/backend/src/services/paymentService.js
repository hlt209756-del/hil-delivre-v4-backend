/**
 * @file paymentService.js
 * @description Service de gestion des paiements.
 * Intègre PayDunya pour Mobile Money, gère les paiements cash,
 * assure l'idempotence et la traçabilité de chaque transaction.
 */

'use strict';

const crypto = require('crypto');
const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');
const { getOrderCalculationRates } = require('./platformConfigService');

// ============================================================================
// CONSTANTES
// ============================================================================

const PAYDUNYA_BASE_URL = process.env.PAYDUNYA_MODE === 'test'
  ? 'https://app.paydunya.com/sandbox-api/v1'
  : 'https://app.paydunya.com/api/v1';

const PAYABLE_STATUSES = ['pending', 'accepted'];
const PAYMENT_STATUSES = {
  INITIATED: 'initiated',
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded'
};

const MAX_PAYMENT_ATTEMPTS = 3;

// ============================================================================
// FONCTIONS UTILITAIRES INTERNES
// ============================================================================

/**
 * Effectue un appel HTTP vers l'API PayDunya.
 * @param {string} endpoint - Endpoint relatif
 * @param {string} method - Méthode HTTP
 * @param {Object} body - Corps de la requête
 * @returns {Promise<Object>} Réponse JSON
 */
async function callPayDunyaAPI(endpoint, method = 'POST', body = null) {
  const url = `${PAYDUNYA_BASE_URL}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
    'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN
  };

  const options = {
    method,
    headers
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

/**
 * Vérifie la signature HMAC SHA-256 d'un webhook PayDunya.
 * @param {string|Buffer} rawBody - Corps brut de la requête
 * @param {string} signature - Signature fournie dans le header
 * @returns {boolean} true si la signature est valide
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!signature || !rawBody) {
    return false;
  }

  const masterKey = process.env.PAYDUNYA_MASTER_KEY;
  if (!masterKey) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', masterKey)
    .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
    .digest('hex');

  // Comparaison en temps constant pour éviter les timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Récupère une commande avec vérification de propriété et de statut.
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID de l'utilisateur
 * @param {boolean} checkOwnership - Vérifier que l'utilisateur est le client
 * @returns {Promise<Object>} Commande
 * @throws {Error} Si la commande n'existe pas ou n'est pas payable
 */
async function getPayableOrder(orderId, userId, checkOwnership = true) {
  const { data: order, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error || !order) {
    const err = new Error('Order not found');
    err.statusCode = 404;
    throw err;
  }

  if (checkOwnership && order.client_id !== userId) {
    const err = new Error('Unauthorized: you are not the owner of this order');
    err.statusCode = 403;
    throw err;
  }

  if (!PAYABLE_STATUSES.includes(order.status)) {
    const err = new Error(`Order is not payable. Current status: ${order.status}`);
    err.statusCode = 409;
    throw err;
  }

  return order;
}

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Initie un paiement Mobile Money via PayDunya.
 * Assure l'idempotence : si une transaction existe déjà pour cette commande,
 * retourne la transaction existante au lieu d'en créer une nouvelle.
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID du client
 * @param {string} phoneNumber - Numéro de téléphone pour le paiement
 * @returns {Promise<Object>} Transaction créée avec URL de paiement
 */
async function initiateMobileMoneyPayment(orderId, userId, phoneNumber) {
  try {
    // 1. Vérifier la commande
    const order = await getPayableOrder(orderId, userId);

    // 2. Vérifier l'idempotence : transaction existante non terminée ?
    const { data: existingTx } = await supabaseAdmin
      .from('payment_transactions')
      .select('*')
      .eq('order_id', orderId)
      .in('status', [PAYMENT_STATUSES.INITIATED, PAYMENT_STATUSES.PENDING])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingTx) {
      // Retourner la transaction existante si elle est encore en cours
      return {
        transaction: existingTx,
        message: 'Payment already initiated for this order',
        isExisting: true
      };
    }

    // 3. Vérifier le nombre de tentatives échouées
    const { count: failedCount } = await supabaseAdmin
      .from('payment_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('status', PAYMENT_STATUSES.FAILED);

    if (failedCount >= MAX_PAYMENT_ATTEMPTS) {
      const err = new Error('Maximum payment attempts reached for this order');
      err.statusCode = 429;
      throw err;
    }

    // 4. Générer l'idempotency key
    const idempotencyKey = crypto.randomUUID();

    // 5. Créer la transaction en base
    const { data: transaction, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        order_id: orderId,
        user_id: userId,
        idempotency_key: idempotencyKey,
        payment_method: 'mobile_money',
        amount: order.total_amount,
        currency: 'XOF',
        status: PAYMENT_STATUSES.INITIATED,
        provider: 'paydunya',
        attempts: (failedCount || 0) + 1,
        max_attempts: MAX_PAYMENT_ATTEMPTS,
        metadata: {
          phone_number: phoneNumber ? phoneNumber.slice(-4) : null, // Ne stocker que les 4 derniers chiffres
          order_food_amount: order.food_amount,
          order_commission: order.commission_amount,
          order_delivery_fee: order.delivery_fee,
          order_vat: order.platform_vat_amount
        }
      })
      .select()
      .single();

    if (txError) {
      throw new Error(`Failed to create payment transaction: ${txError.message}`);
    }

    // 6. Appeler PayDunya pour créer la facture de paiement
    const webhookUrl = `${process.env.API_BASE_URL || 'https://api.hildelivre.bf'}/api/payments/webhook`;
    const returnUrl = `${process.env.APP_URL || 'https://app.hildelivre.bf'}/payment/success`;
    const cancelUrl = `${process.env.APP_URL || 'https://app.hildelivre.bf'}/payment/cancel`;

    const paydunyaPayload = {
      invoice: {
        total_amount: Math.ceil(order.total_amount),
        description: `Commande Hil_Delivre #${orderId.slice(0, 8)}`,
        items: {
          item_0: {
            name: 'Commande alimentaire',
            quantity: 1,
            unit_price: Math.ceil(order.food_amount),
            total_price: Math.ceil(order.food_amount)
          },
          item_1: {
            name: 'Frais de service (commission + TVA plateforme)',
            quantity: 1,
            unit_price: Math.ceil(order.service_fees),
            total_price: Math.ceil(order.service_fees)
          }
        }
      },
      store: {
        name: 'Hil_Delivre',
        tagline: 'Livraison rapide au Burkina Faso',
        phone: process.env.STORE_PHONE || '+22670000000',
        postal_address: 'Ouagadougou, Burkina Faso',
        website_url: process.env.APP_URL || 'https://hildelivre.bf'
      },
      custom_data: {
        order_id: orderId,
        transaction_id: transaction.id,
        idempotency_key: idempotencyKey
      },
      actions: {
        callback_url: webhookUrl,
        return_url: returnUrl,
        cancel_url: cancelUrl
      }
    };

    const paydunyaResponse = await callPayDunyaAPI(
      '/checkout-invoice/create',
      'POST',
      paydunyaPayload
    );

    if (!paydunyaResponse.ok || paydunyaResponse.data.response_code !== '00') {
      // Marquer la transaction comme échouée
      await supabaseAdmin
        .from('payment_transactions')
        .update({
          status: PAYMENT_STATUSES.FAILED,
          error_message: paydunyaResponse.data.response_text || 'PayDunya API error',
          provider_status: paydunyaResponse.data.response_code
        })
        .eq('id', transaction.id);

      const err = new Error('Payment provider error. Please try again.');
      err.statusCode = 502;
      throw err;
    }

    // 7. Mettre à jour la transaction avec les infos PayDunya
    const { data: updatedTx, error: updateError } = await supabaseAdmin
      .from('payment_transactions')
      .update({
        status: PAYMENT_STATUSES.PENDING,
        provider_ref: paydunyaResponse.data.token,
        provider_token: paydunyaResponse.data.token,
        provider_response_url: paydunyaResponse.data.response_text
      })
      .eq('id', transaction.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update transaction: ${updateError.message}`);
    }

    // 8. Mettre à jour la commande avec la méthode de paiement
    await supabaseAdmin
      .from('orders')
      .update({
        payment_method: 'mobile_money',
        payment_transaction_id: transaction.id
      })
      .eq('id', orderId);

    // 9. Audit trail
    await logAuditEvent({
      userId,
      actionType: 'payment_initiated',
      entityType: 'payment_transaction',
      entityId: transaction.id,
      newValue: {
        order_id: orderId,
        amount: order.total_amount,
        method: 'mobile_money',
        provider: 'paydunya'
      }
    });

    return {
      transaction: updatedTx,
      paymentUrl: paydunyaResponse.data.response_text,
      token: paydunyaResponse.data.token,
      isExisting: false
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`initiateMobileMoneyPayment failed: ${err.message}`);
  }
}

/**
 * Traite le webhook de confirmation PayDunya.
 * Vérifie la signature, met à jour la transaction et la commande.
 * @param {Object} payload - Corps du webhook
 * @param {string} rawBody - Corps brut pour vérification de signature
 * @param {string} signature - Signature HMAC du header
 * @returns {Promise<Object>} Résultat du traitement
 */
async function handlePayDunyaWebhook(payload, rawBody, signature) {
  try {
    // 1. Vérifier la signature (sauf en mode test)
    if (process.env.PAYDUNYA_MODE !== 'test') {
      const isValid = verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        const err = new Error('Invalid webhook signature');
        err.statusCode = 401;
        throw err;
      }
    }

    // 2. Extraire les données du webhook
    const {
      data: webhookData
    } = payload;

    const customData = webhookData?.custom_data || payload?.custom_data || {};
    const transactionId = customData.transaction_id;
    const orderId = customData.order_id;
    const idempotencyKey = customData.idempotency_key;
    const status = webhookData?.status || payload?.status;
    const providerRef = webhookData?.token || payload?.token;

    if (!transactionId && !orderId) {
      const err = new Error('Missing transaction or order reference in webhook');
      err.statusCode = 400;
      throw err;
    }

    // 3. Récupérer la transaction
    let query = supabaseAdmin.from('payment_transactions').select('*');
    if (transactionId) {
      query = query.eq('id', transactionId);
    } else if (idempotencyKey) {
      query = query.eq('idempotency_key', idempotencyKey);
    } else {
      query = query.eq('order_id', orderId).eq('status', PAYMENT_STATUSES.PENDING).limit(1);
    }

    const { data: transaction, error: txError } = await query.single();

    if (txError || !transaction) {
      const err = new Error('Payment transaction not found');
      err.statusCode = 404;
      throw err;
    }

    // 4. Idempotence : si déjà complétée, ne pas retraiter
    if (transaction.status === PAYMENT_STATUSES.COMPLETED) {
      return {
        message: 'Transaction already completed',
        transaction,
        idempotent: true
      };
    }

    // 5. Mapper le statut PayDunya vers notre statut interne
    let newStatus;
    switch (status) {
      case 'completed':
        newStatus = PAYMENT_STATUSES.COMPLETED;
        break;
      case 'failed':
        newStatus = PAYMENT_STATUSES.FAILED;
        break;
      case 'cancelled':
        newStatus = PAYMENT_STATUSES.CANCELLED;
        break;
      default:
        newStatus = PAYMENT_STATUSES.PENDING;
    }

    // 6. Mettre à jour la transaction
    const updateData = {
      status: newStatus,
      provider_ref: providerRef || transaction.provider_ref,
      provider_status: status,
      metadata: {
        ...transaction.metadata,
        webhook_received_at: new Date().toISOString(),
        webhook_status: status
      }
    };

    if (newStatus === PAYMENT_STATUSES.COMPLETED) {
      updateData.completed_at = new Date().toISOString();
    }

    if (newStatus === PAYMENT_STATUSES.FAILED) {
      updateData.error_message = webhookData?.fail_reason || 'Payment failed';
    }

    const { data: updatedTx, error: updateError } = await supabaseAdmin
      .from('payment_transactions')
      .update(updateData)
      .eq('id', transaction.id)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Failed to update transaction: ${updateError.message}`);
    }

    // 7. Si paiement réussi, mettre à jour la commande
    if (newStatus === PAYMENT_STATUSES.COMPLETED) {
      await supabaseAdmin
        .from('orders')
        .update({
          status: 'accepted',
          payment_transaction_id: transaction.id
        })
        .eq('id', transaction.order_id)
        .eq('status', 'pending'); // Ne mettre à jour que si encore en pending
    }

    // 8. Audit trail
    await logAuditEvent({
      userId: transaction.user_id,
      actionType: `payment_webhook_${newStatus}`,
      entityType: 'payment_transaction',
      entityId: transaction.id,
      oldValue: { status: transaction.status },
      newValue: { status: newStatus, provider_ref: providerRef }
    });

    return {
      message: `Payment ${newStatus}`,
      transaction: updatedTx,
      idempotent: false
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`handlePayDunyaWebhook failed: ${err.message}`);
  }
}

/**
 * Marque une commande comme paiement en espèces.
 * Le paiement sera collecté par le livreur à la livraison.
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID du client
 * @returns {Promise<Object>} Transaction créée
 */
async function markOrderAsCash(orderId, userId) {
  try {
    // 1. Vérifier la commande
    const order = await getPayableOrder(orderId, userId);

    // 2. Vérifier qu'il n'y a pas déjà une transaction complétée
    const { data: existingCompleted } = await supabaseAdmin
      .from('payment_transactions')
      .select('id')
      .eq('order_id', orderId)
      .eq('status', PAYMENT_STATUSES.COMPLETED)
      .limit(1)
      .single();

    if (existingCompleted) {
      const err = new Error('Order already has a completed payment');
      err.statusCode = 409;
      throw err;
    }

    // 3. Créer la transaction cash
    const idempotencyKey = crypto.randomUUID();

    const { data: transaction, error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        order_id: orderId,
        user_id: userId,
        idempotency_key: idempotencyKey,
        payment_method: 'cash',
        amount: order.total_amount,
        currency: 'XOF',
        status: PAYMENT_STATUSES.COMPLETED, // Cash est immédiatement "complété" (collecte à la livraison)
        provider: 'cash',
        provider_ref: `CASH-${orderId.slice(0, 8)}-${Date.now()}`,
        completed_at: new Date().toISOString(),
        metadata: {
          cash_collection_pending: true,
          order_food_amount: order.food_amount,
          order_total: order.total_amount
        }
      })
      .select()
      .single();

    if (txError) {
      throw new Error(`Failed to create cash transaction: ${txError.message}`);
    }

    // 4. Mettre à jour la commande
    await supabaseAdmin
      .from('orders')
      .update({
        payment_method: 'cash',
        cash_payment_status: 'pending',
        payment_transaction_id: transaction.id
      })
      .eq('id', orderId);

    // 5. Audit trail
    await logAuditEvent({
      userId,
      actionType: 'payment_cash_selected',
      entityType: 'payment_transaction',
      entityId: transaction.id,
      newValue: {
        order_id: orderId,
        amount: order.total_amount,
        method: 'cash'
      }
    });

    return {
      transaction,
      message: 'Order marked as cash payment. Amount will be collected at delivery.'
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`markOrderAsCash failed: ${err.message}`);
  }
}

/**
 * Récupère le statut de paiement d'une commande.
 * @param {string} orderId - UUID de la commande
 * @param {string} userId - UUID de l'utilisateur demandant
 * @returns {Promise<Object>} Statut du paiement
 */
async function getPaymentStatus(orderId, userId) {
  try {
    // Vérifier que l'utilisateur a accès à cette commande
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, client_id, merchant_id, delivery_id, status, payment_method, cash_payment_status')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }

    // Vérifier l'accès (client, marchand ou livreur de la commande)
    const isParty = [order.client_id, order.merchant_id, order.delivery_id].includes(userId);
    if (!isParty) {
      // Vérifier si admin
      const { data: profile } = await supabaseAdmin
        .from('profiles_data')
        .select('role')
        .eq('user_id', userId)
        .single();

      if (!profile || profile.role !== 'admin') {
        const err = new Error('Unauthorized: you are not a party of this order');
        err.statusCode = 403;
        throw err;
      }
    }

    // Récupérer la dernière transaction
    const { data: transaction } = await supabaseAdmin
      .from('payment_transactions')
      .select('id, status, payment_method, amount, provider_ref, created_at, completed_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return {
      orderId,
      orderStatus: order.status,
      paymentMethod: order.payment_method,
      cashPaymentStatus: order.cash_payment_status,
      transaction: transaction || null,
      isPaid: transaction?.status === PAYMENT_STATUSES.COMPLETED
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`getPaymentStatus failed: ${err.message}`);
  }
}

module.exports = {
  initiateMobileMoneyPayment,
  handlePayDunyaWebhook,
  markOrderAsCash,
  getPaymentStatus,
  verifyWebhookSignature,
  PAYMENT_STATUSES,
  PAYABLE_STATUSES
};
