# API Sprint 7 — Panel Admin, Réconciliation Cash, Statistiques

## Base URLs

```
/api/admin        — Endpoints d'administration (rôle admin requis)
/api/deliverer    — Endpoints livreur (réconciliation)
```

## Authentification

Tous les endpoints nécessitent un JWT valide dans le header `Authorization: Bearer <token>`.
Les routes `/api/admin/*` nécessitent le rôle `admin`.

---

## 1. Dashboard & Statistiques

### `GET /api/admin/dashboard`

Métriques temps réel du dashboard.

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "realtime": {
      "active_orders": 12,
      "online_deliverers": 8,
      "pending_kyc": 3
    },
    "today": {
      "total_orders": 45,
      "completed_orders": 38,
      "cancelled_orders": 2,
      "completion_rate": 84,
      "revenue_commissions": 125000,
      "revenue_delivery_fees": 45000,
      "revenue_vat": 30600,
      "revenue_total": 200600
    },
    "users": {
      "total": 1250,
      "clients": 980,
      "merchants": 150,
      "deliverers": 115,
      "admins": 5
    },
    "generated_at": "2024-01-15T14:30:00Z"
  }
}
```

---

### `GET /api/admin/stats`

Statistiques historiques par période.

**Query params :**
| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| start_date | string (YYYY-MM-DD) | -30 jours | Début de période |
| end_date | string (YYYY-MM-DD) | aujourd'hui | Fin de période |

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "period": { "start_date": "2024-01-01", "end_date": "2024-01-31" },
    "totals": {
      "total_orders": 1200,
      "completed_orders": 1050,
      "cancelled_orders": 80,
      "total_revenue": 5200000,
      "total_commissions": 3800000,
      "total_gmv": 76000000,
      "new_users": 320
    },
    "daily": [
      {
        "stat_date": "2024-01-01",
        "total_orders": 42,
        "completed_orders": 36,
        "..."
      }
    ]
  }
}
```

---

### `GET /api/admin/stats/top-merchants`

Top marchands par volume.

**Query params :** `limit` (défaut: 10), `period_days` (défaut: 30)

---

### `GET /api/admin/stats/top-deliverers`

Top livreurs par performance.

**Query params :** `limit` (défaut: 10), `period_days` (défaut: 30)

---

### `POST /api/admin/stats/calculate`

Déclenche manuellement le calcul des stats quotidiennes.

**Body :**
```json
{ "date": "2024-01-14" }
```

---

## 2. Gestion Utilisateurs

### `GET /api/admin/users`

Liste paginée des utilisateurs avec filtres.

**Query params :**
| Param | Type | Description |
|-------|------|-------------|
| role | string | Filtrer par rôle (client/merchant/deliverer) |
| status | string | Filtrer par statut (active/suspended) |
| search | string | Recherche par nom ou téléphone |
| page | integer | Page (défaut: 1) |
| limit | integer | Par page (défaut: 20, max: 100) |
| sort_by | string | Champ de tri (défaut: created_at) |
| sort_order | string | Ordre (asc/desc, défaut: desc) |

---

### `GET /api/admin/users/:userId`

Détail complet d'un utilisateur (profil + stats + historique actions admin).

---

### `POST /api/admin/users/:userId/suspend`

Suspend un utilisateur.

**Body :**
```json
{ "reason": "Comportement frauduleux détecté sur le compte" }
```

**Contraintes :**
- Raison obligatoire (min 10 caractères)
- Impossible de suspendre un admin
- Le livreur est mis offline automatiquement
- Notification envoyée à l'utilisateur

---

### `POST /api/admin/users/:userId/unsuspend`

Réactive un utilisateur suspendu.

---

### `DELETE /api/admin/users/:userId`

Supprime un utilisateur (anonymisation CIL).

**Body :**
```json
{ "reason": "Demande de suppression de compte par l'utilisateur" }
```

---

## 3. Réconciliation Cash

### `GET /api/admin/reconciliation`

