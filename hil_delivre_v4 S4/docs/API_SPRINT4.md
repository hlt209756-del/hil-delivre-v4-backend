# Hil_Delivre v4 — Sprint 4 : Documentation API Paiement & FEC

## Vue d'ensemble

Le Sprint 4 introduit le système de paiement complet avec deux méthodes :
- **Mobile Money** : via PayDunya (Orange Money, Moov Money, Coris Money)
- **Cash** : paiement en espèces à la livraison

Chaque paiement complété génère automatiquement une facture FEC conforme à la DGI du Burkina Faso.

---

## Endpoints

### 1. POST `/api/payments/initiate`

Initie un paiement pour une commande existante.

**Auth** : JWT requis (rôle `client`)  
**Rate Limit** : 10 requêtes / 15 minutes par utilisateur

#### Request Body

```json
{
  "order_id": "uuid",
  "payment_method": "mobile_money | cash",
  "phone_number": "+22670123456"
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `order_id` | UUID | Oui | ID de la commande à payer |
| `payment_method` | string | Oui | `mobile_money` ou `cash` |
| `phone_number` | string | Conditionnel | Requis si `mobile_money`. Format : +226XXXXXXXX |

#### Response 201 (Mobile Money)

```json
{
  "success": true,
  "message": "Payment initiated",
  "data": {
    "transaction_id": "uuid",
    "status": "pending",
    "payment_url": "https://app.paydunya.com/checkout/token",
    "token": "paydunya-token",
    "amount": 5885,
    "currency": "XOF",
    "is_existing": false,
    "message": "Payment initiated successfully"
  }
}
```

#### Response 201 (Cash)

```json
{
  "success": true,
  "message": "Cash payment registered",
  "data": {
    "transaction_id": "uuid",
    "status": "completed",
    "amount": 5885,
    "currency": "XOF",
    "payment_method": "cash",
    "message": "Order marked as cash payment. Amount will be collected at delivery."
  }
}
```

#### Erreurs possibles

| Code | Condition |
|------|-----------|
| 400 | Méthode de paiement invalide |
| 403 | L'utilisateur n'est pas le propriétaire de la commande |
| 404 | Commande non trouvée |
| 409 | Commande non payable (statut incompatible) |
| 429 | Nombre maximum de tentatives atteint |
| 502 | Erreur du fournisseur de paiement (PayDunya) |

---

### 2. POST `/api/payments/webhook`

Webhook de notification PayDunya. Appelé automatiquement par PayDunya lors d'un changement de statut de paiement.

**Auth** : Aucune (public), sécurisé par signature HMAC SHA-256  
**Rate Limit** : 100 requêtes / minute

#### Headers requis

| Header | Description |
|--------|-------------|
| `x-paydunya-signature` | Signature HMAC SHA-256 du body |

#### Request Body (envoyé par PayDunya)

```json
{
  "data": {
    "status": "completed",
    "token": "paydunya-token",
    "custom_data": {
      "order_id": "uuid",
      "transaction_id": "uuid",
      "idempotency_key": "uuid"
    }
  }
}
```

#### Response 200

```json
{
  "status": "ok",
  "message": "Payment completed",
  "idempotent": false
}
```

> **Note** : Ce endpoint retourne toujours 200 (sauf signature invalide → 401) pour éviter les retries infinis de PayDunya.

---

### 3. GET `/api/payments/:orderId/status`

Récupère le statut de paiement d'une commande.

**Auth** : JWT requis (client, marchand ou livreur de la commande, ou admin)  
**Rate Limit** : 30 requêtes / minute (pour le polling mobile)

#### Response 200

```json
{
  "success": true,
  "message": "Payment status retrieved",
  "data": {
    "orderId": "uuid",
    "orderStatus": "pending",
    "paymentMethod": "mobile_money",
    "cashPaymentStatus": null,
    "transaction": {
      "id": "uuid",
      "status": "pending",
      "payment_method": "mobile_money",
      "amount": 5885,
      "provider_ref": "paydunya-token",
      "created_at": "2024-06-15T10:30:00Z",
      "completed_at": null
    },
    "isPaid": false
  }
}
```

---

### 4. GET `/api/orders/:orderId/invoice`

Récupère la facture FEC d'une commande.

**Auth** : JWT requis (client ou marchand de la commande, ou admin)

#### Response 200

```json
{
  "success": true,
  "message": "Invoice retrieved",
  "data": {
    "id": "uuid",
    "order_id": "uuid",
    "merchant_id": "uuid",
    "client_id": "uuid",
    "invoice_number": "HIL-2024-000042",
    "invoice_date": "2024-06-15T10:35:00Z",
    "commission_ht": 500,
    "delivery_fee_ht": 750,
    "total_ht": 1250,
    "total_tva": 225,
    "total_ttc": 1475,
    "vat_rate": 0.18,
    "fec_data": { "..." },
    "status": "generated"
  }
}
```

---

### 5. GET `/api/config/rates`

Récupère les taux publics de la plateforme.

**Auth** : Aucune (public)

#### Response 200

```json
{
  "success": true,
  "message": "Platform rates retrieved",
  "data": {
    "merchant_commission_rate": 0.05,
    "delivery_commission_rate": 0.01,
    "platform_vat_rate": 0.18,
    "delivery_base_fee": 250,
    "delivery_rate_per_km_tier1": 120,
    "delivery_rate_per_km_tier2": 90,
    "delivery_tier1_max_km": 5,
    "delivery_min_guaranteed": 500,
    "cash_reconciliation_fee_rate": 0.05,
    "service_fee_rate": 0.02
  }
}
```

---

### 6. GET `/api/admin/config`

Récupère toutes les configurations de la plateforme (admin).

**Auth** : JWT requis (rôle `admin`)

---

### 7. PUT `/api/admin/config/:key`

Met à jour une configuration de la plateforme.

**Auth** : JWT requis (rôle `admin`)

#### Request Body

```json
{
  "value": 0.07
}
```

#### Response 200

```json
{
  "success": true,
  "message": "Configuration \"merchant_commission_rate\" updated successfully",
  "data": {
    "id": "uuid",
    "config_key": "merchant_commission_rate",
    "config_value": 0.07,
    "description": "Taux de commission sur la nourriture vendue par les marchands",
    "updated_at": "2024-06-15T11:00:00Z",
    "updated_by": "admin-uuid"
  }
}
```

---

## Flux de paiement

### Mobile Money

```
Client → POST /payments/initiate → Backend → PayDunya API
                                              ↓
Client ← payment_url ← Backend ← PayDunya (token)
                                              ↓
Client → Ouvre payment_url → Confirme sur téléphone
                                              ↓
PayDunya → POST /payments/webhook → Backend
                                              ↓
Backend → Met à jour transaction + commande → Génère facture FEC
                                              ↓
Client ← Polling /payments/:id/status ← Backend (status: completed)
```

### Cash

```
Client → POST /payments/initiate (method: cash) → Backend
                                                      ↓
Backend → Crée transaction (status: completed) → Met à jour commande
                                                      ↓
Client ← Confirmation immédiate ← Backend
                                                      ↓
Livreur collecte le cash à la livraison
```

---

## Sécurité

| Mesure | Description |
|--------|-------------|
| Signature HMAC | Webhook vérifié par HMAC SHA-256 (timing-safe) |
| Idempotence | Chaque transaction a un idempotency_key unique |
| Rate Limiting | Limites spécifiques par endpoint |
| PCI DSS | Aucune donnée carte stockée (Mobile Money uniquement) |
| Données sensibles | Seuls les 4 derniers chiffres du téléphone sont stockés |
| Anti-replay | Transactions déjà complétées ne sont pas retraitées |
| RBAC | Accès contrôlé par rôle et appartenance à la commande |
