# API Sprint 5 — Livraison : Géolocalisation, OSRM, Assignation, Tracking

## Base URL

```
/api/delivery
```

## Authentification

Tous les endpoints nécessitent un JWT valide dans le header `Authorization: Bearer <token>`.

---

## 1. Estimation des frais de livraison

### `POST /api/delivery/estimate`

Estime les frais de livraison entre un marchand et un point de livraison (sans surge pricing, pour affichage préalable).

**Rôle requis :** `client`

**Rate limit :** 30 req/min

**Body :**
```json
{
  "merchant_latitude": 12.3714,
  "merchant_longitude": -1.5197,
  "delivery_latitude": 12.3900,
  "delivery_longitude": -1.5100
}
```

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "estimated_fee": 730,
    "min_fee": 730,
    "max_fee": 949,
    "is_surge_active": true,
    "surge_name": "Déjeuner semaine",
    "distance_km": 3.85,
    "estimated_duration_minutes": 12,
    "route_source": "osrm"
  }
}
```

---

## 2. Calcul des frais définitifs

### `POST /api/delivery/calculate`

Calcule les frais de livraison définitifs avec surge pricing actif.

**Rôle requis :** `client`

**Rate limit :** 30 req/min

**Body :** Identique à `/estimate`

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "delivery_fee": 949,
    "base_fee": 250,
    "distance_fee": 462,
    "distance_km": 3.85,
    "surge_multiplier": 1.3,
    "surge_name": "Déjeuner semaine",
    "is_surge_active": true,
    "surge_amount": 214,
    "surge_platform_share": 65,
    "surge_deliverer_share": 149,
    "min_guaranteed": 500,
    "min_guaranteed_applied": false,
    "breakdown": {
      "tier1_km": 3.85,
      "tier1_rate": 120,
      "tier1_amount": 462,
      "tier2_km": 0,
      "tier2_rate": 90,
      "tier2_amount": 0
    },
    "estimated_duration_minutes": 12,
    "route_geometry": { "type": "LineString", "coordinates": [...] },
    "route_source": "osrm"
  }
}
```

---

## 3. Statut du surge pricing

### `GET /api/delivery/surge`

Récupère le multiplicateur de surge actif.

**Rôle requis :** Tout utilisateur authentifié

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "multiplier": 1.3,
    "surge_name": "Déjeuner semaine",
    "is_surge_active": true
  }
}
```

---

## 4. Assignation d'un livreur

### `POST /api/delivery/assign`

Initie l'assignation d'un livreur à une commande.

**Rôle requis :** `admin` ou `merchant`

**Rate limit :** 20 req/min

**Body :**
```json
{
  "order_id": "uuid",
  "merchant_latitude": 12.3714,
  "merchant_longitude": -1.5197
}
```

**Réponse 201 :**
```json
{
  "success": true,
  "data": {
    "assignment": {
      "id": "uuid",
      "order_id": "uuid",
      "deliverer_id": "uuid",
      "status": "proposed",
      "distance_to_merchant": 1.5,
      "estimated_pickup_time": 5,
      "expires_at": "2024-01-01T12:01:00Z"
    },
    "deliverer": {
      "id": "uuid",
      "distance_km": 1.5,
      "estimated_pickup_minutes": 5
    },
    "round": 1,
    "expires_at": "2024-01-01T12:01:00Z"
  }
}
```

---

## 5. Accepter/Rejeter une assignation

### `POST /api/delivery/assignments/:assignmentId/accept`

Le livreur accepte une proposition de course.

**Rôle requis :** `deliverer`

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "assignment": { "id": "uuid", "status": "accepted" },
    "order_id": "uuid",
    "message": "Delivery assignment accepted"
  }
}
```

### `POST /api/delivery/assignments/:assignmentId/reject`

Le livreur rejette une proposition.

**Rôle requis :** `deliverer`

**Body (optionnel) :**
```json
{
  "reason": "Trop loin"
}
```

---

## 6. Assignations actives

### `GET /api/delivery/assignments/active`

Récupère les propositions de course en attente pour le livreur connecté.

**Rôle requis :** `deliverer`

---

## 7. Mise à jour de position

### `PUT /api/delivery/location`

Met à jour la position GPS du livreur.

**Rôle requis :** `deliverer`

**Rate limit :** 120 req/min

**Body :**
```json
{
  "latitude": 12.3714,
  "longitude": -1.5197,
  "heading": 180,
  "speed": 25.5,
  "accuracy": 10
}
```

---

## 8. Mise à jour de disponibilité

### `PUT /api/delivery/availability`

Change le statut du livreur (online/busy/offline).

**Rôle requis :** `deliverer`

**Body :**
```json
{
  "availability": "online"
}
```

---

## 9. Événement de tracking

### `POST /api/delivery/tracking/event`

Enregistre un événement de suivi de livraison.

**Rôle requis :** `deliverer`

**Body :**
```json
{
  "order_id": "uuid",
  "event_type": "order_picked_up",
  "latitude": 12.3714,
  "longitude": -1.5197,
  "metadata": {}
}
```

**Types d'événements valides :**
- `location_update`
- `pickup_started`
- `arrived_at_merchant`
- `order_picked_up` → Passe la commande en statut `picked_up`
- `delivery_started` → Passe la commande en statut `in_delivery`
- `arrived_at_client`
- `order_delivered` → Passe la commande en statut `delivered`
- `delivery_issue`

---

## 10. Historique de tracking

### `GET /api/delivery/tracking/:orderId`

Récupère l'historique complet des événements de tracking d'une commande.

**Rôle requis :** Partie de la commande (client, marchand, livreur) ou admin

---

## 11. Position du livreur

### `GET /api/delivery/position/:orderId`

Récupère la position actuelle du livreur assigné à une commande.

**Rôle requis :** Client ou marchand de la commande

**Réponse 200 :**
```json
{
  "success": true,
  "data": {
    "latitude": 12.3714,
    "longitude": -1.5197,
    "heading": 180,
    "speed": 25,
    "last_updated_at": "2024-01-01T12:00:00Z",
    "deliverer_id": "uuid",
    "is_stale": false,
    "age_seconds": 5
  }
}
```

---

## Codes d'erreur spécifiques Sprint 5

| Code | Signification |
|------|---------------|
| 400 | Coordonnées invalides ou données manquantes |
| 403 | Accès non autorisé (pas partie de la commande) |
| 404 | Commande ou assignation non trouvée |
| 409 | Conflit (commande déjà assignée, assignation expirée) |
| 410 | Assignation expirée |
| 422 | Distance de livraison dépassant le maximum (30 km) |
| 429 | Rate limit dépassé |

---

## Modèle de tarification

### Formule des frais de livraison

```
delivery_fee = max(
  (base_fee + distance_fee) × surge_multiplier,
  min_guaranteed
)
```

### Paliers de distance

| Palier | Distance | Tarif |
|--------|----------|-------|
| 1 | 0 – 5 km | 120 FCFA/km |
| 2 | > 5 km | 90 FCFA/km |

### Paramètres

| Paramètre | Valeur par défaut |
|-----------|-------------------|
| Base fixe | 250 FCFA |
| Minimum garanti livreur | 500 FCFA |
| Surge max | ×3.0 |
| Part plateforme du surge | 30% |
| Part livreur du surge | 70% |
