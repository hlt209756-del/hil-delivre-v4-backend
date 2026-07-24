/**
 * @file otpService.js
 * @description Service OTP (One-Time Password) via Africa's Talking SMS.
 * Gère la génération, l'envoi et la vérification des codes OTP
 * pour la vérification de numéro de téléphone.
 *
 * Documentation Africa's Talking : https://africastalking.com/docs/sms
 *
 * Sécurité :
 * - Codes hashés en BDD (SHA-256)
 * - Expiration 5 minutes
 * - Max 3 tentatives par code
 * - Rate limiting : 3 OTP par numéro par heure
 * - Nettoyage automatique des codes expirés
 */

'use strict';

const crypto = require('crypto');
const { supabaseAdmin } = require('./supabaseService');
const { logAuditEvent } = require('./auditService');

// ============================================================================
// CONFIGURATION
// ============================================================================

const AT_API_KEY = process.env.AFRICASTALKING_API_KEY;
const AT_USERNAME = process.env.AFRICASTALKING_USERNAME || 'sandbox';
const AT_SENDER_ID = process.env.AFRICASTALKING_SENDER_ID || 'HilDelivre';
const AT_BASE_URL = process.env.AFRICASTALKING_ENV === 'production'
  ? 'https://api.africastalking.com/version1/messaging'
  : 'https://api.sandbox.africastalking.com/version1/messaging';

// Paramètres OTP
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RATE_LIMIT_PER_HOUR = 3;
const OTP_COOLDOWN_SECONDS = 60; // Minimum 60s entre deux envois

// ============================================================================
// FONCTIONS PUBLIQUES
// ============================================================================

/**
 * Génère et envoie un code OTP par SMS.
 *
 * @param {string} phoneNumber - Numéro au format international (+226XXXXXXXX)
 * @param {string} purpose - 'phone_verification', 'login_2fa', 'password_reset', 'delivery_confirmation'
 * @param {string} [userId] - UUID de l'utilisateur (optionnel pour la première vérification)
 * @param {string} [ipAddress] - Adresse IP du demandeur
 * @returns {Promise<Object>} {success, message, expires_at}
 */
async function sendOTP(phoneNumber, purpose, userId = null, ipAddress = null) {
  try {
    // 1. Valider le numéro de téléphone
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
      const err = new Error('Invalid phone number format. Use +226XXXXXXXX');
      err.statusCode = 400;
      throw err;
    }

    // 2. Vérifier le rate limiting
    await checkRateLimit(normalizedPhone);

    // 3. Vérifier le cooldown (pas de spam)
    await checkCooldown(normalizedPhone, purpose);

    // 4. Générer le code OTP
    const code = generateSecureOTP();
    const codeHash = hashCode(code);

    // 5. Calculer l'expiration
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // 6. Invalider les anciens OTP non vérifiés pour ce numéro/purpose
    await supabaseAdmin
      .from('otp_codes')
      .delete()
      .eq('phone_number', normalizedPhone)
      .eq('purpose', purpose)
      .eq('is_verified', false);

    // 7. Stocker le code hashé en BDD
    const { error: insertError } = await supabaseAdmin
      .from('otp_codes')
      .insert({
        user_id: userId,
        phone_number: normalizedPhone,
        code_hash: codeHash,
        purpose,
        expires_at: expiresAt,
        ip_address: ipAddress
      });

    if (insertError) {
      throw new Error(`Failed to store OTP: ${insertError.message}`);
    }

    // 8. Envoyer le SMS via Africa's Talking
    const smsResult = await sendSMS(
      normalizedPhone,
      `Votre code de vérification Hil_Delivre est : ${code}. Valide ${OTP_EXPIRY_MINUTES} minutes. Ne le partagez avec personne.`
    );

    // 9. Audit trail
    if (userId) {
      await logAuditEvent({
        userId,
        actionType: 'otp_sent',
        entityType: 'otp',
        entityId: null,
        newValue: {
          phone: maskPhoneNumber(normalizedPhone),
          purpose,
          sms_status: smsResult.success ? 'sent' : 'failed'
        }
      });
    }

    return {
      success: true,
      message: `Code OTP envoyé au ${maskPhoneNumber(normalizedPhone)}`,
      expires_at: expiresAt,
      expires_in_seconds: OTP_EXPIRY_MINUTES * 60
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`sendOTP failed: ${err.message}`);
  }
}

