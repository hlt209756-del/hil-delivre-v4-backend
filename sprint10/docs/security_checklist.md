# Checklist de Sécurité Pré-Go-Live — Hil_Delivre v4

## Vue d'ensemble

Cette checklist couvre tous les aspects de sécurité à valider avant la mise en production de Hil_Delivre v4. Chaque point doit être vérifié et validé par l'équipe technique.

---

## 1. Authentification & Autorisation

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 1.1 | JWT signé avec algorithme RS256 ou HS256 (clé ≥ 256 bits) | ☐ | |
| 1.2 | Expiration des access tokens ≤ 15 minutes | ☐ | |
| 1.3 | Refresh tokens avec rotation (single-use) | ☐ | |
| 1.4 | Invalidation des tokens à la déconnexion (blacklist) | ☐ | |
| 1.5 | RBAC vérifié sur chaque endpoint (admin, merchant, delivery, client) | ☐ | |
| 1.6 | Impossible de suspendre/supprimer un compte admin | ☐ | |
| 1.7 | 2FA obligatoire pour les comptes admin | ☐ | |
| 1.8 | Rate limiting sur login : 5 tentatives / 15 min | ☐ | |
| 1.9 | Lockout après 10 tentatives échouées (30 min) | ☐ | |
| 1.10 | Mot de passe : min 8 chars, 1 majuscule, 1 chiffre, 1 spécial | ☐ | |
| 1.11 | Mots de passe hashés avec bcrypt (cost factor ≥ 12) | ☐ | |
| 1.12 | OTP hashé SHA-256, expiration 5 min, max 3 tentatives | ☐ | |

---

## 2. Protection des données (CIL / RGPD)

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 2.1 | Anonymisation complète à la suppression de compte | ☐ | full_name → "[SUPPRIMÉ]", phone/email → null |
| 2.2 | Données de commande conservées (obligation FEC/DGI) | ☐ | |
| 2.3 | Tokens FCM désactivés à la suppression | ☐ | |
| 2.4 | Audit trail de tous les accès aux données personnelles | ☐ | Table admin_actions |
| 2.5 | Exports CSV avec anonymisation partielle (phone masqué) | ☐ | |
| 2.6 | Pas de données personnelles dans les logs | ☐ | |
| 2.7 | Chiffrement at-rest de la base de données | ☐ | |
| 2.8 | Chiffrement in-transit (TLS 1.2+) | ☐ | |
| 2.9 | Politique de rétention des données documentée | ☐ | |
| 2.10 | Consentement explicite collecté à l'inscription | ☐ | |

---

## 3. Sécurité réseau

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 3.1 | HTTPS obligatoire (redirect HTTP → HTTPS) | ☐ | |
| 3.2 | TLS 1.2 minimum (TLS 1.3 préféré) | ☐ | |
| 3.3 | HSTS activé (max-age ≥ 31536000, includeSubDomains) | ☐ | |
| 3.4 | CORS configuré avec whitelist stricte | ☐ | |
| 3.5 | Security headers (X-Content-Type-Options, X-Frame-Options, CSP) | ☐ | |
| 3.6 | Rate limiting global : 120 req/min (admin), 60 req/min (users) | ☐ | |
| 3.7 | Rate limiting spécifique : OTP (3/15min), exports (5/h) | ☐ | |
| 3.8 | WAF configuré (AWS WAF) | ☐ | |
| 3.9 | DDoS protection (AWS Shield) | ☐ | |
| 3.10 | VPC avec subnets privés pour les services backend | ☐ | |
| 3.11 | Security Groups restrictifs (principe du moindre privilège) | ☐ | |
| 3.12 | Pas de ports ouverts inutiles | ☐ | |

---

## 4. Validation des entrées

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 4.1 | Validation Joi sur tous les endpoints (body, query, params) | ☐ | |
| 4.2 | Protection contre l'injection SQL (requêtes paramétrées) | ☐ | |
| 4.3 | Protection contre les XSS (sanitization des inputs) | ☐ | |
| 4.4 | Protection contre le CSRF (tokens ou SameSite cookies) | ☐ | |
| 4.5 | Limitation de la taille des payloads (body-parser limit: 1MB) | ☐ | |
| 4.6 | Validation des UUID (format strict) | ☐ | |
| 4.7 | Validation des coordonnées GPS (ranges valides) | ☐ | |
| 4.8 | Validation des montants financiers (entiers positifs, FCFA) | ☐ | |
| 4.9 | Sanitization des noms de fichiers uploadés | ☐ | |
| 4.10 | Validation des numéros de téléphone (format burkinabè) | ☐ | |

---

