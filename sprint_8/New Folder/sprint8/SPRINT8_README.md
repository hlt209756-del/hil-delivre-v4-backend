# Hil_Delivre v4 — Sprint 8 : Système d'Abonnements et Paiement Récurrent

## Vue d'ensemble

Le Sprint 8 implémente le système complet de gestion des abonnements pour les marchands et les livreurs, incluant les périodes d'essai gratuites, le paiement récurrent via PayDunya, le gating d'accès aux fonctionnalités, et les notifications d'expiration. Ce sprint assure la monétisation de la plateforme et le contrôle d'accès basé sur l'état de l'abonnement.

## Règles Métier Implémentées (selon cahier des charges v2)

1.  **Montants d'abonnement** :
    *   Marchand : 6 000 F CFA/mois.
    *   Livreur : 3 000 F CFA/mois.
2.  **Période d'essai gratuite** : À l'inscription, `subscription_expires_at` est défini à `date_inscription + 30 jours`. Aucun prélèvement n'est effectué pendant cette période.
3.  **Gating d'accès** : Si `subscription_expires_at < NOW()`, les marchands/livreurs sont bloqués sur un écran de paiement obligatoire. Aucune fonctionnalité n'est accessible tant que le paiement n'est pas validé. Ce gating ne s'applique pas aux clients ni à l'administrateur.
4.  **Crédit du portefeuille Admin** : Les montants des réabonnements sont crédités sur le portefeuille virtuel de l'administrateur (pas versés directement sur son compte Mobile Money).
5.  **Transfert Admin** : Le transfert réel des fonds du portefeuille virtuel de l'admin vers son compte Mobile Money se fait tous les 3 jours via le Cron Job de Mass Payout PayDunya, de la même manière que pour les marchands et livreurs.
6.  **Notifications** : Envoi de notifications d'expiration imminente (7 jours avant, 3 jours avant, jour J) et de renouvellement réussi, ainsi que de compte bloqué (via `notificationService` du Sprint 6).

## Architecture Implémentée

```
backend/
├── src/
│   ├── config/
│   │   └── supabase.js              # Client Supabase (admin + client)
│   ├── services/
│   │   ├── subscriptionService.js   # Nouveau service de gestion des abonnements
│   │   ├── notificationService.js   # Réutilisé du Sprint 6
│   │   ├── paymentService.js        # Réutilisé du Sprint 4
│   │   └── auditService.js          # Réutilisé du Sprint 2
│   ├── middlewares/
│   │   ├── authMiddleware.js        # Réutilisé du Sprint 2
│   │   ├── roleMiddleware.js        # Réutilisé du Sprint 2
│   │   └── subscriptionGate.js      # Nouveau middleware de gating
│   ├── controllers/
│   │   └── subscriptionController.js# Nouveau contrôleur d'abonnements
│   ├── routes/
│   │   └── subscriptionRoutes.js    # Nouvelles routes d'API pour les abonnements
│   ├── jobs/
│   │   └── subscriptionCron.js      # Nouveaux cron jobs pour les abonnements
│   └── utils/
│       └── responseHelper.js        # Réutilisé pour les réponses API standardisées
│   └── __tests__/
│       └── subscription.test.js     # Nouveaux tests d'intégration
├── .env.example                     # Variables d'environnement mises à jour
└── package.json                     # Dépendances mises à jour (dayjs, joi)

database/
└── schema_sprint8.sql               # Migration SQL additive Sprint 8

apps/mobile/
├── screens/
│   └── common/
│       ├── SubscriptionScreen.js    # Nouvel écran de gestion d'abonnement
│       └── SubscriptionBlockedScreen.js # Nouvel écran de blocage (gating)
├── services/
│   └── subscriptionService.js       # Nouveau service API mobile pour les abonnements
└── contexts/
    └── AuthContext.js               # Mise à jour pour gérer le statut d'abonnement

docs/
└── API_SPRINT8.md                   # Documentation API du sprint
```

## Fichiers Clés et Fonctionnalités

### `database/schema_sprint8.sql`

*   **Tables** :
    *   `subscription_plans` : Définit les plans d'abonnement (marchand, livreur) avec leurs montants, durées, et périodes d'essai.
    *   `subscriptions` : Enregistre les abonnements de chaque utilisateur, incluant le statut, les dates de début/fin, le statut d'essai, et la référence de transaction.
