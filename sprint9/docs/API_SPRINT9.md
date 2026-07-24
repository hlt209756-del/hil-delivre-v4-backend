# API Sprint 9 — Notation, Certification Hygiène, Fidélisation

## Base URL

```
https://api.hil-delivre.bf/api
```

## Authentification

Toutes les routes (sauf publiques) nécessitent un header :
```
Authorization: Bearer <JWT_TOKEN>
```

---

## 1. Notation

### POST /orders/:orderId/rate

Crée une notation pour une commande livrée.

**Rôles autorisés :** `client`, `delivery`

**Rate limit :** 20 req / 15 min

**Params URL :**
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| orderId | UUID | Oui | ID de la commande |

**Body :**
| Champ | Type | Requis | Contraintes | Description |
|-------|------|--------|-------------|-------------|
| rated_user_id | UUID | Oui | UUID valide | Utilisateur à noter |
| score | Integer | Oui | 1-5 | Score de notation |
| comment | String | Non | max 500 chars | Commentaire optionnel |

**Réponse 201 :**
```json
{
  "success": true,
  "message": "Notation créée avec succès",
  "data": {
    "id": "uuid",
    "order_id": "uuid",
    "rater_id": "uuid",
    "rated_user_id": "uuid",
    "score": 5,
    "comment": "Excellent service",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

**Erreurs possibles :**
- `400` : Score invalide, commande non livrée, fenêtre 72h dépassée, déjà noté, auto-notation
- `403` : Rôle non autorisé
- `429` : Rate limit dépassé

---

### GET /users/:userId/ratings

Récupère les notations reçues par un utilisateur (public).

**Rôles autorisés :** Public (pas d'authentification requise)

**Rate limit :** 60 req / min

**Params URL :**
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| userId | UUID | Oui | ID de l'utilisateur |

**Query params :**
| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| page | Integer | 1 | Numéro de page |
| limit | Integer | 20 | Éléments par page (max 100) |
| min_score | Integer | - | Score minimum (1-5) |
| max_score | Integer | - | Score maximum (1-5) |
| sort_by | String | created_at | Champ de tri (created_at, score) |
| sort_order | String | desc | Ordre (asc, desc) |

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "ratings": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

---

### GET /users/:userId/rating-summary

Récupère la note moyenne d'un utilisateur (public).

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "avg_rating": 4.5,
    "ratings_count": 12
  }
}
```

---

### GET /orders/:orderId/can-rate

Vérifie si l'utilisateur connecté peut noter.

**Rôles autorisés :** `client`, `delivery`

**Query params :**
| Param | Type | Requis | Description |
|-------|------|--------|-------------|
| rated_user_id | UUID | Oui | Utilisateur à noter |

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "can_rate": true,
    "reason": null
  }
}
```

---

### GET /orders/:orderId/ratings

Récupère les notations d'une commande.

**Rôles autorisés :** Authentifié

---

### GET /admin/ratings

Liste des notations pour modération.

**Rôles autorisés :** `admin`

**Rate limit :** 120 req / min

**Query params :**
| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| page | Integer | 1 | Page |
| limit | Integer | 20 | Limite |
| include_hidden | String | false | Inclure les modérées |
| min_score | Integer | - | Score minimum |
| max_score | Integer | - | Score maximum |
| user_id | UUID | - | Filtrer par utilisateur noté |

---

### DELETE /admin/ratings/:ratingId

Modère (masque) une notation abusive.

**Rôles autorisés :** `admin`

**Body :**
| Champ | Type | Requis | Contraintes | Description |
|-------|------|--------|-------------|-------------|
| reason | String | Oui | 5-500 chars | Raison de modération |

**Réponse 200 :**
```json
{
  "success": true,
  "message": "Notation modérée avec succès",
  "data": {
    "id": "uuid",
    "is_visible": false,
    "moderated_at": "2025-01-15T10:30:00Z"
  }
}
```

---

## 2. Fidélisation

### GET /loyalty/points

Récupère le solde de points du client connecté.

**Rôles autorisés :** `client`

**Rate limit :** 60 req / min

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "available_points": 350,
    "value_fcfa": 1750,
    "expiring_soon": 50,
    "next_expiration": "2025-03-15T00:00:00Z",
    "min_redeem": 100,
    "conversion_rate": 5,
    "can_redeem": true
  }
}
```

---

### GET /loyalty/history