Liste des fiches de réconciliation.

**Query params :** `deliverer_id`, `status`, `page`, `limit`

---

### `POST /api/admin/reconciliation/generate`

Génère une fiche de réconciliation pour un livreur.

**Body :**
```json
{
  "deliverer_id": "uuid",
  "period_start": "2024-01-01T00:00:00Z",
  "period_end": "2024-01-07T23:59:59Z"
}
```

**Réponse 201 :**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "deliverer_id": "uuid",
    "period_start": "2024-01-01T00:00:00Z",
    "period_end": "2024-01-07T23:59:59Z",
    "total_cash_collected": 150000,
    "total_orders_cash": 12,
    "platform_commission": 7500,
    "delivery_fees_collected": 18000,
    "amount_to_remit": 132000,
    "amount_to_receive": 0,
    "status": "pending",
    "order_ids": ["uuid1", "uuid2"]
  }
}
```

---

### `POST /api/admin/reconciliation/:recordId/confirm`

Confirme la réception du paiement du livreur.

---

### `POST /api/admin/reconciliation/:recordId/dispute`

Conteste un enregistrement.

**Body :**
```json
{ "reason": "Le montant ne correspond pas aux commandes vérifiées" }
```

---

### `GET /api/admin/reconciliation/balance/:delivererId`

Solde cash actuel d'un livreur (commandes non réconciliées).

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "deliverer_id": "uuid",
    "total_cash_held": 85000,
    "delivery_fees_earned": 12000,
    "amount_owed_to_platform": 73000,
    "unreconciled_orders_count": 7,
    "oldest_unreconciled": "2024-01-10T08:30:00Z"
  }
}
```

---

## 4. Payouts Marchands

### `GET /api/admin/payouts`

Liste des payouts marchands.

**Query params :** `merchant_id`, `status`, `page`, `limit`

---

### `POST /api/admin/payouts/generate`

Génère un payout pour un marchand.

**Body :**
```json
{
  "merchant_id": "uuid",
  "period_start": "2024-01-01T00:00:00Z",
  "period_end": "2024-01-07T23:59:59Z"
}
```

---

### `POST /api/admin/payouts/:payoutId/approve`

Approuve et marque un payout comme payé.

**Body :**
```json
{ "payment_reference": "MM-2024-001234" }
```

---

## 5. Routes Livreur

### `GET /api/deliverer/reconciliation`

Liste des réconciliations du livreur connecté.

**Query params :** `status`, `page`, `limit`

---

### `GET /api/deliverer/balance`

Solde cash actuel du livreur connecté.

---

### `POST /api/deliverer/reconciliation/:recordId/submit`

Le livreur soumet sa réconciliation (confirme qu'il va payer).

**Body :**
```json
{ "payment_reference": "MM-70123456-20240115" }
```

---

## Flux de réconciliation

```
1. Admin génère la fiche → status: "pending"
2. Livreur consulte et soumet → status: "submitted" (+ référence paiement)
3a. Admin confirme réception → status: "confirmed" (solde reset)
3b. Admin conteste → status: "disputed" (+ raison)
4. Résolution → status: "resolved"
```

---

## Sécurité

### RBAC
- Toutes les routes `/api/admin/*` nécessitent le rôle `admin`
- Impossible de suspendre/supprimer un admin
- Les livreurs ne voient que leurs propres réconciliations
- Les marchands ne voient que leurs propres payouts

### Audit
- Chaque action admin est loggée dans `admin_actions`
- IP, timestamp, raison, métadonnées conservées
- Conforme CIL (traçabilité des accès aux données personnelles)

### Rate Limiting
| Endpoint | Limite |
|----------|--------|
| Admin global | 120 req/min |
| Livreur global | 60 req/min |

### Anonymisation CIL
- La suppression d'un utilisateur anonymise ses données personnelles
- full_name → "[SUPPRIMÉ]", phone → null, address → null
- Les commandes historiques sont conservées (obligation comptable)