*   **Modifications `profiles_data`** : Ajout de `subscription_status` et mise à jour de `subscription_expires_at`.
*   **Triggers** : `update_profile_subscription_status_trigger` pour synchroniser `profiles_data` avec les changements dans `subscriptions`.
*   **RLS Policies** : Politiques de sécurité pour `subscription_plans` et `subscriptions`.
*   **Seeds** : Insertion des plans `merchant_monthly` (6000 F CFA/30j) et `delivery_monthly` (3000 F CFA/30j) avec 30 jours d'essai.
*   **Fonction PL/pgSQL** : `check_expired_subscriptions()` pour la mise à jour des statuts d'abonnement expirés par le cron.

### `backend/src/services/subscriptionService.js`

*   `createTrialSubscription(userId, planType)` : Crée un abonnement d'essai de 30 jours à l'inscription.
*   `initiateRenewal(userId)` : Lance le processus de paiement via PayDunya, retourne l'URL de paiement.
*   `handleRenewalPayment(paymentTransaction)` : Gère le webhook de PayDunya, crédite le portefeuille de l'admin, prolonge l'abonnement, et envoie une notification.
*   `checkExpiration(userId)` : Vérifie si l'abonnement est expiré.
*   `getSubscriptionStatus(userId)` : Récupère le statut détaillé de l'abonnement.
*   `getSubscriptionHistory(userId)` : Récupère l'historique des abonnements.
*   `getExpiredSubscriptions()` : (Admin) Liste les abonnements expirés.
*   `getSubscriptionStats()` : (Admin) Fournit des statistiques sur les abonnements.
*   `processExpirationNotifications()` : Envoie les notifications J-7, J-3, J-0.

### `backend/src/controllers/subscriptionController.js`

*   `getStatus` : Endpoint pour récupérer le statut d'abonnement.
*   `initRenewal` : Endpoint pour initier le renouvellement.
*   `getHistory` : Endpoint pour l'historique des abonnements.
*   `adminGetExpired` : (Admin) Endpoint pour les abonnements expirés.
*   `adminGetStats` : (Admin) Endpoint pour les statistiques.

### `backend/src/routes/subscriptionRoutes.js`

*   Définit les routes `/api/subscription/status`, `/api/subscription/renew`, `/api/subscription/history`.
*   Définit les routes admin `/api/admin/subscriptions/expired`, `/api/admin/subscriptions/stats`.
*   Intègre `authMiddleware`, `roleMiddleware`, et `rateLimiter`.

### `backend/src/middlewares/subscriptionGate.js`

*   Middleware Express qui vérifie l'expiration de l'abonnement pour les rôles `merchant` et `delivery`.
*   Si expiré, retourne un statut 403 avec un payload spécifique (`{ blocked: true, reason: 'subscription_expired', renewal_url: '...' }`).
*   Exclut les rôles `client` et `admin`.
*   Permet l'accès aux routes de renouvellement (`/api/subscription/renew`, `/api/subscription/status`) même si l'abonnement est expiré.

### `backend/src/jobs/subscriptionCron.js`

*   `checkExpiringSubscriptions()` : Exécuté quotidiennement (minuit), appelle `processExpirationNotifications`.
*   `blockExpiredAccounts()` : Exécuté toutes les heures, appelle la fonction PL/pgSQL `check_expired_subscriptions()` pour mettre à jour les statuts dans la base de données.

### `backend/src/__tests__/subscription.test.js`

*   Tests d'intégration complets pour `subscriptionService`, `subscriptionController` et `subscriptionGate`.
*   Couvre la création d'essai, le renouvellement, la gestion des paiements, la vérification d'expiration, les notifications et le comportement du gating.

### `apps/mobile/screens/common/SubscriptionScreen.js`

*   Affiche le statut actuel de l'abonnement (actif, essai, expiré).
*   Affiche la date d'expiration et le plan.
*   Bouton de renouvellement qui redirige vers PayDunya.
*   Affiche l'historique des paiements d'abonnement.

### `apps/mobile/screens/common/SubscriptionBlockedScreen.js`

*   Écran de blocage avec un design rouge DoorDash.
*   Message clair indiquant l'expiration de l'abonnement.
*   Affiche le montant à payer et un bouton pour payer via Mobile Money.
*   Empêche la navigation vers d'autres écrans et propose une option de déconnexion.

