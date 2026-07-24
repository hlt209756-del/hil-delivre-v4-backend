# Sprint 5 — Livraison : Géolocalisation, OSRM, Assignation, Surge Pricing

## Vue d'ensemble

Le Sprint 5 implémente le système complet de livraison pour Hil_Delivre v4 :

- **Calcul de distance** via OSRM (Open Source Routing Machine) avec fallback Haversine
- **Tarification dégressive** par paliers de distance + minimum garanti livreur
- **Surge pricing** dynamique (créneaux horaires + ratio demande/offre)
- **Assignation intelligente** des livreurs par proximité géographique (rounds)
- **Géolocalisation temps réel** des livreurs (PostGIS)
- **Tracking de livraison** avec événements et effets de bord automatiques

---

## Architecture

```
Sprint 5
├── database/
│   └── schema_sprint5.sql          # Migration SQL (PostGIS, 4 tables, 1 fonction)
├── backend/src/
│   ├── services/
│   │   ├── osrmService.js          # Calcul distance/durée OSRM + cache + fallback
│   │   ├── deliveryFeeService.js   # Tarification dégressive + surge pricing
│   │   ├── deliveryAssignmentService.js  # Matching livreurs + rounds
│   │   └── geolocationService.js   # Position, disponibilité, tracking
│   ├── controllers/
│   │   └── deliveryController.js   # 12 handlers d'endpoints
│   ├── routes/
│   │   └── deliveryRoutes.js       # 11 routes avec RBAC + rate limiting
│   ├── middlewares/
│   │   └── validationSprint5.js    # 8 schémas Joi
│   └── __tests__/
│       ├── delivery.test.js        # 20+ tests d'intégration
│       └── osrm.test.js            # Tests unitaires Haversine
├── apps/mobile/
│   ├── services/
│   │   └── deliveryService.js      # Client API mobile
│   └── screens/
│       ├── client/
│       │   └── DeliveryTrackingScreen.js  # Suivi temps réel (carte)
│       └── deliverer/
│           └── DelivererDashboardScreen.js # Dashboard livreur
├── docs/
│   └── API_SPRINT5.md             # Documentation API complète
├── .env.example                    # Variables d'environnement
└── SPRINT5_README.md              # Ce fichier
```

---

## Migration SQL

### Nouvelles tables

| Table | Description |
|-------|-------------|
| `deliverer_locations` | Position GPS temps réel des livreurs (PostGIS GEOGRAPHY) |
| `delivery_assignments` | Historique des propositions de course (rounds) |
| `delivery_zones` | Zones géographiques avec tarification spécifique |
| `surge_pricing_config` | Configuration du surge par créneaux horaires |
| `delivery_tracking_events` | Événements de suivi de livraison |

### Colonnes ajoutées à `orders`

| Colonne | Type | Description |
|---------|------|-------------|
| `delivery_distance_km` | NUMERIC(8,2) | Distance calculée par OSRM |
| `estimated_delivery_minutes` | INTEGER | Durée estimée |
| `merchant_latitude` | NUMERIC(10,7) | GPS marchand |
| `merchant_longitude` | NUMERIC(10,7) | GPS marchand |
| `delivery_latitude` | NUMERIC(10,7) | GPS livraison |
| `delivery_longitude` | NUMERIC(10,7) | GPS livraison |
| `surge_multiplier` | NUMERIC(3,2) | Multiplicateur appliqué |
| `picked_up_at` | TIMESTAMPTZ | Heure de pickup |
| `delivered_at` | TIMESTAMPTZ | Heure de livraison |

### Fonction PostGIS

```sql
find_nearest_deliverers(p_latitude, p_longitude, p_radius_km, p_limit)
```

Recherche les livreurs en ligne dans un rayon donné, triés par distance.

### Exécution

```bash
psql $DATABASE_URL < database/schema_sprint5.sql
```

---

## Services Backend

### osrmService.js

| Fonction | Description |
|----------|-------------|
| `calculateRoute(origin, destination)` | Calcule distance/durée via OSRM avec cache et fallback |
| `calculateDistanceMatrix(origin, destinations)` | Matrice de distances (pour matching livreurs) |
| `haversineDistance(lat1, lng1, lat2, lng2)` | Calcul à vol d'oiseau (fallback) |
| `clearCache()` | Vide le cache des routes |