## 5. Sécurité des paiements

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 5.1 | Webhook PayDunya vérifié par signature/token | ☐ | |
| 5.2 | Idempotence des webhooks (pas de double-traitement) | ☐ | |
| 5.3 | Montants vérifiés côté serveur (pas de manipulation client) | ☐ | |
| 5.4 | Pas de données de carte stockées | ☐ | |
| 5.5 | Logs de paiement sans données sensibles | ☐ | |
| 5.6 | Réconciliation automatique des transactions | ☐ | |
| 5.7 | Alertes sur les transactions suspectes (montant > seuil) | ☐ | |
| 5.8 | Conformité FEC/DGI (factures avec numérotation séquentielle) | ☐ | |

---

## 6. Sécurité de l'infrastructure

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 6.1 | Containers exécutés en utilisateur non-root | ☐ | |
| 6.2 | Images Docker scannées (Trivy/Snyk) | ☐ | |
| 6.3 | Dépendances auditées (`npm audit`) | ☐ | |
| 6.4 | Pas de secrets dans le code source | ☐ | |
| 6.5 | Secrets stockés dans AWS Parameter Store (SecureString) | ☐ | |
| 6.6 | Rotation des secrets documentée et planifiée | ☐ | |
| 6.7 | Backups automatiques (DB : quotidien, Redis : snapshot) | ☐ | |
| 6.8 | Plan de disaster recovery testé | ☐ | |
| 6.9 | Logs d'accès AWS CloudTrail activés | ☐ | |
| 6.10 | MFA activé sur tous les comptes AWS IAM | ☐ | |

---

## 7. Sécurité applicative

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 7.1 | Gestion d'erreurs sans fuite d'information (pas de stack traces) | ☐ | |
| 7.2 | Mode debug désactivé en production | ☐ | |
| 7.3 | Helmet.js configuré (security headers) | ☐ | |
| 7.4 | Graceful shutdown implémenté | ☐ | |
| 7.5 | Health checks sans information sensible | ☐ | |
| 7.6 | Endpoint /metrics protégé par token dédié | ☐ | |
| 7.7 | Pas de dépendances avec vulnérabilités critiques | ☐ | |
| 7.8 | Source maps non exposées en production | ☐ | |
| 7.9 | Variables d'environnement non loggées au démarrage | ☐ | |
| 7.10 | Circuit breakers sur les services externes | ☐ | |

---

## 8. Sécurité mobile

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 8.1 | Certificate pinning pour les appels API | ☐ | |
| 8.2 | Stockage sécurisé des tokens (SecureStore/Keychain) | ☐ | |
| 8.3 | Pas de données sensibles dans AsyncStorage | ☐ | |
| 8.4 | Obfuscation du code JavaScript (Hermes bytecode) | ☐ | |
| 8.5 | Détection de jailbreak/root | ☐ | |
| 8.6 | Pas de logs sensibles en mode release | ☐ | |
| 8.7 | Deep links validés (pas d'open redirect) | ☐ | |
| 8.8 | Permissions minimales demandées | ☐ | |

---

## 9. Anti-fraude

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 9.1 | Détection des comptes multiples (device fingerprint) | ☐ | |
| 9.2 | Vérification de la cohérence GPS (vitesse impossible) | ☐ | |
| 9.3 | Alerte si cash_balance > seuil configurable | ☐ | |
| 9.4 | Détection des patterns de commande suspects | ☐ | |
| 9.5 | Blacklist des numéros de téléphone frauduleux | ☐ | |
| 9.6 | Vérification KYC obligatoire pour marchands et livreurs | ☐ | |
| 9.7 | Limitation du nombre de commandes simultanées par client | ☐ | |

---

## 10. Tests de sécurité

| # | Contrôle | Statut | Notes |
|---|----------|--------|-------|
| 10.1 | Tests d'injection SQL automatisés | ☐ | |
| 10.2 | Tests XSS automatisés | ☐ | |
| 10.3 | Tests de fuzzing sur les endpoints critiques | ☐ | |
| 10.4 | Tests de charge (vérifier le comportement sous stress) | ☐ | |
| 10.5 | Scan de vulnérabilités (OWASP ZAP ou équivalent) | ☐ | |
| 10.6 | Revue de code sécurité par un pair | ☐ | |
| 10.7 | Pen test externe planifié (post-launch) | ☐ | |

---

## Validation finale

| Validateur | Date | Signature |
|------------|------|-----------|
| CTO / Lead Dev | | |
| Security Officer | | |
| DPO (CIL) | | |

> **Note** : Aucun déploiement en production ne doit être effectué tant que tous les contrôles critiques (sections 1-5) ne sont pas validés. Les sections 6-10 peuvent être complétées dans les 30 jours suivant le lancement.
