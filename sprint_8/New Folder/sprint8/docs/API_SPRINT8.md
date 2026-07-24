# Documentation API Hil_Delivre v4 — Sprint 8 : Abonnements

Ce document détaille les endpoints API implémentés ou modifiés dans le cadre du Sprint 8, couvrant la gestion des abonnements pour les marchands et les livreurs.

## 1. Vue d'ensemble

Le système d'abonnement permet aux marchands et livreurs de souscrire à des plans mensuels. L'accès aux fonctionnalités de la plateforme est conditionné par un abonnement actif. Ce sprint introduit des endpoints pour vérifier le statut de l'abonnement, initier des renouvellements, consulter l'historique et des endpoints d'administration pour la supervision.

## 2. Endpoints Publics (Authentifiés)

Ces endpoints sont accessibles aux utilisateurs authentifiés (marchands et livreurs) pour gérer leurs propres abonnements.

### 2.1. `GET /api/subscription/status`

Récupère le statut actuel de l'abonnement de l'utilisateur authentifié.

*   **Description** : Fournit des informations détaillées sur l'abonnement en cours, y compris son statut, la date d'expiration, le type de plan et si l'utilisateur est en période d'essai.
*   **Accès** : Privé (Utilisateur authentifié - Marchand, Livreur, Client, Admin)
*   **Rate Limit** : 100 requêtes par 15 minutes par utilisateur.
*   **Paramètres de Requête** : Aucun.
*   **Exemple de Réponse Succès (200 OK)** :

    ```json
    {
      "success": true,
      "message": "Statut d'abonnement récupéré avec succès.",
      "data": {
        "status": "active",
        "expires_at": "2024-08-23T10:00:00.000Z",
        "is_trial": false,
        "plan_type": "merchant_monthly",
        "amount": 6000,
        "plan_name": "Abonnement Marchand Mensuel",
        "started_at": "2024-07-23T10:00:00.000Z",
        "renewed_at": "2024-07-23T10:00:00.000Z",
        "trial_ends_at": null
      }
    }
    ```

*   **Exemple de Réponse Erreur (500 Internal Server Error)** :

    ```json
    {
      "success": false,
      "message": "Erreur interne du serveur lors de la récupération du statut d'abonnement."
    }
    ```

### 2.2. `POST /api/subscription/renew`

Initie le processus de renouvellement de l'abonnement via PayDunya.

