# Sprint 7 — Panel Admin : Dashboard, Modération, Réconciliation Cash, Payouts

## Vue d'ensemble

Le Sprint 7 implémente le système d'administration complet de Hil_Delivre v4 :

- **Dashboard temps réel** : Métriques live (commandes actives, livreurs en ligne, KYC pending)
- **Statistiques historiques** : Revenue, GMV, taux de complétion, top marchands/livreurs
- **Gestion utilisateurs** : Liste, recherche, suspension, réactivation, suppression (CIL)
- **Réconciliation cash** : Suivi des encaissements livreurs, génération de fiches, confirmation/contestation
- **Payouts marchands** : Génération des reversements, approbation, suivi des paiements

---

## Architecture

```
Sprint 7
├── database/
│   └── schema_sprint7.sql                    # Migration SQL (4 tables, 3 enums, 2 fonctions, 8 colonnes)
├── backend/src/
│   ├── services/
│   │   ├── statsService.js                   # Métriques temps réel et historiques
│   │   ├── reconciliationService.js          # Réconciliation cash livreurs
│   │   └── moderationService.js              # Gestion utilisateurs et payouts
│   ├── controllers/
│   │   └── adminController.js                # 18 handlers d'endpoints
│   ├── routes/
│   │   ├── adminRoutes.js                    # 18 routes admin
│   │   └── delivererRoutes.js                # 3 routes livreur (réconciliation)
│   ├── middlewares/
│   │   └── validationSprint7.js              # 8 schémas Joi
│   └── __tests__/
│       └── admin.test.js                     # 25+ tests
├── apps/
│   ├── admin/src/services/
│   │   └── adminApi.js                       # Client API panel web
│   └── mobile/screens/admin/
│       ├── AdminDashboardScreen.js           # Dashboard mobile
│       ├── UsersManagementScreen.js          # Gestion utilisateurs
│       └── ReconciliationScreen.js           # Réconciliation cash
├── docs/
│   └── API_SPRINT7.md                        # Documentation API complète
├── .env.example                              # Variables d'environnement
└── SPRINT7_README.md                         # Ce fichier
```

---

## Migration SQL

### Nouvelles tables

| Table | Description |
|-------|-------------|
| `admin_actions` | Journal d'audit de toutes les actions administratives |
| `reconciliation_records` | Fiches de réconciliation cash des livreurs |
| `merchant_payouts` | Reversements aux marchands |
| `platform_daily_stats` | Statistiques quotidiennes agrégées |

### Nouvelles colonnes (profiles_data)

| Colonne | Type | Description |
|---------|------|-------------|
| `is_suspended` | BOOLEAN | Compte suspendu |
| `suspension_reason` | TEXT | Raison de la suspension |
| `suspended_at` | TIMESTAMPTZ | Date de suspension |
| `suspended_by` | UUID | Admin qui a suspendu |
| `cash_balance` | NUMERIC(12,0) | Solde cash en attente (livreur) |
| `total_earnings` | NUMERIC(12,0) | Total des gains |
| `total_orders_count` | INTEGER | Nombre total de commandes |
| `avg_rating` | NUMERIC(3,2) | Note moyenne |

### Fonctions PL/pgSQL

| Fonction | Description |
|----------|-------------|
| `calculate_daily_stats(date)` | Calcule et persiste les stats d'un jour |
| `generate_reconciliation(deliverer_id, start, end)` | Génère une fiche de réconciliation |

### Exécution

```bash
psql $DATABASE_URL < database/schema_sprint7.sql
```

---

## Services Backend

### statsService.js — Métriques et statistiques

| Fonction | Description |
|----------|-------------|
| `getDashboardMetrics()` | Métriques temps réel (requêtes parallèles) |
| `getHistoricalStats(options)` | Stats historiques par période |
| `getTopMerchants(options)` | Top marchands par volume |
| `getTopDeliverers(options)` | Top livreurs par performance |
| `triggerDailyStatsCalculation(date)` | Déclenche le calcul via RPC |

### reconciliationService.js — Réconciliation cash

| Fonction | Description |
|----------|-------------|
| `generateReconciliation(delivererId, start, end)` | Génère une fiche |
| `submitReconciliation(recordId, delivererId, ref)` | Livreur soumet |
| `confirmReconciliation(recordId, adminId)` | Admin confirme |
| `disputeReconciliation(recordId, adminId, reason)` | Admin conteste |
| `getReconciliations(options)` | Liste filtrée |
| `getDelivererCashBalance(delivererId)` | Solde cash actuel |

### moderationService.js — Gestion utilisateurs et payouts

| Fonction | Description |
|----------|-------------|
| `getUsers(options)` | Liste paginée avec filtres |
| `getUserDetail(userId)` | Détail complet + stats + historique |
| `suspendUser(userId, adminId, reason)` | Suspension |
| `unsuspendUser(userId, adminId)` | Réactivation |
| `deleteUser(userId, adminId, reason)` | Suppression (anonymisation CIL) |
| `generateMerchantPayout(merchantId, start, end)` | Génère un payout |
| `approvePayout(payoutId, adminId, ref)` | Approuve un payout |
| `getPayouts(options)` | Liste des payouts |

---

## Endpoints API