### `apps/mobile/services/subscriptionService.js`

*   Service API pour l'application mobile, permettant d'interagir avec les endpoints du backend pour les abonnements.

## Installation et Démarrage

### 1. Mise à jour des dépendances Backend

Naviguez vers le dossier `backend` et installez les nouvelles dépendances :

```bash
cd backend
npm install dayjs joi node-cron
```

### 2. Exécution de la Migration SQL Sprint 8

1.  Copiez le contenu du fichier `database/schema_sprint8.sql`.
2.  Collez-le dans l'éditeur SQL de votre projet Supabase et exécutez-le.
    *   Cela créera les nouvelles tables, mettra à jour `profiles_data`, ajoutera les triggers, les politiques RLS et insérera les plans d'abonnement par défaut.

### 3. Mise à jour des Variables d'Environnement

Ajoutez les variables suivantes à votre fichier `.env` dans le dossier `backend` (et `.env.example`) :

```dotenv
# PayDunya Configuration (Assurez-vous que ces clés sont déjà présentes et correctes)
PAYDUNYA_MASTER_KEY="VOTRE_CLE_MASTER_PAYDUNYA"
PAYDUNYA_PRIVATE_KEY="VOTRE_CLE_PRIVEE_PAYDUNYA"
PAYDUNYA_TOKEN="VOTRE_TOKEN_PAYDUNYA"
PAYDUNYA_MODE="test" # ou "live"
PAYDUNYA_WEBHOOK_SECRET="VOTRE_SECRET_WEBHOOK_PAYDUNYA"

# ID de l'utilisateur administrateur pour le crédit des abonnements
ADMIN_USER_ID="VOTRE_UUID_ADMIN_SUPABASE" # L'ID de l'utilisateur avec le rôle 'admin'
```

### 4. Démarrage du Serveur Backend

Assurez-vous que les services `notificationService`, `paymentService`, `auditService` et `responseHelper` sont correctement implémentés et accessibles. Ensuite, démarrez le serveur :

```bash
cd backend
npm run dev
```

### 5. Mise à jour des dépendances Mobile

Naviguez vers le dossier `apps/mobile` et installez les nouvelles dépendances :

```bash
cd apps/mobile
npm install dayjs
```

### 6. Intégration du Gating dans l'Application Mobile

Le `subscriptionGate.js` côté backend renverra un payload spécifique en cas d'abonnement expiré. Votre application mobile devra intercepter cette réponse (code 403 avec `blocked: true`) et rediriger l'utilisateur vers `SubscriptionBlockedScreen.js`.

Exemple d'intégration dans votre `AuthContext` ou un interceptor API :

```javascript
// apps/mobile/contexts/AuthContext.js (exemple d'intégration)
// ...
const checkSubscriptionStatus = async () => {
  try {
    const response = await fetch(`${API_URL}/api/subscription/status`, { /* ... */ });
    const data = await response.json();
    if (!response.ok && data.blocked && data.reason === 'subscription_expired') {
      // Rediriger vers l'écran de blocage
      navigation.navigate('SubscriptionBlocked');
      return false;
    }
    // ... gérer les autres statuts ...
    return true;
  } catch (error) {
    console.error("Erreur de vérification d'abonnement:", error);
    return false;
  }
};
// ... Appeler checkSubscriptionStatus régulièrement ou lors de l'accès à des routes protégées
```

### 7. Lancement de l'Application Mobile

```bash
cd apps/mobile
npm start
```

## Tests

Pour exécuter les tests d'intégration du backend :

```bash
cd backend
npm test src/__tests__/subscription.test.js
```

## Points d'attention

*   Assurez-vous que les services `notificationService`, `paymentService`, `auditService` et `responseHelper` sont correctement configurés et fonctionnels.
*   Le `ADMIN_USER_ID` dans le `.env` doit correspondre à l'UUID de l'utilisateur administrateur dans votre base de données Supabase.
*   La gestion des webhooks PayDunya pour `handleRenewalPayment` doit être robuste et capable de gérer les tentatives multiples et l'idempotence.
*   La logique de redirection vers l'écran de blocage côté mobile doit être implémentée avec soin pour une expérience utilisateur fluide.

Ce sprint fournit les bases solides pour la monétisation de Hil_Delivre. Bon développement !
