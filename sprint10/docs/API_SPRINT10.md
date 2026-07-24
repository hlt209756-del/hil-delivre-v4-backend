# Documentation API — Sprint 10

## Vue d'ensemble

Le Sprint 10 ajoute 11 endpoints de monitoring, exports et gestion du cache, tous protégés par authentification JWT et rôle admin (sauf le health check public et l'endpoint Prometheus).

**Base URL** : `https://api.hildelivre.bf`

---

## Authentification

Toutes les routes admin nécessitent un header `Authorization: Bearer <jwt_token>` avec un utilisateur ayant le rôle `admin`.

L'endpoint `/metrics` utilise un token Prometheus dédié (variable `PROMETHEUS_METRICS_TOKEN`).

---

## Endpoints

### Health Checks

#### GET /api/monitoring/health

Health check public simplifié pour les load balancers. Pas d'authentification requise.

**Response 200:**
```json
{
  "success": true,
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "4.10.0"
}
```

---

#### GET /api/monitoring/health/detailed

Health check détaillé de tous les services. **Admin uniquement.**

**Response 200:**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "uptime": 86400,
    "version": "4.10.0",
    "services": [
      {
        "service": "postgresql",
        "status": "healthy",
        "response_time_ms": 12
      },
      {
        "service": "redis",
        "status": "healthy",
        "response_time_ms": 3
      },
      {
        "service": "osrm",
        "status": "healthy",
        "response_time_ms": 45
      },
      {
        "service": "socketio",
        "status": "healthy",
        "response_time_ms": 1,
        "details": { "active_connections": 128 }
      },
      {
        "service": "memory",
        "status": "healthy",
        "details": { "heap_used_mb": 120, "heap_total_mb": 256, "usage_percent": 47 }
      }
    ]
  }
}
```

**Response 503 (unhealthy):**
```json
{
  "success": true,
  "data": {
    "status": "unhealthy",
    "services": [
      { "service": "postgresql", "status": "unhealthy", "details": { "error": "Connection refused" } }
    ]
  }
}
```

---

#### GET /api/monitoring/health/:service

Health check d'un service spécifique. **Admin uniquement.**

**Paramètres URL:**
| Param | Type | Valeurs acceptées |
|-------|------|-------------------|
| service | string | `postgresql`, `redis`, `osrm`, `socketio`, `disk`, `memory` |

**Response 200:**
```json
{
  "success": true,
  "data": {
    "service": "redis",
    "status": "healthy",
    "response_time_ms": 3,
    "details": { "version": "7.0.12", "connected_clients": 15 }
  }
}
```

---

### Métriques

#### GET /api/monitoring/metrics

Endpoint Prometheus (format text exposition). Protégé par token Prometheus.

**Headers:**
- `Authorization: Bearer <PROMETHEUS_METRICS_TOKEN>` ou query param `?token=<token>`

**Response 200 (text/plain):**
```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",route="/api/orders",status_code="200"} 1523
http_requests_total{method="POST",route="/api/orders",status_code="201"} 89
...
```

---

#### GET /api/monitoring/metrics/json

Métriques au format JSON pour le dashboard admin. **Admin uniquement.**

**Response 200:**
```json
{
  "success": true,
  "data": [
    { "name": "http_requests_total", "type": "counter", "values": [...] },
    { "name": "active_orders", "type": "gauge", "value": 42 }
  ]
}
```

---

### Exports CSV

#### POST /api/monitoring/exports

Crée un job d'export CSV asynchrone. **Admin uniquement.** Rate limit : 5/heure.

**Body:**
```json
{
  "export_type": "orders",
  "filters": {
    "start_date": "2024-01-01T00:00:00Z",
    "end_date": "2024-01-31T23:59:59Z",
    "status": "delivered"
  }
}
```

| Champ | Type | Requis | Valeurs |
|-------|------|--------|---------|
| export_type | string | Oui | `orders`, `users`, `reconciliations`, `payouts`, `stats` |
| filters | object | Non | Voir ci-dessous |
| filters.start_date | ISO date | Non | Date de début |
| filters.end_date | ISO date | Non | Date de fin |
| filters.status | string | Non | Filtre par statut |
| filters.role | string | Non | `client`, `merchant`, `delivery`, `admin` |

**Response 202:**
```json
{
  "success": true,
  "message": "Export initié avec succès. Le fichier sera disponible sous peu.",
  "data": {
    "job_id": "uuid",
    "status": "pending",
    "export_type": "orders",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Response 429 (rate limit):**
```json
{
  "success": false,
  "error": "Limite d'exports atteinte. Maximum 5 exports par heure."
}
```

---

#### GET /api/monitoring/exports

Liste les jobs d'export de l'admin connecté. **Admin uniquement.**

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | null | Filtre par statut |
| cursor | UUID | null | Curseur de pagination |
| limit | integer | 20 | Nombre de résultats (max 50) |

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "export_type": "orders",
      "status": "completed",
      "total_rows": 1523,
      "file_size_bytes": 245760,
      "file_url": "https://storage.supabase.co/...",
      "created_at": "2024-01-15T10:30:00.000Z",
      "completed_at": "2024-01-15T10:30:45.000Z",
      "expires_at": "2024-01-16T10:30:45.000Z"
    }
  ],
  "pagination": {
    "next_cursor": "base64_cursor",
    "has_more": true
  }
}
```

---

#### GET /api/monitoring/exports/:jobId

Détail d'un job d'export. **Admin uniquement.**

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "export_type": "orders",
    "status": "completed",
    "filters": { "start_date": "2024-01-01", "status": "delivered" },
    "total_rows": 1523,
    "file_size_bytes": 245760,
    "file_url": "https://storage.supabase.co/signed-url...",
    "started_at": "2024-01-15T10:30:01.000Z",
    "completed_at": "2024-01-15T10:30:45.000Z",
    "expires_at": "2024-01-16T10:30:45.000Z"
  }
}
```