**Caractéristiques :**
- Cache en mémoire (TTL 10 min, max 1000 entrées)
- Facteur de correction Ouagadougou (distance ×1.15, durée ×1.30)
- Timeout 10s avec AbortController
- Fallback automatique Haversine si OSRM indisponible

### deliveryFeeService.js

| Fonction | Description |
|----------|-------------|
| `calculateDeliveryFee(distanceKm, options)` | Calcul complet avec surge |
| `estimateDeliveryFee(distanceKm)` | Estimation sans surge (affichage) |
| `getCurrentSurgeMultiplier()` | Multiplicateur actif |

**Tarification :**
- Base fixe : 250 FCFA
- 0-5 km : 120 FCFA/km
- >5 km : 90 FCFA/km (dégressif)
- Minimum garanti : 500 FCFA
- Surge : ×1.0 à ×3.0

### deliveryAssignmentService.js

| Fonction | Description |
|----------|-------------|
| `proposeDelivery(orderId, merchantLocation, round)` | Propose la course au plus proche |
| `acceptAssignment(assignmentId, delivererId)` | Acceptation + mise à jour commande |
| `rejectAssignment(assignmentId, delivererId, reason)` | Rejet + round suivant |
| `expireStaleAssignments()` | Expire les propositions périmées |
| `getActiveAssignments(delivererId)` | Propositions en attente |

**Algorithme d'assignation :**
1. Recherche livreurs online dans un rayon de 5 km (PostGIS)
2. Filtrage : KYC approuvé, non déjà sollicité
3. Proposition au plus proche (timeout 60s)
4. Si rejet/expiration → round suivant (rayon élargi à 10 km)
5. Max 3 rounds, puis notification admin

### geolocationService.js

| Fonction | Description |
|----------|-------------|
| `updateDelivererLocation(delivererId, location)` | Mise à jour GPS (throttled 5s) |
| `updateAvailability(delivererId, availability)` | Toggle online/busy/offline |
| `recordTrackingEvent(orderId, delivererId, eventType, location, metadata)` | Événement de suivi |
| `getTrackingHistory(orderId, userId)` | Historique de tracking |
| `getDelivererPosition(orderId, userId)` | Position actuelle du livreur |

**Événements de tracking avec effets de bord :**
- `order_picked_up` → Commande passe en `picked_up`
- `delivery_started` → Commande passe en `in_delivery`
- `order_delivered` → Commande passe en `delivered` + livreur libéré

---

## Endpoints API

| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| POST | `/api/delivery/estimate` | client | Estimation frais (sans surge) |
| POST | `/api/delivery/calculate` | client | Calcul frais (avec surge) |
| GET | `/api/delivery/surge` | * | Statut surge actuel |
| POST | `/api/delivery/assign` | admin/merchant | Initier assignation |
| GET | `/api/delivery/assignments/active` | deliverer | Propositions en attente |
| POST | `/api/delivery/assignments/:id/accept` | deliverer | Accepter course |
| POST | `/api/delivery/assignments/:id/reject` | deliverer | Rejeter course |
| PUT | `/api/delivery/location` | deliverer | Mise à jour GPS |
| PUT | `/api/delivery/availability` | deliverer | Toggle disponibilité |
| POST | `/api/delivery/tracking/event` | deliverer | Événement de tracking |
| GET | `/api/delivery/tracking/:orderId` | parties | Historique tracking |
| GET | `/api/delivery/position/:orderId` | client/merchant | Position livreur |

---

## Sécurité

### RBAC strict

- Seuls les **livreurs** peuvent mettre à jour leur position et accepter/rejeter des courses
- Seuls les **clients** peuvent estimer/calculer les frais
- Seuls les **admin/marchands** peuvent initier une assignation
- La position du livreur n'est visible que par les **parties de la commande**
- L'historique de tracking est protégé par vérification de propriété

### Rate Limiting

| Endpoint | Limite |
|----------|--------|
| Location update | 120 req/min |
| Estimation/Calcul | 30 req/min |
| Assignation | 20 req/min |

### PostGIS RLS

- Chaque table a des Row Level Security policies
- Le livreur ne voit que sa propre position
- Les parties de la commande voient la position du livreur assigné
- L'admin voit tout

### Throttling GPS

- Minimum 5 secondes entre deux mises à jour de position
- Côté mobile : minimum 20m de déplacement pour déclencher un update

### Validation

