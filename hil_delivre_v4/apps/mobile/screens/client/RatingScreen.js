'use strict';

/**
 * @fileoverview Écran de notation pour le client.
 * Permet de noter le marchand et le livreur après une commande livrée.
 * @module screens/client/RatingScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { createRating, checkCanRate } from '../../services/ratingService';

/** Couleurs du thème */
const COLORS = {
    primary: '#FF6B35',
    secondary: '#004E89',
    success: '#28A745',
    warning: '#FFC107',
    danger: '#DC3545',
    background: '#F8F9FA',
    card: '#FFFFFF',
    text: '#212529',
    textSecondary: '#6C757D',
    border: '#DEE2E6',
    star: '#FFD700',
    starEmpty: '#E0E0E0'
};

/**
 * Composant étoile interactive pour la notation.
 *
 * @param {object} props
 * @param {number} props.rating - Score actuel
 * @param {function} props.onRate - Callback quand une étoile est pressée
 * @param {number} [props.size=40] - Taille des étoiles
 * @param {boolean} [props.disabled=false] - Désactiver l'interaction
 */
function StarRating({ rating, onRate, size = 40, disabled = false }) {
    return (
        <View style={styles.starContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity
                    key={star}
                    onPress={() => !disabled && onRate(star)}
                    disabled={disabled}
                    activeOpacity={0.7}
                    accessibilityLabel={`${star} étoile${star > 1 ? 's' : ''}`}
                    accessibilityRole="button"
                >
                    <Ionicons
                        name={star <= rating ? 'star' : 'star-outline'}
                        size={size}
                        color={star <= rating ? COLORS.star : COLORS.starEmpty}
                        style={styles.star}
                    />
                </TouchableOpacity>
            ))}
        </View>
    );
}

/**
 * Écran principal de notation.
 * Affiche les formulaires de notation pour le marchand et le livreur.
 */
