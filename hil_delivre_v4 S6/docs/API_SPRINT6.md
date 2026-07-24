# API Sprint 6 — Notifications temps réel, Push FCM, SMS OTP

## Base URLs

```
/api/notifications    — Notifications et device tokens
/api/otp              — Vérification OTP par SMS
```

## Authentification

Tous les endpoints nécessitent un JWT valide dans le header `Authorization: Bearer <token>`.

---

## 1. Notifications

### `GET /api/notifications`

Récupère les notifications de l'utilisateur (paginées).

**Query params :**
| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| page | integer | 1 | Page courante |
| limit | integer | 20 | Notifications par page (max 50) |
| unread_only | string | "false" | Filtrer les non-lues uniquement |

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "notifications": [
      {
        "id": "uuid",
        "type": "order_accepted",
        "channel": "in_app",
        "title": "Commande acceptée",
        "body": "Votre commande #ORD-001 a été acceptée.",
        "data": { "order_ref": "ORD-001" },
        "is_read": false,
        "related_entity_type": "order",
        "related_entity_id": "uuid",
        "created_at": "2024-01-01T12:00:00Z"
      }
    ],
    "total": 45,
    "unread_count": 3,
    "page": 1,
    "limit": 20
  }
}
```

---

### `PUT /api/notifications/read`

Marque des notifications comme lues.

**Body :**
```json
{
  "notification_ids": ["uuid1", "uuid2"]
}
```

> Si `notification_ids` est vide ou absent, toutes les notifications sont marquées comme lues.

---

### `GET /api/notifications/preferences`

Récupère les préférences de notification de l'utilisateur.

**Réponse 200 :**
```json
{
  "success": true,
  "data": [
    {
      "notification_type": "order_created",
      "push_enabled": true,
      "sms_enabled": true,
      "in_app_enabled": true
    }
  ]
}
```

---

### `PUT /api/notifications/preferences`

Met à jour une préférence de notification.

**Body :**
```json
{
  "notification_type": "promotion",
  "push_enabled": false,
  "sms_enabled": false,
  "in_app_enabled": true
}
```

---

## 2. Device Tokens (FCM)

### `POST /api/notifications/device`

Enregistre un token FCM pour les notifications push.

**Body :**
```json
{
  "token": "fcm-token-string",
  "platform": "android",
  "device_name": "Samsung Galaxy S21"
}
```

**Plateformes valides :** `ios`, `android`, `web`

---

### `DELETE /api/notifications/device`

Supprime un token FCM (à appeler au logout).

**Body :**
```json
{
  "token": "fcm-token-string"
}
```

---

## 3. Admin Broadcast

### `POST /api/notifications/broadcast`

Envoie une notification à tous les utilisateurs d'un rôle.

**Rôle requis :** `admin`

**Rate limit :** 10 req/heure

**Body :**
```json
{
  "role": "client",
  "title": "Maintenance prévue",
  "message": "Le service sera indisponible de 2h à 4h.",
  "type": "system_alert"
}
```

**Rôles cibles valides :** `client`, `merchant`, `deliverer`

**Types valides :** `system_alert`, `promotion`

---

## 4. OTP (Vérification SMS)

### `POST /api/otp/send`

Envoie un code OTP à 6 chiffres par SMS via Africa's Talking.

**Rate limit :** 5 req/heure par IP, 3 par numéro par heure

**Body :**
```json
{
  "phone_number": "+22670123456",
  "purpose": "phone_verification"
}
```

**Purposes valides :**
- `phone_verification` — Vérification du numéro
- `login_2fa` — Authentification à deux facteurs
- `password_reset` — Réinitialisation de mot de passe
- `delivery_confirmation` — Confirmation de livraison

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "message": "Code OTP envoyé au +226****3456",
    "expires_at": "2024-01-01T12:05:00Z",
    "expires_in_seconds": 300
  }
}
```

---

### `POST /api/otp/verify`

Vérifie un code OTP.

**Rate limit :** 10 req/15min par IP

