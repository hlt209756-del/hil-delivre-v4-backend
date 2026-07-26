/**
 * @file paymentController.js
 * @description Contrôleur des endpoints de paiement.
 * Gère l'initiation des paiements (Mobile Money / Cash),
 * le webhook PayDunya, le statut de paiement et les factures FEC.
 */

'use strict';

const paymentService = require('../services/paymentService');
const fecService = require('../services/fecService');
const { success, error: errorResponse } = require('../utils/responseHelper');

// ============================================================================
// CONTRÔLEURS
// ============================================================================

/**
 * POST /api/payments/initiate
 * Initie un paiement pour une commande.
 * - Mobile Money : crée une facture PayDunya et retourne l'URL de paiement
 * - Cash : marque la commande comme paiement en espèces
 *
 * @param {Object} req - Express request
 * @param {Object} req.body.order_id - UUID de la commande
 * @param {Object} req.body.payment_method - 'mobile_money' ou 'cash'
 * @param {Object} req.body.phone_number - Numéro pour Mobile Money (optionnel)
 * @param {Object} res - Express response
 */
async function initiatePayment(req, res) {
  try {
    const { order_id, payment_method, phone_number } = req.body;
    const userId = req.user.id;

    let result;

    if (payment_method === 'mobile_money') {
      result = await paymentService.initiateMobileMoneyPayment(
        order_id,
        userId,
        phone_number
      );

      return res.status(result.isExisting ? 200 : 201).json(
        success({
          transaction_id: result.transaction.id,
          status: result.transaction.status,
          payment_url: result.paymentUrl || null,
          token: result.token || null,
          amount: result.transaction.amount,
          currency: result.transaction.currency,
          is_existing: result.isExisting,
          message: result.message || 'Payment initiated successfully'
        }, result.isExisting ? 'Existing payment found' : 'Payment initiated')
      );
    } else if (payment_method === 'cash') {
      result = await paymentService.markOrderAsCash(order_id, userId);

      return res.status(201).json(
        success({
          transaction_id: result.transaction.id,
          status: result.transaction.status,
          amount: result.transaction.amount,
          currency: result.transaction.currency,
          payment_method: 'cash',
          message: result.message
        }, 'Cash payment registered')
      );
    } else {
      return res.status(400).json(
        errorResponse('Invalid payment method. Use "mobile_money" or "cash".')
      );
    }
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Internal server error during payment initiation' : err.message,
        statusCode
      )
    );
  }
}

/**
 * POST /api/payments/webhook
 * Endpoint webhook pour PayDunya.
 * Accessible publiquement mais sécurisé par vérification de signature HMAC.
 * Traite les notifications de paiement (completed, failed, cancelled).
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function webhookPayDunya(req, res) {
  try {
    const signature = req.headers['x-paydunya-signature'] ||
                      req.headers['paydunya-signature'] ||
                      req.headers['x-webhook-signature'];
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const payload = req.body;

    const result = await paymentService.handlePayDunyaWebhook(
      payload,
      rawBody,
      signature
    );

    // Si le paiement est complété, générer la facture FEC
    if (result.transaction && result.transaction.status === 'completed' && !result.idempotent) {
      try {
        await fecService.generateInvoice(result.transaction.order_id);
      } catch (fecErr) {
        // Ne pas bloquer le webhook si la génération FEC échoue
        // L'erreur sera loggée et la facture pourra être regénérée
        console.error(`[FEC] Invoice generation failed for order ${result.transaction.order_id}: ${fecErr.message}`);
      }
    }

    // Toujours répondre 200 au webhook pour éviter les retries
    return res.status(200).json({
      status: 'ok',
      message: result.message,
      idempotent: result.idempotent
    });
  } catch (err) {
    // En cas d'erreur de signature, répondre 401
    if (err.statusCode === 401) {
      return res.status(401).json({ status: 'error', message: 'Invalid signature' });
    }

    // Pour les autres erreurs, répondre 200 quand même pour éviter les retries infinis
    // mais logger l'erreur
    console.error(`[WEBHOOK] Error processing PayDunya webhook: ${err.message}`);
    return res.status(200).json({
      status: 'error',
      message: 'Webhook processing error (logged)'
    });
  }
}

/**
 * GET /api/payments/:orderId/status
 * Récupère le statut de paiement d'une commande.
 * Accessible par les parties de la commande (client, marchand, livreur) et les admins.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getPaymentStatus(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const result = await paymentService.getPaymentStatus(orderId, userId);

    return res.status(200).json(
      success(result, 'Payment status retrieved')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Internal server error' : err.message,
        statusCode
      )
    );
  }
}

/**
 * GET /api/orders/:orderId/invoice
 * Récupère la facture FEC d'une commande.
 * Accessible par le client et le marchand de la commande, ainsi que les admins.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function getInvoice(req, res) {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const invoice = await fecService.getInvoiceByOrder(orderId, userId);

    if (!invoice) {
      return res.status(404).json(
        errorResponse('Invoice not found for this order. It may not have been generated yet.', 404)
      );
    }

    return res.status(200).json(
      success(invoice, 'Invoice retrieved')
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json(
      errorResponse(
        statusCode === 500 ? 'Internal server error' : err.message,
        statusCode
      )
    );
  }
}

module.exports = {
  initiatePayment,
  webhookPayDunya,
  getPaymentStatus,
  getInvoice
};
