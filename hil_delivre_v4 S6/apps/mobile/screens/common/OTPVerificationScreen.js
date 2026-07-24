/**
 * @file OTPVerificationScreen.js
 * @description Écran de vérification OTP par SMS.
 * Permet à l'utilisateur de saisir le code reçu par SMS
 * pour vérifier son numéro de téléphone.
 */

'use strict';

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Keyboard
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { sendOTP, verifyOTP } from '../../services/notificationService';

// ============================================================================
// CONSTANTES
// ============================================================================

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

// ============================================================================
// COMPOSANT
// ============================================================================

export default function OTPVerificationScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { phoneNumber, purpose = 'phone_verification' } = route.params || {};

  const [code, setCode] = useState(Array(OTP_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [error, setError] = useState(null);

  const inputRefs = useRef([]);

  // ====================================================================
  // COOLDOWN TIMER
  // ====================================================================

  useEffect(() => {
    if (resendCooldown <= 0) return;

    const timer = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCooldown]);

  // ====================================================================
  // GESTION DES INPUTS
  // ====================================================================

  const handleCodeChange = (text, index) => {
    // Ne garder que les chiffres
    const digit = text.replace(/[^0-9]/g, '').slice(-1);

    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setError(null);

    // Auto-focus sur le champ suivant
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit quand tous les champs sont remplis
    if (digit && index === OTP_LENGTH - 1) {
      const fullCode = newCode.join('');
      if (fullCode.length === OTP_LENGTH) {
        Keyboard.dismiss();
        handleVerify(fullCode);
      }
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newCode = [...code];
      newCode[index - 1] = '';
      setCode(newCode);
    }
  };

  const handlePaste = (text) => {
    const digits = text.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH).split('');
    if (digits.length === OTP_LENGTH) {
      setCode(digits);
      Keyboard.dismiss();
      handleVerify(digits.join(''));
    }
  };

  // ====================================================================
  // ACTIONS
  // ====================================================================

  const handleVerify = async (codeStr = null) => {
    const fullCode = codeStr || code.join('');
    if (fullCode.length !== OTP_LENGTH) {
      setError('Veuillez saisir le code complet à 6 chiffres.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await verifyOTP(phoneNumber, fullCode, purpose);

      if (result.success) {
        Alert.alert(
          'Vérification réussie',
          'Votre numéro de téléphone a été vérifié avec succès.',
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      }
    } catch (err) {
      setError(err.message || 'Code invalide. Veuillez réessayer.');
      // Reset le code en cas d'erreur
      setCode(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;

    try {
      setLoading(true);
      await sendOTP(phoneNumber, purpose);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setError(null);
      setCode(Array(OTP_LENGTH).fill(''));
      Alert.alert('Code envoyé', 'Un nouveau code a été envoyé à votre numéro.');
    } catch (err) {
      setError(err.message || 'Impossible d\'envoyer un nouveau code.');
    } finally {
      setLoading(false);
    }
  };

  // ====================================================================
  // RENDU
  // ====================================================================

  const maskedPhone = phoneNumber
    ? phoneNumber.slice(0, 4) + '****' + phoneNumber.slice(-4)
    : '****';

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <Text style={styles.title}>Vérification</Text>
        <Text style={styles.subtitle}>
          Entrez le code à 6 chiffres envoyé au{'\n'}
          <Text style={styles.phoneText}>{maskedPhone}</Text>
        </Text>

        {/* Code Input */}
        <View style={styles.codeContainer}>
          {Array(OTP_LENGTH).fill(0).map((_, index) => (
            <TextInput
              key={index}
              ref={(ref) => { inputRefs.current[index] = ref; }}
              style={[
                styles.codeInput,
                code[index] && styles.codeInputFilled,
                error && styles.codeInputError
              ]}
              value={code[index]}
              onChangeText={(text) => handleCodeChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              onChange={(e) => {
                // Détection du paste
                const text = e.nativeEvent.text;
                if (text && text.length > 1) handlePaste(text);
              }}
              keyboardType="number-pad"
              maxLength={1}
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              selectTextOnFocus
            />
          ))}
        </View>

        {/* Error */}
        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        {/* Verify Button */}
        <TouchableOpacity
          style={[styles.verifyButton, loading && styles.verifyButtonDisabled]}
          onPress={() => handleVerify()}
          disabled={loading || code.join('').length !== OTP_LENGTH}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.verifyButtonText}>Vérifier</Text>
          )}
        </TouchableOpacity>

        {/* Resend */}
        <View style={styles.resendContainer}>
          <Text style={styles.resendLabel}>Vous n'avez pas reçu le code ?</Text>
          <TouchableOpacity
            onPress={handleResend}
            disabled={resendCooldown > 0 || loading}
          >
            <Text style={[
              styles.resendButton,
              resendCooldown > 0 && styles.resendButtonDisabled
            ]}>
              {resendCooldown > 0
                ? `Renvoyer dans ${resendCooldown}s`
                : 'Renvoyer le code'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Info */}
        <Text style={styles.infoText}>
          Le code expire dans 5 minutes.{'\n'}
          3 tentatives maximum par code.
        </Text>
      </View>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFF'
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    alignItems: 'center'
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 12
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40
  },
  phoneText: {
    fontWeight: '600',
    color: '#333'
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 24
  },
  codeInput: {
    width: 48,
    height: 56,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: '#1A1A1A'
  },
  codeInputFilled: {
    borderColor: '#FF6B35'
  },
  codeInputError: {
    borderColor: '#E53935'
  },
  errorText: {
    color: '#E53935',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16
  },
  verifyButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24
  },
  verifyButtonDisabled: {
    opacity: 0.6
  },
  verifyButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600'
  },
  resendContainer: {
    alignItems: 'center',
    marginBottom: 32
  },
  resendLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8
  },
  resendButton: {
    fontSize: 15,
    color: '#FF6B35',
    fontWeight: '600'
  },
  resendButtonDisabled: {
    color: '#999'
  },
  infoText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    lineHeight: 18
  }
});