export default function RatingScreen() {
    const route = useRoute();
    const navigation = useNavigation();
    const { orderId, merchantId, merchantName, deliveryId, deliveryName } = route.params || {};

    // État pour la notation du marchand
    const [merchantScore, setMerchantScore] = useState(0);
    const [merchantComment, setMerchantComment] = useState('');
    const [canRateMerchant, setCanRateMerchant] = useState(null);

    // État pour la notation du livreur
    const [deliveryScore, setDeliveryScore] = useState(0);
    const [deliveryComment, setDeliveryComment] = useState('');
    const [canRateDelivery, setCanRateDelivery] = useState(null);

    // État global
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [merchantSubmitted, setMerchantSubmitted] = useState(false);
    const [deliverySubmitted, setDeliverySubmitted] = useState(false);

    /**
     * Vérifie les possibilités de notation au chargement.
     */
    useEffect(() => {
        async function checkRatingEligibility() {
            try {
                setLoading(true);

                if (merchantId) {
                    const merchantCheck = await checkCanRate(orderId, merchantId);
                    setCanRateMerchant(merchantCheck);
                }

                if (deliveryId) {
                    const deliveryCheck = await checkCanRate(orderId, deliveryId);
                    setCanRateDelivery(deliveryCheck);
                }
            } catch (error) {
                console.error('[RatingScreen] Erreur vérification:', error);
                Alert.alert('Erreur', 'Impossible de vérifier les conditions de notation.');
            } finally {
                setLoading(false);
            }
        }

        if (orderId) {
            checkRatingEligibility();
        }
    }, [orderId, merchantId, deliveryId]);

    /**
     * Soumet la notation du marchand.
     */
    const submitMerchantRating = useCallback(async () => {
        if (merchantScore === 0) {
            Alert.alert('Attention', 'Veuillez sélectionner un score pour le marchand.');
            return;
        }

        try {
            setSubmitting(true);
            const result = await createRating(
                orderId,
                merchantId,
                merchantScore,
                merchantComment.trim() || null
            );

            if (result.success) {
                setMerchantSubmitted(true);
                Alert.alert('Merci !', 'Votre notation du marchand a été enregistrée.');
            } else {
                Alert.alert('Erreur', result.message || 'Impossible de soumettre la notation.');
            }
        } catch (error) {
            console.error('[RatingScreen] Erreur soumission marchand:', error);
            Alert.alert('Erreur', 'Une erreur est survenue. Veuillez réessayer.');
        } finally {
            setSubmitting(false);
        }
    }, [orderId, merchantId, merchantScore, merchantComment]);

    /**
     * Soumet la notation du livreur.
     */
    const submitDeliveryRating = useCallback(async () => {
        if (deliveryScore === 0) {
            Alert.alert('Attention', 'Veuillez sélectionner un score pour le livreur.');
            return;
        }

        try {
            setSubmitting(true);
            const result = await createRating(
                orderId,
                deliveryId,
                deliveryScore,
                deliveryComment.trim() || null
            );

            if (result.success) {
                setDeliverySubmitted(true);
                Alert.alert('Merci !', 'Votre notation du livreur a été enregistrée.');
            } else {
                Alert.alert('Erreur', result.message || 'Impossible de soumettre la notation.');
            }
        } catch (error) {
            console.error('[RatingScreen] Erreur soumission livreur:', error);
            Alert.alert('Erreur', 'Une erreur est survenue. Veuillez réessayer.');
        } finally {
            setSubmitting(false);
        }
    }, [orderId, deliveryId, deliveryScore, deliveryComment]);

    /**
     * Retourne le label textuel du score.
     */
    const getScoreLabel = (score) => {
        const labels = {
            1: 'Très mauvais',
            2: 'Mauvais',
            3: 'Moyen',
            4: 'Bon',
            5: 'Excellent'
        };
        return labels[score] || '';
    };

    // Écran de chargement
    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Vérification en cours...</Text>
            </View>
        );
    }

    // Vérifier si toutes les notations sont faites
    const allDone = (merchantSubmitted || !canRateMerchant?.can_rate) &&
                    (deliverySubmitted || !canRateDelivery?.can_rate);

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
            >
                {/* Header */}
                <View style={styles.header}>
                    <Ionicons name="star" size={32} color={COLORS.star} />
                    <Text style={styles.headerTitle}>Évaluez votre commande</Text>
                    <Text style={styles.headerSubtitle}>
                        Votre avis nous aide à améliorer le service
                    </Text>
                </View>

                {/* Notation Marchand */}
                {merchantId && canRateMerchant?.can_rate && !merchantSubmitted && (
                    <View style={styles.ratingCard}>
                        <View style={styles.cardHeader}>
                            <Ionicons name="storefront-outline" size={24} color={COLORS.secondary} />
                            <Text style={styles.cardTitle}>
                                {merchantName || 'Le marchand'}
                            </Text>
                        </View>

                        <StarRating
                            rating={merchantScore}
                            onRate={setMerchantScore}
                            disabled={submitting}
                        />
                        {merchantScore > 0 && (
                            <Text style={styles.scoreLabel}>{getScoreLabel(merchantScore)}</Text>
                        )}

                        <TextInput
                            style={styles.commentInput}
                            placeholder="Laissez un commentaire (optionnel)"
                            placeholderTextColor={COLORS.textSecondary}
                            value={merchantComment}
                            onChangeText={setMerchantComment}
                            maxLength={500}
                            multiline
                            numberOfLines={3}
                            editable={!submitting}
                        />
                        <Text style={styles.charCount}>
                            {merchantComment.length}/500
                        </Text>

                        <TouchableOpacity
                            style={[styles.submitButton, merchantScore === 0 && styles.submitButtonDisabled]}
                            onPress={submitMerchantRating}
                            disabled={submitting || merchantScore === 0}
                            activeOpacity={0.8}
                        >
                            {submitting ? (
                                <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                                <Text style={styles.submitButtonText}>Envoyer la note</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}

                {/* Message si déjà noté le marchand */}
                {merchantSubmitted && (
                    <View style={styles.successCard}>
                        <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
                        <Text style={styles.successText}>Marchand noté avec succès !</Text>
                    </View>
                )}

                {/* Message si ne peut pas noter le marchand */}
                {merchantId && canRateMerchant && !canRateMerchant.can_rate && !merchantSubmitted && (
                    <View style={styles.infoCard}>
                        <Ionicons name="information-circle-outline" size={20} color={COLORS.textSecondary} />
                        <Text style={styles.infoText}>{canRateMerchant.reason}</Text>
                    </View>
                )}

                {/* Notation Livreur */}
                {deliveryId && canRateDelivery?.can_rate && !deliverySubmitted && (
                    <View style={styles.ratingCard}>
                        <View style={styles.cardHeader}>
                            <Ionicons name="bicycle-outline" size={24} color={COLORS.primary} />
                            <Text style={styles.cardTitle}>
                                {deliveryName || 'Le livreur'}
                            </Text>
                        </View>

                        <StarRating
                            rating={deliveryScore}
                            onRate={setDeliveryScore}
                            disabled={submitting}
                        />
                        {deliveryScore > 0 && (
                            <Text style={styles.scoreLabel}>{getScoreLabel(deliveryScore)}</Text>
                        )}

                        <TextInput
                            style={styles.commentInput}
                            placeholder="Laissez un commentaire (optionnel)"
                            placeholderTextColor={COLORS.textSecondary}
                            value={deliveryComment}
                            onChangeText={setDeliveryComment}
                            maxLength={500}
                            multiline
                            numberOfLines={3}
                            editable={!submitting}
                        />
                        <Text style={styles.charCount}>
                            {deliveryComment.length}/500
                        </Text>

                        <TouchableOpacity
                            style={[styles.submitButton, deliveryScore === 0 && styles.submitButtonDisabled]}
                            onPress={submitDeliveryRating}
                            disabled={submitting || deliveryScore === 0}
                            activeOpacity={0.8}
                        >
                            {submitting ? (
                                <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                                <Text style={styles.submitButtonText}>Envoyer la note</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                )}

                {/* Message si déjà noté le livreur */}
                {deliverySubmitted && (
                    <View style={styles.successCard}>
                        <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
                        <Text style={styles.successText}>Livreur noté avec succès !</Text>
                    </View>
                )}

                {/* Bouton retour si tout est fait */}
                {allDone && (
                    <TouchableOpacity
                        style={styles.doneButton}
                        onPress={() => navigation.goBack()}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.doneButtonText}>Terminé</Text>
                    </TouchableOpacity>
                )}

                {/* Bouton passer */}
                {!allDone && (
                    <TouchableOpacity
                        style={styles.skipButton}
                        onPress={() => {
                            Alert.alert(
                                'Passer la notation',
                                'Vous pourrez noter plus tard (dans les 72h après livraison).',
                                [
                                    { text: 'Annuler', style: 'cancel' },
                                    { text: 'Passer', onPress: () => navigation.goBack() }
                                ]
                            );
                        }}
                        activeOpacity={0.7}
                    >
                        <Text style={styles.skipButtonText}>Passer pour le moment</Text>
                    </TouchableOpacity>
                )}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.background
    },
    scrollView: {
        flex: 1
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: COLORS.background
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: COLORS.textSecondary
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
        paddingTop: 16
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: COLORS.text,
        marginTop: 8
    },
    headerSubtitle: {
        fontSize: 14,
        color: COLORS.textSecondary,
        marginTop: 4
    },
    ratingCard: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: COLORS.text,
        marginLeft: 10
    },
    starContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 8
    },
    star: {
        marginHorizontal: 4
    },
    scoreLabel: {
        textAlign: 'center',
        fontSize: 14,
        color: COLORS.primary,
        fontWeight: '500',
        marginBottom: 16
    },
    commentInput: {
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 8,
        padding: 12,
        fontSize: 14,
        color: COLORS.text,
        minHeight: 80,
        textAlignVertical: 'top',
        marginBottom: 4
    },
    charCount: {
        textAlign: 'right',
        fontSize: 12,
        color: COLORS.textSecondary,
        marginBottom: 16
    },
    submitButton: {
        backgroundColor: COLORS.primary,
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center'
    },
    submitButtonDisabled: {
        backgroundColor: COLORS.border
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600'
    },
    successCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#D4EDDA',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16
    },
    successText: {
        fontSize: 14,
        color: COLORS.success,
        fontWeight: '500',
        marginLeft: 8
    },
    infoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8F9FA',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: COLORS.border
    },
    infoText: {
        fontSize: 13,
        color: COLORS.textSecondary,
        marginLeft: 8,
        flex: 1
    },
    doneButton: {
        backgroundColor: COLORS.success,
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 16
    },
    doneButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600'
    },
    skipButton: {
        alignItems: 'center',
        paddingVertical: 16,
        marginTop: 8
    },
    skipButtonText: {
        color: COLORS.textSecondary,
        fontSize: 14,
        textDecorationLine: 'underline'
    }
});