/**
 * Vérifie un code OTP.
 *
 * @param {string} phoneNumber - Numéro au format international
 * @param {string} code - Code OTP saisi par l'utilisateur
 * @param {string} purpose - Purpose du code
 * @returns {Promise<Object>} {success, message}
 */
async function verifyOTP(phoneNumber, code, purpose) {
  try {
    // 1. Valider les entrées
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone) {
      const err = new Error('Invalid phone number format');
      err.statusCode = 400;
      throw err;
    }

    if (!code || code.length !== OTP_LENGTH) {
      const err = new Error(`OTP must be ${OTP_LENGTH} digits`);
      err.statusCode = 400;
      throw err;
    }

    // 2. Récupérer le dernier OTP non vérifié pour ce numéro/purpose
    const { data: otpRecord, error: fetchError } = await supabaseAdmin
      .from('otp_codes')
      .select('*')
      .eq('phone_number', normalizedPhone)
      .eq('purpose', purpose)
      .eq('is_verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !otpRecord) {
      const err = new Error('No pending OTP found. Please request a new code.');
      err.statusCode = 404;
      throw err;
    }

    // 3. Vérifier l'expiration
    if (new Date(otpRecord.expires_at) < new Date()) {
      // Supprimer le code expiré
      await supabaseAdmin
        .from('otp_codes')
        .delete()
        .eq('id', otpRecord.id);

      const err = new Error('OTP has expired. Please request a new code.');
      err.statusCode = 410;
      throw err;
    }

    // 4. Vérifier le nombre de tentatives
    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      // Supprimer le code épuisé
      await supabaseAdmin
        .from('otp_codes')
        .delete()
        .eq('id', otpRecord.id);

      const err = new Error('Maximum attempts exceeded. Please request a new code.');
      err.statusCode = 429;
      throw err;
    }

    // 5. Incrémenter les tentatives
    await supabaseAdmin
      .from('otp_codes')
      .update({ attempts: otpRecord.attempts + 1 })
      .eq('id', otpRecord.id);

    // 6. Vérifier le code (comparaison timing-safe du hash)
    const inputHash = hashCode(code);
    const isValid = crypto.timingSafeEqual(
      Buffer.from(inputHash, 'hex'),
      Buffer.from(otpRecord.code_hash, 'hex')
    );

    if (!isValid) {
      const remainingAttempts = OTP_MAX_ATTEMPTS - (otpRecord.attempts + 1);
      const err = new Error(
        `Invalid code. ${remainingAttempts} attempt(s) remaining.`
      );
      err.statusCode = 401;
      err.remainingAttempts = remainingAttempts;
      throw err;
    }

    // 7. Marquer comme vérifié
    await supabaseAdmin
      .from('otp_codes')
      .update({
        is_verified: true,
        verified_at: new Date().toISOString()
      })
      .eq('id', otpRecord.id);

    // 8. Si c'est une vérification de téléphone, mettre à jour le profil
    if (purpose === 'phone_verification' && otpRecord.user_id) {
      await supabaseAdmin
        .from('profiles_data')
        .update({
          phone_verified: true,
          phone_verified_at: new Date().toISOString()
        })
        .eq('user_id', otpRecord.user_id);
    }

    // 9. Audit trail
    if (otpRecord.user_id) {
      await logAuditEvent({
        userId: otpRecord.user_id,
        actionType: 'otp_verified',
        entityType: 'otp',
        entityId: otpRecord.id,
        newValue: { phone: maskPhoneNumber(normalizedPhone), purpose }
      });
    }

    return {
      success: true,
      message: 'OTP verified successfully',
      user_id: otpRecord.user_id
    };
  } catch (err) {
    if (err.statusCode) throw err;
    throw new Error(`verifyOTP failed: ${err.message}`);
  }
}

// ============================================================================
// FONCTIONS INTERNES
// ============================================================================