*   **Description** : Génère une URL de paiement PayDunya à laquelle l'utilisateur doit être redirigé pour effectuer le paiement de son abonnement. Cette route est accessible même si l'abonnement est expiré pour permettre le renouvellement.
*   **Accès** : Privé (Utilisateur authentifié - Marchand, Livreur)
*   **Rate Limit** : 10 requêtes par 15 minutes par utilisateur.
*   **Paramètres de Requête** : Aucun (l'ID utilisateur est extrait du token JWT).
*   **Exemple de Réponse Succès (200 OK)** :

    ```json
    {
      "success": true,
      "message": "Renouvellement initié. Redirection vers PayDunya.",
      "data": {
        "payment_url": "https://app.paydunya.com/checkout/invoice/xxxx-xxxx-xxxx"
      }
    }
    ```

*   **Exemple de Réponse Erreur (500 Internal Server Error)** :

    ```json
    {
      "success": false,
      "message": "Échec de l'initialisation du paiement PayDunya."
    }
    ```

### 2.3. `GET /api/subscription/history`

Récupère l'historique des abonnements de l'utilisateur authentifié.

*   **Description** : Fournit une liste de tous les abonnements passés et présents de l'utilisateur, avec leurs détails (plan, montant, statut, dates).
*   **Accès** : Privé (Utilisateur authentifié - Marchand, Livreur, Client, Admin)
*   **Rate Limit** : 50 requêtes par 15 minutes par utilisateur.
*   **Paramètres de Requête** : Aucun.
*   **Exemple de Réponse Succès (200 OK)** :

    ```json
    {
      "success": true,
      "message": "Historique d'abonnement récupéré avec succès.",
      "data": [
        {
          "id": "uuid-sub-1",
          "plan_name": "Abonnement Marchand Mensuel",
          "amount": 6000,
          "status": "active",
          "started_at": "2024-07-23T10:00:00.000Z",
          "expires_at": "2024-08-23T10:00:00.000Z",
          "is_trial": false,
          "payment_transaction_id": "paydunya-tx-123"
        },
        {
          "id": "uuid-sub-2",
          "plan_name": "Abonnement Marchand Mensuel",
          "amount": 6000,
          "status": "expired",
          "started_at": "2024-06-23T10:00:00.000Z",
          "expires_at": "2024-07-23T10:00:00.000Z",
          "is_trial": true,
          "payment_transaction_id": null
        }
      ]
    }
    ```

## 3. Endpoints d'Administration

Ces endpoints sont accessibles uniquement aux utilisateurs ayant le rôle `admin`.

### 3.1. `GET /api/admin/subscriptions/expired`

Récupère la liste de tous les abonnements expirés.

*   **Description** : Permet à l'administrateur de visualiser tous les abonnements qui ne sont plus actifs, avec les informations de l'utilisateur concerné.
*   **Accès** : Privé (Rôle Admin uniquement)
*   **Rate Limit** : 20 requêtes par 15 minutes par utilisateur.
*   **Paramètres de Requête** : Aucun.
*   **Exemple de Réponse Succès (200 OK)** :

    ```json
    {
      "success": true,
      "message": "Abonnements expirés récupérés avec succès.",
      "data": [
        {
          "id": "uuid-sub-expired-1",
          "user_id": "uuid-user-1",
          "user_email": "marchand1@example.com",
          "user_phone": "+22670000001",
          "plan_name": "Abonnement Marchand Mensuel",
          "expires_at": "2024-07-20T10:00:00.000Z",
          "status": "expired"
        },
        {
          "id": "uuid-sub-expired-2",
          "user_id": "uuid-user-2",
          "user_email": "livreur1@example.com",
          "user_phone": "+22670000002",
          "plan_name": "Abonnement Livreur Mensuel",
          "expires_at": "2024-07-21T10:00:00.000Z",
          "status": "expired"
        }
      ]
    }
    ```

### 3.2. `GET /api/admin/subscriptions/stats`

Récupère des statistiques agrégées sur les abonnements.

*   **Description** : Fournit un aperçu du nombre d'abonnements actifs, expirés et en période d'essai, ainsi que le total.
*   **Accès** : Privé (Rôle Admin uniquement)
*   **Rate Limit** : 20 requêtes par 15 minutes par utilisateur.
*   **Paramètres de Requête** : Aucun.
*   **Exemple de Réponse Succès (200 OK)** :

    ```json
    {
      "success": true,
      "message": "Statistiques d'abonnement récupérées avec succès.",
      "data": {
        "active_subscriptions": 150,
        "expired_subscriptions": 25,
        "trial_subscriptions": 10,
        "total_subscriptions": 175
      }
    }
    ```

## 4. Webhook PayDunya pour le Renouvellement

*   **Endpoint** : `/api/paydunya/webhook` (Ce webhook est géré par le `paymentService` du Sprint 4, mais il est crucial pour le renouvellement des abonnements).
*   **Méthode** : `POST`
*   **Description** : Ce webhook est appelé par PayDunya après qu'un paiement ait été effectué. Le `subscriptionService` intercepte les paiements de type `subscription_renewal` via les métadonnées de la transaction pour mettre à jour l'abonnement de l'utilisateur et créditer le portefeuille virtuel de l'administrateur.
*   **Sécurité** : La requête doit être validée via le `PAYDUNYA_WEBHOOK_SECRET` pour s'assurer de son origine.

## 5. Middleware de Gating (`subscriptionGate`)

*   **Description** : Ce middleware est appliqué aux routes protégées du backend pour les rôles `merchant` et `delivery`.
*   **Comportement** :
    *   Si l'utilisateur est un `client` ou `admin`, le middleware passe à la suite.
    *   Si l'utilisateur est un `merchant` ou `delivery` et que son abonnement est expiré, il renvoie une réponse `403 Forbidden` avec un payload spécifique :

        ```json
        {
          "success": false,
          "message": "Votre abonnement a expiré. Veuillez le renouveler.",
          "blocked": true,
          "reason": "subscription_expired",
          "renewal_url": "/subscription/renew" // URL front-end pour la redirection
        }
        ```
    *   Les routes `/api/subscription/renew` et `/api/subscription/status` sont exemptées de ce gating pour permettre aux utilisateurs expirés de renouveler leur abonnement ou de vérifier son statut.

## 6. Cron Jobs

Deux cron jobs sont mis en place pour la gestion automatisée des abonnements :

### 6.1. `checkExpiringSubscriptions`

*   **Fréquence** : Quotidien (tous les jours à minuit).
*   **Action** : Appelle `subscriptionService.processExpirationNotifications()` pour envoyer des notifications aux utilisateurs dont l'abonnement expire dans 7 jours, 3 jours ou le jour même.

### 6.2. `blockExpiredAccounts`

*   **Fréquence** : Horaire (toutes les heures à la 0ème minute).
*   **Action** : Appelle la fonction PL/pgSQL `check_expired_subscriptions()` dans la base de données Supabase. Cette fonction met à jour le statut des abonnements et des profils `profiles_data` pour marquer les abonnements comme `expired` si la date d'expiration est dépassée.