- Toutes les coordonnées GPS validées (lat: -90/+90, lng: -180/+180)
- UUIDs validés par regex
- Types d'événements validés par whitelist
- Statuts de disponibilité validés par enum

---

## Mobile

### DeliveryTrackingScreen (Client)

- Carte MapView avec position du livreur en temps réel
- Marqueurs : livreur (orange), restaurant (bleu), destination (vert)
- Étapes de livraison avec progression visuelle
- ETA calculé dynamiquement
- Polling toutes les 5 secondes
- Détection de position obsolète (>2 min)

### DelivererDashboardScreen (Livreur)

- Toggle online/offline avec mise à jour de disponibilité
- Tracking GPS en arrière-plan (expo-location)
- Liste des propositions de course avec distance et gains
- Vibration à la réception d'une nouvelle course
- Actions : Accepter, Refuser, Récupérée, Livrée
- Polling des assignations toutes les 10 secondes

---

## Intégration avec les Sprints précédents

### Sprint 3 (Commandes)
- Les colonnes GPS sont ajoutées à la table `orders`
- Les transitions de statut `picked_up` → `in_delivery` → `delivered` sont gérées par les événements de tracking

### Sprint 4 (Paiement)
- Le `delivery_fee` calculé par ce sprint est intégré dans le `total_amount` de la commande
- Le `surge_multiplier` est stocké pour la facturation FEC

---

## Configuration

### Variables d'environnement (nouvelles)

```env
OSRM_BASE_URL=https://router.project-osrm.org
DELIVERY_SEARCH_RADIUS_KM=5
DELIVERY_EXPANDED_RADIUS_KM=10
DELIVERY_ASSIGNMENT_TIMEOUT_S=60
DELIVERY_MAX_ROUNDS=3
DELIVERY_MAX_DISTANCE_KM=30
```

### Paramètres plateforme (table `platform_config`)

Les taux de livraison sont configurables via la table `platform_config` (Sprint 4) :

| Clé | Valeur par défaut |
|-----|-------------------|
| `delivery_base_fee` | 250 |
| `delivery_rate_per_km_tier1` | 120 |
| `delivery_rate_per_km_tier2` | 90 |
| `delivery_tier1_max_km` | 5 |
| `delivery_min_guaranteed` | 500 |
| `surge_platform_share` | 0.30 |

---

## Tests

```bash
# Exécuter tous les tests Sprint 5
npm test -- --testPathPattern="(delivery|osrm)"

# Tests d'intégration uniquement
npm test -- backend/src/__tests__/delivery.test.js

# Tests unitaires OSRM
npm test -- backend/src/__tests__/osrm.test.js
```

**Couverture :** 20+ tests d'intégration + tests unitaires

---

## Points d'attention pour les sprints suivants

1. **Sprint 6 (Notifications)** : Ajouter les notifications push (FCM) lors de :
   - Nouvelle proposition de course au livreur
   - Acceptation par le livreur → notification client + marchand
   - Arrivée du livreur au restaurant
   - Livraison effectuée

2. **Sprint 7 (Admin)** : Dashboard admin avec :
   - Carte des livreurs en temps réel
   - Statistiques de livraison (temps moyen, distance moyenne)
   - Gestion des zones et du surge pricing

3. **Socket.IO (Sprint 6)** : Remplacer le polling par des WebSockets pour :
   - Position du livreur en temps réel
   - Notifications instantanées d'assignation
   - Mises à jour de statut de commande

4. **OSRM self-hosted** : En production, déployer une instance OSRM avec les données OSM du Burkina Faso pour :
   - Fiabilité (pas de dépendance au serveur public)
   - Performance (latence réduite)
   - Données à jour

5. **Réconciliation cash livreur** (Sprint 7) : Le livreur collecte le cash et doit le reverser à la plateforme.

---

## Dépendances ajoutées

### Backend
```json
{
  "express-rate-limit": "^7.x",
  "joi": "^17.x"
}
```

### Mobile
```json
{
  "expo-location": "^17.x",
  "react-native-maps": "^1.x",
  "@react-navigation/native": "^6.x"
}
```

### Base de données
- Extension PostGIS (activée par défaut dans Supabase)

---

## Seed Data

La migration inclut des données de seed pour :
- 3 zones de livraison (Ouagadougou centre, périphérie, Bobo-Dioulasso)
- 4 créneaux de surge pricing (déjeuner/dîner semaine, weekend midi/soir)
