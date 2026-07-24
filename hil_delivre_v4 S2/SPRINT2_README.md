# Hil_Delivre v4 — Sprint 2 : Authentification, KYC, Profils, Conformité CIL

## Vue d'ensemble

Le Sprint 2 implémente le système complet d'authentification, la gestion des profils utilisateurs, le processus KYC (Know Your Customer) pour les marchands et livreurs, et la conformité CIL (Commission de l'Informatique et des Libertés du Burkina Faso).

## Architecture implémentée

```
backend/
├── src/
│   ├── server.js                    # Point d'entrée + graceful shutdown
│   ├── app.js                       # Configuration Express + middlewares + routes
│   ├── config/
│   │   └── index.js                 # Validation des variables d'environnement
│   ├── services/
│   │   ├── supabaseService.js       # Client Supabase (admin + client)
│   │   ├── auditService.js          # Journal d'audit (conformité CIL)
│   │   └── consentService.js        # Gestion des consentements CIL
│   ├── middlewares/
│   │   ├── authMiddleware.js        # Vérification JWT + chargement profil
│   │   ├── roleMiddleware.js        # RBAC + gating KYC + abonnement
│   │   └── validationMiddleware.js  # Schémas Joi + middleware validate()
│   ├── controllers/
│   │   ├── authController.js        # Register, Login, Logout, Refresh, Reset
│   │   ├── profileController.js     # Get, Update, Delete (droit CIL)
│   │   └── kycController.js         # Submit, Status, Review, List pending
│   ├── routes/
│   │   ├── authRoutes.js            # /api/auth/* (+ rate limiters spécifiques)
│   │   ├── profileRoutes.js         # /api/user/profile
│   │   ├── kycRoutes.js             # /api/user/kyc
│   │   └── adminRoutes.js           # /api/admin/kyc/*
│   ├── utils/
│   │   └── responseHelper.js        # Réponses API standardisées
│   └── __tests__/
│       ├── auth.test.js             # Tests d'intégration auth
│       ├── middlewares.test.js      # Tests unitaires middlewares
│       └── kyc.test.js              # Tests d'intégration KYC
├── .env.example                     # Template variables d'environnement
└── package.json                     # Dépendances Sprint 2

database/
└── schema_sprint2.sql               # Migration SQL additive Sprint 2

apps/mobile/
├── config/
│   └── api.js                       # Configuration URL API
├── contexts/
│   └── AuthContext.js               # Context React + SecureStore
└── services/
    ├── authService.js               # Appels API auth
    └── profileService.js            # Appels API profil + KYC
```

## Endpoints API

### Authentification (`/api/auth`)

| Méthode | Endpoint | Auth | Rate Limit | Description |
|---------|----------|------|------------|-------------|
| POST | `/api/auth/register` | Non | 20/15min | Inscription |
| POST | `/api/auth/login` | Non | 5/15min (échecs) | Connexion |
| POST | `/api/auth/logout` | Oui | Global | Déconnexion |
| POST | `/api/auth/refresh` | Non | 20/15min | Rafraîchir le token |
| POST | `/api/auth/forgot-password` | Non | 3/1h | Demande reset |
| POST | `/api/auth/reset-password` | Non | 3/1h | Réinitialiser MDP |

### Profil (`/api/user`)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/user/profile` | Oui | Récupérer son profil |
| PUT | `/api/user/profile` | Oui | Mettre à jour son profil |
| DELETE | `/api/user/profile` | Oui | Supprimer son compte (CIL) |

### KYC (`/api/user/kyc`)

| Méthode | Endpoint | Auth | Rôle | Description |
|---------|----------|------|------|-------------|
| POST | `/api/user/kyc` | Oui | client | Soumettre demande KYC |
| GET | `/api/user/kyc/status` | Oui | * | Statut KYC |

### Administration (`/api/admin`)

| Méthode | Endpoint | Auth | Rôle | Description |
|---------|----------|------|------|-------------|
| GET | `/api/admin/kyc/pending` | Oui | admin | Lister demandes en attente |
| PUT | `/api/admin/kyc/:userId/review` | Oui | admin | Approuver/Rejeter KYC |

## Sécurité implémentée

### Couche Transport
- **Helmet** : CSP stricte, HSTS, X-Frame-Options, X-Content-Type-Options
- **CORS** : Whitelist d'origines, credentials, preflight cache 24h
- **Body parser** : Limite 10kb (anti-payload bombing)

### Authentification
- **JWT Supabase** : Vérification côté serveur via `supabaseAdmin.auth.getUser()`
- **Tokens** : Access token (1h) + Refresh token (rotation automatique)
- **Mot de passe** : Min 8 chars, 1 majuscule, 1 minuscule, 1 chiffre, 1 spécial, max 72 (bcrypt limit)
- **Stockage mobile** : `expo-secure-store` (Keychain iOS / Keystore Android)

### Rate Limiting
- **Global** : 100 requêtes / 15 min / IP
- **Auth** : 20 requêtes / 15 min / IP+email
- **Login** : 5 échecs / 15 min / IP (skipSuccessfulRequests)
- **Password Reset** : 3 requêtes / 1h / IP

### RBAC & Gating
- **requireRole()** : Vérifie le rôle (client, merchant, delivery, admin)
- **requireKYC()** : Vérifie que le KYC est approuvé (marchands/livreurs)
- **requireSubscription()** : Vérifie l'abonnement actif et non expiré

### Anti-élévation de privilège
- Le rôle n'est JAMAIS lu depuis `raw_user_meta_data` (FIX-2 schéma)
- `stripUnknown: true` sur tous les schémas Joi
- Double protection : suppression des champs protégés côté contrôleur

### Conformité CIL
- **Consentement explicite** : Enregistré avec horodatage, IP, version
- **Droit à l'effacement** : Anonymisation complète + ban auth
- **Droit d'opposition** : Révocation de consentement
- **Journal d'audit** : Toutes les actions critiques tracées

## Migration SQL Sprint 2

Le fichier `database/schema_sprint2.sql` ajoute 3 tables :

1. **user_consents** : Registre des consentements CIL
2. **kyc_requests** : Historique des demandes KYC
3. **audit_logs** : Journal d'audit des actions critiques

Toutes les tables ont RLS activé avec des policies appropriées.

## Installation et démarrage

```bash
# 1. Installer les dépendances
cd backend
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Remplir les valeurs dans .env

# 3. Exécuter la migration SQL Sprint 2
# Copier le contenu de database/schema_sprint2.sql
# dans le SQL Editor de Supabase et exécuter

# 4. Démarrer le serveur
npm run dev

# 5. Lancer les tests
npm test
```

## Tests

```bash
# Tous les tests avec couverture
npm test

# Tests en mode watch
npm run test:watch

# Tests CI (sans interaction)
npm run test:ci
```

## Variables d'environnement requises

| Variable | Description | Exemple |
|----------|-------------|---------|
| `SUPABASE_URL` | URL du projet Supabase | `https://xxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Clé publique Supabase | `eyJ...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service (JAMAIS côté client) | `eyJ...` |
| `CORS_ORIGINS` | Origines autorisées | `http://localhost:3000` |
| `NODE_ENV` | Environnement | `development` |

## Points d'attention Sprint 3

1. **Phone uniqueness** : Décision à prendre sur l'unicité du numéro de téléphone
2. **Commission marchand** : Clarifier 5% vs 10% (incohérence plan section 9.5)
3. **OTP SMS** : Prévu Sprint 6 (Africa's Talking) — actuellement email_confirm=true
4. **Upload documents KYC** : Nécessite Supabase Storage (à configurer)