**Body :**
```json
{
  "phone_number": "+22670123456",
  "code": "123456",
  "purpose": "phone_verification"
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "message": "OTP verified successfully",
    "user_id": "uuid"
  }
}
```

**Erreurs possibles :**
| Code | Signification |
|------|---------------|
| 400 | Format invalide (numéro ou code) |
| 401 | Code incorrect (avec tentatives restantes) |
| 404 | Aucun OTP en attente |
| 410 | OTP expiré |
| 429 | Tentatives épuisées ou rate limit |

---

## 5. Socket.IO — Événements temps réel

### Connexion

```javascript
const socket = io('http://server:3000', {
  auth: { token: 'jwt-token' },
  transports: ['websocket']
});
```

### Événements Client → Serveur

| Événement | Données | Description |
|-----------|---------|-------------|
| `join:order` | `orderId` | Rejoindre la room d'une commande |
| `leave:order` | `orderId` | Quitter la room d'une commande |
| `deliverer:location` | `{orderId, latitude, longitude, heading, speed}` | Position du livreur |
| `notifications:read` | `[notificationIds]` | Marquer comme lu |
| `ping:custom` | — | Heartbeat |

### Événements Serveur → Client

| Événement | Données | Description |
|-----------|---------|-------------|
| `notification` | `{type, title, body, data, orderId}` | Nouvelle notification |
| `order:update` | `{type, title, body, data}` | Mise à jour de commande |
| `deliverer:position` | `{deliverer_id, latitude, longitude, heading, speed}` | Position du livreur |
| `joined:order` | `{orderId, success}` | Confirmation de join |
| `pong:custom` | `{timestamp}` | Réponse heartbeat |
| `error` | `{message}` | Erreur |

### Rooms

| Room | Format | Description |
|------|--------|-------------|
| Utilisateur | `user:{userId}` | Notifications personnelles |
| Rôle | `role:{role}` | Broadcast par rôle |
| Commande | `order:{orderId}` | Suivi temps réel d'une commande |

---

## Types de notifications

| Type | Destinataires | Description |
|------|---------------|-------------|
| `order_created` | Marchand | Nouvelle commande reçue |
| `order_accepted` | Client | Commande acceptée par le restaurant |
| `order_ready` | Client, Livreur | Commande prête |
| `order_picked_up` | Client | Livreur a récupéré la commande |
| `order_in_delivery` | Client | En cours de livraison |
| `order_delivered` | Client, Marchand | Commande livrée |
| `order_cancelled` | Client, Marchand, Livreur | Commande annulée |
| `delivery_proposed` | Livreur | Nouvelle course disponible |
| `delivery_accepted` | Client, Marchand | Livreur assigné |
| `delivery_rejected` | Client | Recherche d'un autre livreur |
| `payment_received` | Client, Marchand | Paiement confirmé |
| `payment_failed` | Client | Échec de paiement |
| `kyc_approved` | Utilisateur | KYC approuvé |
| `kyc_rejected` | Utilisateur | KYC refusé |
| `system_alert` | Utilisateur | Alerte système |
| `promotion` | Utilisateur | Promotion |

---

## Sécurité

### OTP
- Codes hashés SHA-256 en BDD (jamais stockés en clair)
- Expiration 5 minutes
- Maximum 3 tentatives par code
- Rate limit : 3 OTP par numéro par heure
- Cooldown : 60 secondes entre deux envois
- Comparaison timing-safe (anti timing attack)
- Nettoyage automatique des codes expirés

### Socket.IO
- Authentification JWT obligatoire à la connexion
- Vérification d'accès avant join d'une room de commande
- Heartbeat pour détecter les connexions mortes
- Nettoyage automatique des connexions stale (>5 min sans ping)

### FCM
- Tokens invalidés automatiquement si FCM retourne NotRegistered
- Push désactivable par l'utilisateur (préférences)
- Pas de données sensibles dans les payloads push

### Rate Limiting
| Endpoint | Limite |
|----------|--------|
| Notifications list | 60 req/min |
| OTP send | 5 req/h par IP |
| OTP verify | 10 req/15min par IP |
| Admin broadcast | 10 req/h |