### Admin (18 routes)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/admin/dashboard` | Métriques temps réel |
| GET | `/api/admin/stats` | Stats historiques |
| GET | `/api/admin/stats/top-merchants` | Top marchands |
| GET | `/api/admin/stats/top-deliverers` | Top livreurs |
| POST | `/api/admin/stats/calculate` | Calcul stats manuelles |
| GET | `/api/admin/users` | Liste utilisateurs |
| GET | `/api/admin/users/:userId` | Détail utilisateur |
| POST | `/api/admin/users/:userId/suspend` | Suspendre |
| POST | `/api/admin/users/:userId/unsuspend` | Réactiver |
| DELETE | `/api/admin/users/:userId` | Supprimer (CIL) |
| GET | `/api/admin/reconciliation` | Liste réconciliations |
| POST | `/api/admin/reconciliation/generate` | Générer fiche |
| POST | `/api/admin/reconciliation/:id/confirm` | Confirmer |
| POST | `/api/admin/reconciliation/:id/dispute` | Contester |
| GET | `/api/admin/reconciliation/balance/:id` | Solde livreur |
| GET | `/api/admin/payouts` | Liste payouts |
| POST | `/api/admin/payouts/generate` | Générer payout |
| POST | `/api/admin/payouts/:id/approve` | Approuver payout |

### Livreur (3 routes)

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/deliverer/reconciliation` | Mes réconciliations |
| GET | `/api/deliverer/balance` | Mon solde cash |
| POST | `/api/deliverer/reconciliation/:id/submit` | Soumettre |

---

## Flux de réconciliation cash

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
│   PENDING   │ ──► │  SUBMITTED   │ ──► │   CONFIRMED     │     │  RESOLVED  │
│ (admin crée)│     │(livreur paie)│     │(admin confirme) │     │(si dispute)│
└─────────────┘     └──────────────┘     └─────────────────┘     └────────────┘
                           │                                            ▲
                           ▼                                            │
                    ┌──────────────┐                                    │
                    │   DISPUTED   │ ───────────────────────────────────┘
                    │(admin conteste)
                    └──────────────┘
```

**Logique financière :**
- Le livreur collecte le cash total du client (food + commission + TVA + frais)
- Le livreur garde ses frais de livraison
- Le livreur reverse : `total_cash - delivery_fees` à la plateforme
- La plateforme conserve : commission + TVA sur services

---

## Flux de payout marchand

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   PENDING   │ ──► │  PROCESSING  │ ──► │   COMPLETED     │
│(admin génère)│    │(en traitement)│    │(admin approuve) │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │    FAILED    │
                    │(échec paiement)
                    └──────────────┘
```

**Logique financière :**
- Net payout = food_amount - commission (5%) 
- La TVA est sur la commission (service plateforme), pas sur le food_amount
- Le marchand reçoit 95% du montant des plats

---

## Mobile

### AdminDashboardScreen
- Métriques temps réel avec refresh automatique (60s)
- Revenue du jour ventilée (commissions, frais, TVA)
- Taux de complétion
- Compteurs utilisateurs par rôle
- Actions rapides (navigation)
- Pull-to-refresh

### UsersManagementScreen
- Liste paginée avec infinite scroll
- Recherche par nom/téléphone
- Filtres par rôle et statut
- Actions : suspendre / réactiver
- Navigation vers le détail

### ReconciliationScreen
- Liste des fiches avec filtres par statut
- Détail financier complet par fiche
- Actions : confirmer / contester
- Affichage de la référence de paiement

---

## Sécurité

### RBAC strict
- Toutes les routes admin vérifient `role === 'admin'`
- Impossible de suspendre/supprimer un admin
- Les livreurs ne voient que leurs propres données
- Les marchands ne voient que leurs propres payouts

### Audit complet
- Chaque action admin est loggée dans `admin_actions`
- Données conservées : admin_id, action_type, target, reason, IP, timestamp
- Conforme CIL (traçabilité des accès aux données personnelles)

### Anonymisation CIL
- La suppression anonymise : full_name → "[SUPPRIMÉ]", phone/address → null
- Les commandes historiques sont conservées (obligation comptable FEC/DGI)
- Les tokens FCM sont désactivés

### Rate Limiting
| Endpoint | Limite |
|----------|--------|
| Admin global | 120 req/min |
| Livreur global | 60 req/min |

---

## Tests

```bash
# Exécuter les tests Sprint 7
npm test -- --testPathPattern="admin"
```

**Couverture :** 25+ tests (stats, réconciliation, modération, validation)

---

## Points d'attention pour les sprints suivants

1. **Sprint 8 (Abonnements)** :
   - Gestion des abonnements marchands depuis l'admin
   - Stats d'abonnements dans le dashboard
   - Notifications d'expiration

2. **Sprint 9 (Évaluations)** :
   - Modération des avis
   - Mise à jour de avg_rating dans profiles_data
   - Alertes sur les notes basses

3. **Sprint 10 (Optimisation)** :
   - Cache Redis pour les métriques dashboard
   - Pagination côté curseur pour les grandes listes
   - Export CSV des données admin
   - Cron job automatique pour calculate_daily_stats

4. **Production** :
   - Configurer le cron Supabase pour `calculate_daily_stats` (quotidien à 1h)
   - Mettre en place des alertes si cash_balance > CASH_ALERT_THRESHOLD
   - Configurer les webhooks PayDunya pour les payouts automatiques
   - Implémenter le 2FA obligatoire pour les comptes admin
