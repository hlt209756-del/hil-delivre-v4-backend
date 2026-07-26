'use strict';

/**
 * @fileoverview Écran de certification hygiène pour le marchand.
 * Affiche le statut de certification et permet de demander/renouveler.
 * @module screens/merchant/CertificationScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Alert,
    ActivityIndicator,
    RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
    getCertificationStatus,
    requestCertification,
    renewCertification
} from '../../services/certificationService';

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
    certified: '#28A745',
    pending: '#FFC107',
    expired: '#DC3545',
    revoked: '#6C757D'
};

/**
 * Retourne la couleur et l'icône selon le statut.
 */
function getStatusConfig(status) {
    const configs = {
        none: { color: COLORS.textSecondary, icon: 'shield-outline', label: 'Non certifié' },
        pending: { color: COLORS.pending, icon: 'time-outline', label: 'En attente' },
        certified: { color: COLORS.certified, icon: 'shield-checkmark', label: 'Certifié' },
        expired: { color: COLORS.expired, icon: 'alert-circle-outline', label: 'Expiré' },
        revoked: { color: COLORS.revoked, icon: 'close-circle-outline', label: 'Révoqué' }
    };
    return configs[status] || configs.none;
}

/**
 * Écran principal de certification hygiène.
 */
export default function CertificationScreen() {
    const [certData, setCertData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    /**
     * Charge le statut de certification.
     */
    const loadStatus = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const data = await getCertificationStatus();
            setCertData(data);
        } catch (error) {
            console.error('[CertificationScreen] Erreur chargement:', error);
            Alert.alert('Erreur', 'Impossible de charger le statut de certification.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    /**
     * Demande une nouvelle certification.
     */
    const handleRequest = useCallback(async () => {
        Alert.alert(
            'Demander la certification',
            `Frais de certification : ${certData?.fee || 5000} FCFA/an.\nLe montant sera débité de votre portefeuille.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Confirmer',
                    onPress: async () => {
                        try {
                            setSubmitting(true);
                            const result = await requestCertification();

                            if (result.success) {
                                Alert.alert('Succès', result.message || 'Demande de certification soumise !');
                                loadStatus();
                            } else {
                                Alert.alert('Erreur', result.message || 'Impossible de soumettre la demande.');
                            }
                        } catch (error) {
                            console.error('[CertificationScreen] Erreur demande:', error);
                            const errorMsg = error.response?.data?.message || 'Une erreur est survenue.';
                            Alert.alert('Erreur', errorMsg);
                        } finally {
                            setSubmitting(false);
                        }
                    }
                }
            ]
        );
    }, [certData, loadStatus]);

    /**
     * Renouvelle la certification.
     */
    const handleRenew = useCallback(async () => {
        Alert.alert(
            'Renouveler la certification',
            `Frais de renouvellement : ${certData?.fee || 5000} FCFA/an.\nLe montant sera débité de votre portefeuille.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Renouveler',
                    onPress: async () => {
                        try {
                            setSubmitting(true);
                            const result = await renewCertification();

                            if (result.success) {
                                Alert.alert('Succès', 'Demande de renouvellement soumise !');
                                loadStatus();
                            } else {
                                Alert.alert('Erreur', result.message || 'Impossible de renouveler.');
                            }
                        } catch (error) {
                            console.error('[CertificationScreen] Erreur renouvellement:', error);
                            const errorMsg = error.response?.data?.message || 'Une erreur est survenue.';
                            Alert.alert('Erreur', errorMsg);
                        } finally {
                            setSubmitting(false);
                        }
                    }
                }
            ]
        );
    }, [certData, loadStatus]);

    // Écran de chargement
    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Chargement...</Text>
            </View>
        );
    }

    const statusConfig = getStatusConfig(certData?.status || 'none');

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
                <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => loadStatus(true)}
                    colors={[COLORS.primary]}
                />
            }
        >
            {/* En-tête avec badge */}
            <View style={styles.header}>
                <View style={[styles.badgeCircle, { borderColor: statusConfig.color }]}>
                    <Ionicons name={statusConfig.icon} size={48} color={statusConfig.color} />
                </View>
                <Text style={styles.headerTitle}>Certification Hygiène</Text>
                <Text style={styles.headerSubtitle}>Hil_Delivre Qualité</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusConfig.color + '20' }]}>
                    <Text style={[styles.statusText, { color: statusConfig.color }]}>
                        {statusConfig.label}
                    </Text>
                </View>
            </View>

            {/* Détails de la certification */}
            {certData?.status !== 'none' && (
                <View style={styles.detailsCard}>
                    <Text style={styles.cardTitle}>Détails</Text>

                    {certData?.certification_date && (
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Date de certification</Text>
                            <Text style={styles.detailValue}>
                                {new Date(certData.certification_date).toLocaleDateString('fr-FR', {
                                    day: 'numeric', month: 'long', year: 'numeric'
                                })}
                            </Text>
                        </View>
                    )}

                    {certData?.expiration_date && (
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Date d'expiration</Text>
                            <Text style={[styles.detailValue, certData?.days_remaining < 30 && { color: COLORS.warning }]}>
                                {new Date(certData.expiration_date).toLocaleDateString('fr-FR', {
                                    day: 'numeric', month: 'long', year: 'numeric'
                                })}
                            </Text>
                        </View>
                    )}

                    {certData?.days_remaining !== null && certData?.days_remaining !== undefined && (
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Jours restants</Text>
                            <Text style={[
                                styles.detailValue,
                                styles.detailValueBold,
                                certData.days_remaining < 30 ? { color: COLORS.warning } : { color: COLORS.success }
                            ]}>
                                {certData.days_remaining} jours
                            </Text>
                        </View>
                    )}

                    {certData?.fee_amount && (
                        <View style={styles.detailRow}>
                            <Text style={styles.detailLabel}>Frais payés</Text>
                            <Text style={styles.detailValue}>{certData.fee_amount} FCFA</Text>
                        </View>
                    )}
                </View>
            )}

            {/* Avantages */}
            <View style={styles.benefitsCard}>
                <Text style={styles.cardTitle}>Avantages de la certification</Text>

                {[
                    { icon: 'shield-checkmark', text: 'Badge "Qualité" visible par les clients' },
                    { icon: 'trending-up', text: 'Meilleur référencement dans les résultats' },
                    { icon: 'people', text: 'Confiance accrue des clients' },
                    { icon: 'star', text: 'Éligibilité aux promotions sponsorisées' }
                ].map((benefit, index) => (
                    <View key={index} style={styles.benefitRow}>
                        <Ionicons name={benefit.icon} size={20} color={COLORS.success} />
                        <Text style={styles.benefitText}>{benefit.text}</Text>
                    </View>
                ))}

                <View style={styles.priceTag}>
                    <Text style={styles.priceText}>{certData?.fee || 5000} FCFA / an</Text>
                </View>
            </View>

            {/* Actions */}
            <View style={styles.actionsContainer}>
                {/* Demande initiale */}
                {(certData?.status === 'none' || certData?.status === undefined) && (
                    <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={handleRequest}
                        disabled={submitting}
                        activeOpacity={0.8}
                    >
                        {submitting ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="shield-checkmark" size={20} color="#FFF" />
                                <Text style={styles.primaryButtonText}>Demander la certification</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )}

                {/* Renouvellement */}
                {certData?.can_renew && (
                    <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={handleRenew}
                        disabled={submitting}
                        activeOpacity={0.8}
                    >
                        {submitting ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="refresh" size={20} color="#FFF" />
                                <Text style={styles.primaryButtonText}>Renouveler la certification</Text>
                            </>
                        )}
                    </TouchableOpacity>
                )}

                {/* En attente */}
                {certData?.status === 'pending' && (
                    <View style={styles.pendingInfo}>
                        <Ionicons name="hourglass-outline" size={24} color={COLORS.pending} />
                        <Text style={styles.pendingText}>
                            Votre demande est en cours d'examen par notre équipe.{'\n'}
                            Vous serez notifié dès l'approbation.
                        </Text>
                    </View>
                )}

                {/* Certification active - alerte expiration */}
                {certData?.is_certified && certData?.days_remaining < 30 && (
                    <View style={styles.warningInfo}>
                        <Ionicons name="warning-outline" size={24} color={COLORS.warning} />
                        <Text style={styles.warningText}>
                            Votre certification expire dans {certData.days_remaining} jours.{'\n'}
                            Pensez à renouveler pour maintenir votre badge.
                        </Text>
                    </View>
                )}
            </View>
        </ScrollView>
    );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    scrollContent: { padding: 16, paddingBottom: 40 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
    loadingText: { marginTop: 12, fontSize: 16, color: COLORS.textSecondary },
    header: { alignItems: 'center', paddingVertical: 24 },
    badgeCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        borderWidth: 3,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: COLORS.card
    },
    headerTitle: { fontSize: 22, fontWeight: '700', color: COLORS.text, marginTop: 16 },
    headerSubtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
    statusBadge: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, marginTop: 12 },
    statusText: { fontSize: 14, fontWeight: '600' },
    detailsCard: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2
    },
    cardTitle: { fontSize: 16, fontWeight: '700', color: COLORS.text, marginBottom: 16 },
    detailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border
    },
    detailLabel: { fontSize: 14, color: COLORS.textSecondary },
    detailValue: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
    detailValueBold: { fontWeight: '700' },
    benefitsCard: {
        backgroundColor: COLORS.card,
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 2
    },
    benefitRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    benefitText: { fontSize: 14, color: COLORS.text, marginLeft: 12, flex: 1 },
    priceTag: {
        backgroundColor: COLORS.primary + '15',
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 16,
        alignItems: 'center',
        marginTop: 8
    },
    priceText: { fontSize: 18, fontWeight: '700', color: COLORS.primary },
    actionsContainer: { marginTop: 8 },
    primaryButton: {
        flexDirection: 'row',
        backgroundColor: COLORS.primary,
        borderRadius: 10,
        paddingVertical: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4
    },
    primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginLeft: 8 },
    pendingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.pending + '20',
        borderRadius: 10,
        padding: 16
    },
    pendingText: { fontSize: 13, color: COLORS.text, marginLeft: 12, flex: 1, lineHeight: 20 },
    warningInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.warning + '20',
        borderRadius: 10,
        padding: 16,
        marginTop: 12
    },
    warningText: { fontSize: 13, color: COLORS.text, marginLeft: 12, flex: 1, lineHeight: 20 }
});
