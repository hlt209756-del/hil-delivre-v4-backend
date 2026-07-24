'use strict';

/**
 * @fileoverview Service API mobile pour la certification hygiène.
 * Communique avec le backend pour gérer les certifications marchands.
 * @module mobile/services/certificationService
 */

import { apiClient } from './apiClient';

/**
 * Récupère le statut de certification du marchand connecté.
 *
 * @returns {Promise<object>} Statut de certification
 */
export async function getCertificationStatus() {
    try {
        const response = await apiClient.get('/api/merchant/certification');
        return response.data.data;
    } catch (error) {
        console.error('[CertificationService Mobile] Erreur getCertificationStatus:', error.message);
        throw error;
    }
}

/**
 * Demande une certification hygiène.
 *
 * @returns {Promise<object>} Résultat de la demande
 */
export async function requestCertification() {
    try {
        const response = await apiClient.post('/api/merchant/certify');
        return response.data;
    } catch (error) {
        console.error('[CertificationService Mobile] Erreur requestCertification:', error.message);
        throw error;
    }
}

/**
 * Renouvelle une certification expirée.
 *
 * @returns {Promise<object>} Résultat du renouvellement
 */
export async function renewCertification() {
    try {
        const response = await apiClient.post('/api/merchant/certify/renew');
        return response.data;
    } catch (error) {
        console.error('[CertificationService Mobile] Erreur renewCertification:', error.message);
        throw error;
    }
}
