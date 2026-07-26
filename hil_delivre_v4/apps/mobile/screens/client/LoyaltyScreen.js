'use strict';

/**
 * @fileoverview Écran de fidélisation pour le client.
 * Affiche le solde de points, l'historique et permet la conversion en crédit.
 * @module screens/client/LoyaltyScreen
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    FlatList,
    Alert,
    ActivityIndicator,
    RefreshControl,
    Modal,
    TextInput
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPointsBalance, getPointsHistory, redeemPoints } from '../../services/loyaltyService';

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
    gold: '#FFD700'
};

/**
 * Écran principal de fidélisation.
 */
export default function LoyaltyScreen() {
    const [balance, setBalance] = useState(null);
    const [history, setHistory] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [showRedeemModal, setShowRedeemModal] = useState(false);
    const [redeemAmount, setRedeemAmount] = useState('');
    const [redeeming, setRedeeming] = useState(false);
    const [activeFilter, setActiveFilter] = useState(null); // null = tous

    /**
     * Charge le solde et l'historique initial.
     */
    const loadData = useCallback(async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const [balanceData, historyData] = await Promise.all([
                getPointsBalance(),
                getPointsHistory({ page: 1, limit: 20, type: activeFilter })
            ]);

            setBalance(balanceData);
            setHistory(historyData.transactions);
            setPagination(historyData.pagination);
        } catch (error) {
            console.error('[LoyaltyScreen] Erreur chargement:', error);
            Alert.alert('Erreur', 'Impossible de charger vos points de fidélité.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [activeFilter]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    /**
     * Charge plus d'historique (pagination infinie).
     */
    const loadMore = useCallback(async () => {
        if (loadingMore || pagination.page >= pagination.totalPages) return;

        try {
            setLoadingMore(true);
            const nextPage = pagination.page + 1;
            const historyData = await getPointsHistory({ page: nextPage, limit: 20, type: activeFilter });

            setHistory(prev => [...prev, ...historyData.transactions]);
            setPagination(historyData.pagination);
        } catch (error) {
            console.error('[LoyaltyScreen] Erreur loadMore:', error);
        } finally {
            setLoadingMore(false);
        }
    }, [loadingMore, pagination, activeFilter]);

    /**
     * Convertit des points en crédit.
     */
    const handleRedeem = useCallback(async () => {
        const points = parseInt(redeemAmount, 10);

        if (isNaN(points) || points < (balance?.min_redeem || 100)) {
            Alert.alert('Erreur', `Minimum ${balance?.min_redeem || 100} points requis.`);
            return;
        }

        if (points > (balance?.available_points || 0)) {
            Alert.alert('Erreur', 'Solde de points insuffisant.');
            return;
        }

        try {
            setRedeeming(true);
            const result = await redeemPoints(points);

            if (result.success) {
                Alert.alert(
                    'Conversion réussie !',
                    result.message || `${points} points convertis en ${points * (balance?.conversion_rate || 5)} FCFA`,
                    [{ text: 'OK', onPress: () => { setShowRedeemModal(false); loadData(); } }]
                );
                setRedeemAmount('');
            } else {
                Alert.alert('Erreur', result.message || 'Conversion impossible.');
            }
        } catch (error) {
            console.error('[LoyaltyScreen] Erreur redeem:', error);
            Alert.alert('Erreur', 'Une erreur est survenue. Veuillez réessayer.');
        } finally {
            setRedeeming(false);
        }
    }, [redeemAmount, balance, loadData]);

    /**
     * Rendu d'un item d'historique.
     */
    const renderHistoryItem = ({ item }) => {
        const isEarned = item.transaction_type === 'earned';
        const isRedeemed = item.transaction_type === 'redeemed';
        const isExpired = item.transaction_type === 'expired' || item.is_expired;

        let icon, iconColor, pointsText, pointsColor;

        if (isEarned) {
            icon = 'add-circle';
            iconColor = COLORS.success;
            pointsText = `+${item.points_earned}`;
            pointsColor = COLORS.success;
        } else if (isRedeemed) {
            icon = 'swap-horizontal';
            iconColor = COLORS.secondary;
            pointsText = `-${item.points_spent}`;
            pointsColor = COLORS.secondary;
        } else {
            icon = 'time-outline';
            iconColor = COLORS.danger;
            pointsText = `-${item.points_earned || item.points_balance}`;
            pointsColor = COLORS.danger;
        }

        return (
            <View style={styles.historyItem}>
                <View style={styles.historyIcon}>
                    <Ionicons name={icon} size={24} color={iconColor} />
                </View>
                <View style={styles.historyContent}>
                    <Text style={styles.historyDescription} numberOfLines={1}>
                        {item.description}
                    </Text>
                    <Text style={styles.historyDate}>
                        {new Date(item.created_at).toLocaleDateString('fr-FR', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                        })}
                    </Text>
                    {isEarned && !item.is_expired && item.expires_at && (
                        <Text style={styles.historyExpiry}>
                            Expire le {new Date(item.expires_at).toLocaleDateString('fr-FR')}
                        </Text>
                    )}
                </View>
                <Text style={[styles.historyPoints, { color: pointsColor }]}>
                    {pointsText} pts
                </Text>
            </View>
        );
    };

    // Écran de chargement
    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loadingText}>Chargement de vos points...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Carte de solde */}
            <View style={styles.balanceCard}>
                <View style={styles.balanceHeader}>
                    <Ionicons name="gift" size={28} color={COLORS.gold} />
                    <Text style={styles.balanceTitle}>Mes Points Fidélité</Text>
                </View>

                <Text style={styles.balancePoints}>
                    {balance?.available_points || 0}
                </Text>
                <Text style={styles.balanceLabel}>points disponibles</Text>

                <View style={styles.balanceInfo}>
                    <View style={styles.balanceInfoItem}>
                        <Text style={styles.balanceInfoValue}>
                            {balance?.value_fcfa || 0} FCFA
                        </Text>
                        <Text style={styles.balanceInfoLabel}>Valeur</Text>
                    </View>
                    <View style={styles.balanceDivider} />
                    <View style={styles.balanceInfoItem}>
                        <Text style={[styles.balanceInfoValue, balance?.expiring_soon > 0 && { color: COLORS.warning }]}>
                            {balance?.expiring_soon || 0}
                        </Text>
                        <Text style={styles.balanceInfoLabel}>Expirent bientôt</Text>
                    </View>
                </View>

                {/* Bouton convertir */}
                <TouchableOpacity
                    style={[styles.redeemButton, !balance?.can_redeem && styles.redeemButtonDisabled]}
                    onPress={() => setShowRedeemModal(true)}
                    disabled={!balance?.can_redeem}
                    activeOpacity={0.8}
                >
                    <Ionicons name="swap-horizontal" size={20} color="#FFF" />
                    <Text style={styles.redeemButtonText}>
                        Convertir en crédit
                    </Text>
                </TouchableOpacity>

                {!balance?.can_redeem && (
                    <Text style={styles.redeemHint}>
                        Minimum {balance?.min_redeem || 100} points pour convertir
                    </Text>
                )}
            </View>

            {/* Filtres */}
            <View style={styles.filterContainer}>
                {[
                    { key: null, label: 'Tous' },
                    { key: 'earned', label: 'Gagnés' },
                    { key: 'redeemed', label: 'Convertis' },
                    { key: 'expired', label: 'Expirés' }
                ].map(filter => (
                    <TouchableOpacity
                        key={filter.key || 'all'}
                        style={[styles.filterChip, activeFilter === filter.key && styles.filterChipActive]}
                        onPress={() => setActiveFilter(filter.key)}
                    >
                        <Text style={[styles.filterChipText, activeFilter === filter.key && styles.filterChipTextActive]}>
                            {filter.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Historique */}
            <FlatList
                data={history}
                renderItem={renderHistoryItem}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.historyList}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={() => loadData(true)}
                        colors={[COLORS.primary]}
                    />
                }
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
                ListFooterComponent={loadingMore ? (
                    <ActivityIndicator size="small" color={COLORS.primary} style={{ padding: 16 }} />
                ) : null}
                ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                        <Ionicons name="gift-outline" size={48} color={COLORS.textSecondary} />
                        <Text style={styles.emptyText}>Aucune transaction</Text>
                        <Text style={styles.emptySubtext}>
                            Commandez pour gagner des points !
                        </Text>
                    </View>
                }
            />

            {/* Modal de conversion */}
            <Modal
                visible={showRedeemModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowRedeemModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>Convertir mes points</Text>
                        <Text style={styles.modalSubtitle}>
                            {balance?.conversion_rate || 5} FCFA par point
                        </Text>

                        <TextInput
                            style={styles.modalInput}
                            placeholder={`Minimum ${balance?.min_redeem || 100} points`}
                            placeholderTextColor={COLORS.textSecondary}
                            value={redeemAmount}
                            onChangeText={setRedeemAmount}
                            keyboardType="number-pad"
                            maxLength={6}
                        />

                        {redeemAmount && parseInt(redeemAmount, 10) > 0 && (
                            <Text style={styles.modalPreview}>
                                = {parseInt(redeemAmount, 10) * (balance?.conversion_rate || 5)} FCFA de crédit
                            </Text>
                        )}

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={styles.modalCancelButton}
                                onPress={() => { setShowRedeemModal(false); setRedeemAmount(''); }}
                            >
                                <Text style={styles.modalCancelText}>Annuler</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.modalConfirmButton}
                                onPress={handleRedeem}
                                disabled={redeeming}
                            >
                                {redeeming ? (
                                    <ActivityIndicator size="small" color="#FFF" />
                                ) : (
                                    <Text style={styles.modalConfirmText}>Convertir</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
    loadingText: { marginTop: 12, fontSize: 16, color: COLORS.textSecondary },
    balanceCard: {
        backgroundColor: COLORS.secondary,
        margin: 16,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5
    },
    balanceHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    balanceTitle: { fontSize: 16, color: '#FFFFFF', fontWeight: '600', marginLeft: 8 },
    balancePoints: { fontSize: 48, fontWeight: '800', color: COLORS.gold },
    balanceLabel: { fontSize: 14, color: '#FFFFFFCC', marginBottom: 16 },
    balanceInfo: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    balanceInfoItem: { alignItems: 'center', flex: 1 },
    balanceInfoValue: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
    balanceInfoLabel: { fontSize: 12, color: '#FFFFFFAA', marginTop: 2 },
    balanceDivider: { width: 1, height: 30, backgroundColor: '#FFFFFF44' },
    redeemButton: {
        flexDirection: 'row',
        backgroundColor: COLORS.primary,
        borderRadius: 8,
        paddingVertical: 12,
        paddingHorizontal: 24,
        alignItems: 'center'
    },
    redeemButtonDisabled: { backgroundColor: '#FFFFFF33' },
    redeemButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginLeft: 8 },
    redeemHint: { fontSize: 11, color: '#FFFFFF88', marginTop: 8 },
    filterContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8 },
    filterChip: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: COLORS.card,
        marginRight: 8,
        borderWidth: 1,
        borderColor: COLORS.border
    },
    filterChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    filterChipText: { fontSize: 13, color: COLORS.textSecondary },
    filterChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
    historyList: { paddingHorizontal: 16, paddingBottom: 24 },
    historyItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.card,
        borderRadius: 10,
        padding: 14,
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1
    },
    historyIcon: { marginRight: 12 },
    historyContent: { flex: 1 },
    historyDescription: { fontSize: 14, color: COLORS.text, fontWeight: '500' },
    historyDate: { fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
    historyExpiry: { fontSize: 11, color: COLORS.warning, marginTop: 2 },
    historyPoints: { fontSize: 15, fontWeight: '700' },
    emptyContainer: { alignItems: 'center', paddingTop: 40 },
    emptyText: { fontSize: 16, color: COLORS.textSecondary, marginTop: 12 },
    emptySubtext: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: {
        backgroundColor: COLORS.card,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 24,
        paddingBottom: 40
    },
    modalTitle: { fontSize: 20, fontWeight: '700', color: COLORS.text, textAlign: 'center' },
    modalSubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', marginTop: 4, marginBottom: 20 },
    modalInput: {
        borderWidth: 1,
        borderColor: COLORS.border,
        borderRadius: 8,
        padding: 14,
        fontSize: 18,
        textAlign: 'center',
        color: COLORS.text
    },
    modalPreview: { fontSize: 16, color: COLORS.success, fontWeight: '600', textAlign: 'center', marginTop: 12 },
    modalButtons: { flexDirection: 'row', marginTop: 24 },
    modalCancelButton: { flex: 1, paddingVertical: 14, alignItems: 'center', marginRight: 8 },
    modalCancelText: { fontSize: 16, color: COLORS.textSecondary },
    modalConfirmButton: {
        flex: 1,
        backgroundColor: COLORS.primary,
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: 'center',
        marginLeft: 8
    },
    modalConfirmText: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' }
});