/**
 * Normalise un numéro de téléphone au format international Burkina Faso.
 * Accepte : +226XXXXXXXX, 226XXXXXXXX, 0XXXXXXXX, XXXXXXXX
 */
function normalizePhoneNumber(phone) {
  if (!phone) return null;

  // Supprimer espaces, tirets, points
  let cleaned = phone.replace(/[\s\-\.()]/g, '');

  // Si commence par 00, remplacer par +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // Si commence par 0 (format local BF), ajouter +226
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '+226' + cleaned.slice(1);
  }

  // Si pas de +, ajouter +
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('226') && cleaned.length === 11) {
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 8) {
      cleaned = '+226' + cleaned;
    } else {
      return null;
    }
  }

  // Valider le format final : +226 suivi de 8 chiffres
  const regex = /^\+226[0-9]{8}$/;
  if (!regex.test(cleaned)) {
    return null;
  }

  return cleaned;
}

/**
 * Génère un code OTP cryptographiquement sécurisé.
 */
function generateSecureOTP() {
  const buffer = crypto.randomBytes(4);
  const number = buffer.readUInt32BE(0);
  const code = (number % Math.pow(10, OTP_LENGTH)).toString().padStart(OTP_LENGTH, '0');
  return code;
}

/**
 * Hash un code OTP avec SHA-256.
 */
function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Masque un numéro de téléphone pour l'affichage.
 * +22670123456 → +226****3456
 */
function maskPhoneNumber(phone) {
  if (!phone || phone.length < 8) return '****';
  return phone.slice(0, 4) + '****' + phone.slice(-4);
}

/**
 * Vérifie le rate limiting (max 3 OTP par heure par numéro).
 */
async function checkRateLimit(phoneNumber) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await supabaseAdmin
    .from('otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('phone_number', phoneNumber)
    .gte('created_at', oneHourAgo);

  if (error) {
    throw new Error(`Rate limit check failed: ${error.message}`);
  }

  if (count >= OTP_RATE_LIMIT_PER_HOUR) {
    const err = new Error('Too many OTP requests. Please wait 1 hour before trying again.');
    err.statusCode = 429;
    throw err;
  }
}

/**
 * Vérifie le cooldown entre deux envois (min 60s).
 */
async function checkCooldown(phoneNumber, purpose) {
  const { data: lastOtp } = await supabaseAdmin
    .from('otp_codes')
    .select('created_at')
    .eq('phone_number', phoneNumber)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (lastOtp) {
    const elapsed = (Date.now() - new Date(lastOtp.created_at).getTime()) / 1000;
    if (elapsed < OTP_COOLDOWN_SECONDS) {
      const remaining = Math.ceil(OTP_COOLDOWN_SECONDS - elapsed);
      const err = new Error(`Please wait ${remaining} seconds before requesting a new code.`);
      err.statusCode = 429;
      throw err;
    }
  }
}

/**
 * Envoie un SMS via Africa's Talking.
 */
async function sendSMS(phoneNumber, message) {
  try {
    if (!AT_API_KEY) {
      console.warn('[OTP] Africa\'s Talking API key not configured. SMS not sent.');
      console.log(`[OTP] [DEV MODE] Code for ${phoneNumber}: check logs`);
      return { success: true, dev_mode: true };
    }

    const params = new URLSearchParams();
    params.append('username', AT_USERNAME);
    params.append('to', phoneNumber);
    params.append('message', message);
    if (AT_SENDER_ID && AT_USERNAME !== 'sandbox') {
      params.append('from', AT_SENDER_ID);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(AT_BASE_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'apiKey': AT_API_KEY
      },
      body: params.toString(),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Africa's Talking API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const recipients = data?.SMSMessageData?.Recipients || [];

    if (recipients.length > 0 && recipients[0].status === 'Success') {
      return { success: true, messageId: recipients[0].messageId };
    }

    const statusCode = recipients[0]?.statusCode;
    console.warn(`[OTP] SMS delivery issue: ${recipients[0]?.status} (code: ${statusCode})`);
    return { success: false, status: recipients[0]?.status };
  } catch (err) {
    console.error(`[OTP] SMS send error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  sendOTP,
  verifyOTP,
  normalizePhoneNumber,
  OTP_LENGTH,
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS
};