---

#### DELETE /api/monitoring/exports/:jobId

Supprime un job d'export. **Admin uniquement.**

**Response 200:**
```json
{
  "success": true,
  "message": "Export supprimé avec succès."
}
```

---

### Cache Management

#### GET /api/monitoring/cache/stats

Statistiques du cache Redis. **Admin uniquement.**

**Response 200:**
```json
{
  "success": true,
  "data": {
    "hit_count": 15234,
    "miss_count": 2341,
    "hit_ratio": 0.87,
    "circuit_state": "CLOSED",
    "namespaces": {
      "dashboard:": { "ttl": 60 },
      "user:": { "ttl": 300 },
      "menu:": { "ttl": 600 },
      "order:": { "ttl": 120 },
      "delivery:": { "ttl": 30 },
      "stats:": { "ttl": 3600 }
    }
  }
}
```

---

#### POST /api/monitoring/cache/invalidate

Invalide les clés de cache correspondant à un pattern. **Admin uniquement.**

**Body:**
```json
{
  "pattern": "dashboard:*",
  "reason": "Refresh manuel des métriques après correction"
}
```

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| pattern | string | Oui | Pattern Redis (ex: `dashboard:*`, `user:uuid`) |
| reason | string | Non | Raison de l'invalidation (audit) |

**Response 200:**
```json
{
  "success": true,
  "message": "12 clé(s) de cache invalidée(s).",
  "data": { "invalidated_count": 12, "pattern": "dashboard:*" }
}
```

---

#### POST /api/monitoring/cache/flush

Vide entièrement le cache Redis. **Action critique. Admin uniquement.** Rate limit : 2/heure.

**Body:**
```json
{
  "confirm": "FLUSH_ALL_CACHE"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Cache vidé avec succès."
}
```

**Response 400 (sans confirmation):**
```json
{
  "success": false,
  "error": "Confirmation requise. Envoyez {\"confirm\": \"FLUSH_ALL_CACHE\"} pour confirmer."
}
```

---

## Codes d'erreur

| Code | Description |
|------|-------------|
| 400 | Données de requête invalides (validation Joi) |
| 401 | Token manquant ou invalide |
| 403 | Rôle insuffisant (admin requis) |
| 404 | Ressource non trouvée |
| 429 | Rate limit atteint |
| 500 | Erreur interne du serveur |
| 503 | Service indisponible (health check unhealthy) |

---

## Rate Limits

| Scope | Limite | Fenêtre |
|-------|--------|---------|
| Admin monitoring global | 120 requêtes | 1 minute |
| Exports CSV | 5 requêtes | 1 heure |
| Cache flush | 2 requêtes | 1 heure |
| Prometheus metrics | 60 requêtes | 1 minute |