Récupère l'historique des transactions de points.

**Rôles autorisés :** `client`

**Query params :**
| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| page | Integer | 1 | Page |
| limit | Integer | 20 | Limite |
| type | String | - | Filtre : earned, redeemed, expired |

---

### POST /loyalty/redeem

Convertit des points en crédit plateforme (wallet_balance).

**Rôles autorisés :** `client`

**Rate limit :** 5 req / 15 min

**Body :**
| Champ | Type | Requis | Contraintes | Description |
|-------|------|--------|-------------|-------------|
| points | Integer | Oui | min 100 | Nombre de points à convertir |

**Réponse 200 :**
```json
{
  "success": true,
  "message": "100 points convertis en 500 FCFA de crédit",
  "data": {
    "points_redeemed": 100,
    "credit_amount": 500,
    "conversion_rate": 5
  }
}
```

---

### GET /admin/loyalty/stats

Statistiques du programme de fidélité.

**Rôles autorisés :** `admin`

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "total_active_points": 15000,
    "total_active_value_fcfa": 75000,
    "total_redeemed_points": 5000,
    "total_redeemed_value_fcfa": 25000,
    "active_users_count": 120,
    "config": {
      "points_per_100fcfa": 1,
      "expiry_months": 6,
      "conversion_rate": 5,
      "min_redeem": 100
    }
  }
}
```

---

### POST /admin/loyalty/expire

Déclenche manuellement l'expiration des points périmés.

**Rôles autorisés :** `admin`

---

## 3. Certification Hygiène

### POST /merchant/certify

Demande une certification hygiène.

**Rôles autorisés :** `merchant`

**Rate limit :** 5 req / heure

**Prérequis :** KYC approuvé, wallet_balance ≥ 5000 FCFA

**Réponse 201 :**
```json
{
  "success": true,
  "message": "Demande de certification soumise. 5000 FCFA débités de votre portefeuille.",
  "data": {
    "id": "uuid",
    "merchant_id": "uuid",
    "status": "pending",
    "fee_amount": 5000,
    "fee_paid": true,
    "payment_reference": "CERT-1705312200000-abc12345",
    "created_at": "2025-01-15T10:30:00Z"
  }
}
```

---

### POST /merchant/certify/renew

Renouvelle une certification expirée ou proche de l'expiration.

**Rôles autorisés :** `merchant`

**Prérequis :** Certification précédente expirée/révoquée ou expirant dans < 30 jours

---

### GET /merchant/certification

Récupère le statut de certification du marchand connecté.

**Rôles autorisés :** `merchant`

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "certified",
    "certification_date": "2025-01-15T10:30:00Z",
    "expiration_date": "2026-01-15T10:30:00Z",
    "is_certified": true,
    "is_expired": false,
    "days_remaining": 335,
    "can_renew": false,
    "fee": 5000
  }
}
```

---

### GET /admin/certification-hygiene

Liste des certifications (admin).

**Rôles autorisés :** `admin`

**Query params :**
| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| page | Integer | 1 | Page |
| limit | Integer | 20 | Limite |
| status | String | - | pending, certified, expired, revoked |
| merchant_id | UUID | - | Filtrer par marchand |
| expiring_soon | String | false | Expirant dans 30 jours |

---

### PUT /admin/certification-hygiene/:certificationId/approve

Approuve une certification.

**Rôles autorisés :** `admin`

**Body :**
| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| notes | String | Non | Notes admin (max 1000 chars) |

---

### PUT /admin/certification-hygiene/:certificationId/revoke

Révoque une certification.

**Rôles autorisés :** `admin`

**Body :**
| Champ | Type | Requis | Contraintes | Description |
|-------|------|--------|-------------|-------------|
| reason | String | Oui | 5-500 chars | Raison de révocation |

---

### POST /admin/certification-hygiene/check-expirations

Déclenche la vérification des certifications expirées.

**Rôles autorisés :** `admin`

---

## Codes d'erreur communs

| Code | Signification |
|------|---------------|
| 400 | Erreur de validation ou logique métier |
| 401 | Non authentifié |
| 403 | Accès interdit (rôle insuffisant) |
| 404 | Ressource introuvable |
| 429 | Rate limit dépassé |
| 500 | Erreur interne du serveur |

## Format de réponse standard

```json
{
  "success": true|false,
  "message": "Description lisible",
  "data": { ... },
  "error": "ERROR_CODE"
}
```
