# Sprint 10 — Optimisation, Monitoring, Tests E2E & Déploiement Production

## Vue d'ensemble

Le Sprint 10 finalise Hil_Delivre v4 avec les optimisations de performance, le monitoring avancé, les tests end-to-end complets et la documentation de déploiement production. C'est le sprint de **mise en production**.

---

## Fonctionnalités implémentées

| # | Fonctionnalité | Description |
|---|----------------|-------------|
| 1 | **Cache Redis** | Cache multi-namespace avec circuit breaker, TTL configurables, invalidation par pattern |
| 2 | **Pagination curseur** | Remplacement de la pagination offset par curseur pour les grandes listes |
| 3 | **Export CSV** | Exports asynchrones avec anonymisation CIL, rate limit, expiration automatique |
| 4 | **Health checks** | Vérification approfondie de tous les services (PostgreSQL, Redis, OSRM, Socket.IO, mémoire, disque) |
| 5 | **Métriques Prometheus** | Instrumentation complète (HTTP, business, infrastructure) au format OpenMetrics |
| 6 | **Cron jobs** | Calcul daily stats, cleanup OTP/exports, health check périodique, cache warmup |
| 7 | **Cartographie temps réel** | Viewport filtering, delta updates, clustering côté client |
| 8 | **Monitoring complet** | Prometheus + Grafana + AlertManager + Sentry + Logtail |
| 9 | **Tests E2E** | Backend (auth, orders, admin) + Mobile (Detox) |
| 10 | **Déploiement** | Docker multi-stage, ECS Fargate, CI/CD GitHub Actions, Terraform IaC |

---

## Architecture

```
Sprint 10
├── database/
│   └── schema_sprint10.sql                    # Migration SQL (3 tables, 2 enums, 3 fonctions, 4 index)
├── backend/
│   ├── Dockerfile                             # Multi-stage build production
│   ├── .dockerignore                          # Exclusions Docker
│   └── src/
│       ├── services/
│       │   ├── cacheService.js                # Cache Redis multi-namespace + circuit breaker
│       │   ├── exportService.js               # Export CSV asynchrone + anonymisation CIL
│       │   ├── healthService.js               # Health checks approfondis
│       │   ├── metricsService.js              # Métriques Prometheus (prom-client)
│       │   ├── cronService.js                 # Jobs planifiés (node-cron)
│       │   └── realtimeMapService.js          # Cartographie temps réel optimisée
│       ├── controllers/
│       │   └── monitoringController.js        # 11 handlers d'endpoints
│       ├── routes/
│       │   └── monitoringRoutes.js            # 11 routes monitoring
│       ├── middlewares/
│       │   ├── validationSprint10.js          # Schémas Joi (6 schémas)
│       │   ├── cacheMiddleware.js             # Cache HTTP (ETag, Cache-Control)
│       │   └── cursorPagination.js            # Pagination par curseur
│       └── __tests__/
│           ├── monitoring.test.js             # Tests unitaires monitoring
│           ├── cache.test.js                  # Tests unitaires cache
│           └── e2e/
│               ├── authFlow.test.js           # E2E authentification
│               ├── orderFlow.test.js          # E2E commandes
│               └── adminFlow.test.js          # E2E administration
├── apps/mobile/
│   ├── screens/client/
│   │   └── RealtimeMapScreen.js              # Carte temps réel optimisée
│   └── __tests__/e2e/
│       └── orderFlow.e2e.js                  # E2E mobile (Detox)
├── prometheus/
│   ├── prometheus.yml                        # Configuration Prometheus
│   └── rules/
│       └── alerts.yml                        # Règles d'alertes (critical, warning, info)
├── grafana/
│   └── provisioning/
│       ├── datasources/prometheus.yml        # Datasource Prometheus
│       └── dashboards/default.yml            # Provisioning dashboards
├── .github/workflows/
│   ├── ci.yml                                # CI (lint, tests, security, docker)
│   └── deploy-production.yml                 # CD (build, push, deploy ECS, verify)
├── docs/
│   ├── API_SPRINT10.md                       # Documentation API complète
│   ├── deployment.md                         # Guide de déploiement production
│   ├── monitoring.md                         # Guide de monitoring
│   └── security_checklist.md                 # Checklist sécurité pré-Go-Live
├── docker-compose.yml                        # Stack complète (dev/staging)
├── .env.example                              # Variables d'environnement
└── SPRINT10_README.md                        # Ce fichier
```

---

## Migration SQL

### Nouvelles tables

| Table | Description |
|-------|-------------|
| `health_check_history` | Historique des health checks avec résultats détaillés |
| `export_jobs` | Jobs d'export CSV avec statut, progression et URL du fichier |
| `cache_invalidation_log` | Journal des invalidations de cache (audit) |

### Nouvelles colonnes (existantes)

| Table | Colonne | Type | Description |
|-------|---------|------|-------------|
| `orders` | `cursor_id` | BIGSERIAL | ID séquentiel pour pagination curseur |
| `profiles_data` | `cursor_id` | BIGSERIAL | ID séquentiel pour pagination curseur |

### Fonctions PL/pgSQL

| Fonction | Description |
|----------|-------------|
| `calculate_daily_stats(date)` | Calcule et persiste les stats quotidiennes (améliorée) |
| `cleanup_expired_exports()` | Supprime les exports expirés (> 24h) |
| `cleanup_expired_otps()` | Supprime les OTP expirés |

### Index de performance

| Index | Table | Colonnes | Type |
|-------|-------|----------|------|
| `idx_orders_cursor` | orders | cursor_id | B-tree |
| `idx_orders_status_created` | orders | status, created_at | B-tree |
| `idx_profiles_cursor` | profiles_data | cursor_id | B-tree |
| `idx_export_jobs_admin` | export_jobs | admin_id, created_at | B-tree |

### Exécution

```bash
psql $DATABASE_URL < database/schema_sprint10.sql
```

---

## Services Backend

### cacheService.js — Cache Redis multi-namespace

| Fonction | Description |
|----------|-------------|
| `get(key)` | Récupère une valeur du cache (avec circuit breaker) |
| `set(key, value, ttl?)` | Stocke une valeur avec TTL auto-détecté par namespace |
| `del(key)` | Supprime une clé |
| `getOrSet(key, fetchFn, ttl?)` | Cache-aside pattern (get ou fetch + set) |
| `invalidatePattern(pattern)` | Invalide toutes les clés correspondant au pattern |
| `flush(adminId, reason)` | Vide tout le cache (action auditée) |
| `getStats()` | Retourne hit/miss/ratio/circuit state |

**Namespaces et TTL :**

| Namespace | TTL | Usage |
|-----------|-----|-------|
| `dashboard:` | 60s | Métriques dashboard admin |
| `user:` | 300s | Profils utilisateurs |
| `menu:` | 600s | Menus des restaurants |
| `order:` | 120s | Détails de commandes |
| `delivery:` | 30s | Positions des livreurs |
| `stats:` | 3600s | Statistiques historiques |

**Circuit Breaker :**
- Seuil : 5 échecs consécutifs → circuit OPEN
- Timeout : 30 secondes → circuit HALF-OPEN
- Succès en HALF-OPEN → circuit CLOSED

---

### exportService.js — Export CSV asynchrone

| Fonction | Description |
|----------|-------------|
| `createExportJob(adminId, type, filters)` | Crée un job d'export |
| `processExportJob(jobId)` | Traite le job (génération CSV) |
| `getExportJobs(adminId, options)` | Liste les jobs d'un admin |
| `getExportJob(jobId)` | Détail d'un job |
| `deleteExportJob(jobId)` | Supprime un job et son fichier |
| `cleanupExpiredExports()` | Nettoyage automatique des exports expirés |

**Types d'export :** `orders`, `users`, `reconciliations`, `payouts`, `stats`

**Sécurité :**
- Anonymisation CIL des données personnelles dans les exports
- Rate limit : 5 exports/heure par admin
- Expiration automatique : 24h
- Fichiers signés (URL temporaire Supabase Storage)

---

### healthService.js — Health checks approfondis

| Fonction | Description |
|----------|-------------|
| `checkPostgreSQL()` | Vérifie la connectivité et la latence PostgreSQL |
| `checkRedis()` | Vérifie la connectivité Redis (PING) |
| `checkOSRM()` | Vérifie la disponibilité du service OSRM |
| `checkSocketIO()` | Vérifie les connexions Socket.IO actives |
| `checkMemory()` | Vérifie l'utilisation mémoire du processus |
| `checkDisk()` | Vérifie l'espace disque disponible |
| `runAllChecks()` | Exécute tous les checks en parallèle |

**Statuts :** `healthy` | `degraded` | `unhealthy`

**Logique d'agrégation :**
- Si un service critique (PostgreSQL) est unhealthy → statut global `unhealthy`
- Si un service non-critique (Redis, OSRM) est unhealthy → statut global `degraded`
- Si tous les services sont healthy → statut global `healthy`

---

### metricsService.js — Métriques Prometheus

| Catégorie | Métriques |
|-----------|-----------|
| HTTP | `http_requests_total`, `http_request_duration_seconds` |
| Business | `orders_created_total`, `payments_processed_total`, `deliveries_completed_total` |
| Infrastructure | `active_orders`, `online_deliverers`, `connected_sockets` |
| Cache | `cache_hit_ratio` |
| Errors | `errors_total` |
| Notifications | `notifications_sent_total` |

**Middleware Express :** Instrumentation automatique de toutes les requêtes HTTP.

---

### cronService.js — Jobs planifiés

| Job | Schedule | Description |
|-----|----------|-------------|
| `daily_stats` | `0 1 * * *` | Calcul des stats quotidiennes (1h du matin) |
| `health_check` | `*/5 * * * *` | Health check toutes les 5 minutes |
| `cleanup_otp` | `0 * * * *` | Nettoyage OTP expirés (toutes les heures) |
| `cleanup_exports` | `0 */6 * * *` | Nettoyage exports expirés (toutes les 6h) |
| `cache_warmup` | `*/5 * * * *` | Pré-chargement du cache dashboard (5 min) |

**Fonctionnalités :**
- Activation/désactivation par variable d'environnement
- Déclenchement manuel via endpoint admin
- Logging de chaque exécution
- Protection contre les exécutions concurrentes (lock)

---

### realtimeMapService.js — Cartographie temps réel

| Fonction | Description |
|----------|-------------|
| `registerViewport(socketId, bounds)` | Enregistre le viewport d'un client |
| `unregisterViewport(socketId)` | Désenregistre un viewport |
| `updateDelivererPosition(data)` | Met à jour la position d'un livreur |
| `getDeliverersInBounds(bounds)` | Récupère les livreurs dans un rectangle |
| `broadcastToViewports(delivererId, data)` | Envoie les mises à jour aux clients concernés |

**Optimisations :**
- Viewport filtering : seuls les clients dont le viewport contient le livreur reçoivent la mise à jour
- Delta updates : seules les positions modifiées sont envoyées
- Throttling : maximum 1 update/5s par livreur
- Cleanup automatique des viewports inactifs

---

## Endpoints API (11 routes)

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/api/monitoring/health` | Public | Health check simplifié (ALB) |
| GET | `/api/monitoring/health/detailed` | Admin | Health check détaillé |
| GET | `/api/monitoring/health/:service` | Admin | Health check d'un service |
| GET | `/api/monitoring/metrics` | Token | Métriques Prometheus (text) |
| GET | `/api/monitoring/metrics/json` | Admin | Métriques format JSON |
| POST | `/api/monitoring/exports` | Admin | Créer un export CSV |
| GET | `/api/monitoring/exports` | Admin | Lister les exports |
| GET | `/api/monitoring/exports/:jobId` | Admin | Détail d'un export |
| DELETE | `/api/monitoring/exports/:jobId` | Admin | Supprimer un export |
| GET | `/api/monitoring/cache/stats` | Admin | Stats du cache Redis |
| POST | `/api/monitoring/cache/invalidate` | Admin | Invalider des clés cache |
| POST | `/api/monitoring/cache/flush` | Admin | Vider tout le cache |

---

## Middlewares

### cacheMiddleware.js

- **ETag** : Génération automatique d'ETag (hash MD5 du body)
- **Cache-Control** : Headers configurables par route
- **Conditional requests** : Support `If-None-Match` (304 Not Modified)

### cursorPagination.js

- **Encodage** : Curseur Base64 (opaque pour le client)
- **Décodage** : Extraction du cursor_id pour la requête SQL
- **Validation** : Vérification du format et de l'intégrité
- **Limite** : Maximum 100 éléments par page

---

## Mobile

### RealtimeMapScreen.js

| Fonctionnalité | Description |
|----------------|-------------|
| Carte MapView | react-native-maps avec provider par défaut |
| Position utilisateur | Suivi continu avec seuil de mouvement (10m) |
| Livreurs temps réel | Delta updates via Socket.IO |
| Clustering | Regroupement automatique selon le niveau de zoom |
| Viewport filtering | Envoi du viewport au serveur pour optimiser les données |
| Légende | Statuts des livreurs (disponible, en course) |
| Statut connexion | Indicateur visuel de l'état Socket.IO |
| Nettoyage auto | Suppression des livreurs offline (> 2 min sans update) |

---

## Tests

### Tests unitaires (backend)

```bash
# Tous les tests
npm test

# Tests monitoring uniquement
npm test -- --testPathPattern="monitoring"

# Tests cache uniquement
npm test -- --testPathPattern="cache"

# Avec couverture
npm test -- --coverage
```

### Tests E2E (backend)

```bash
# Tous les tests E2E
npm run test:e2e

# Auth flow
npm run test:e2e -- --testPathPattern="authFlow"

# Order flow
npm run test:e2e -- --testPathPattern="orderFlow"

# Admin flow
npm run test:e2e -- --testPathPattern="adminFlow"
```

### Tests E2E (mobile - Detox)

```bash
# Build pour iOS
npx detox build --configuration ios.sim.release

# Exécuter les tests
npx detox test --configuration ios.sim.release

# Build pour Android
npx detox build --configuration android.emu.release

# Exécuter les tests
npx detox test --configuration android.emu.release
```

**Couverture totale : 50+ tests** (25 unitaires + 15 E2E backend + 10 E2E mobile)

---

## Docker & Déploiement

### Développement local

```bash
# Démarrer la stack complète
docker-compose up -d

# Vérifier les services
docker-compose ps

# Voir les logs
docker-compose logs -f api

# Accéder à Grafana
open http://localhost:3001
```

### Production (ECS Fargate)

```bash
# Build et push
docker build -t hil-delivre-api:v4.10.0 backend/
docker tag hil-delivre-api:v4.10.0 <ECR_URI>:v4.10.0
docker push <ECR_URI>:v4.10.0

# Déployer via tag Git (déclenche le CI/CD)
git tag v4.10.0
git push origin v4.10.0
```

Voir `docs/deployment.md` pour le guide complet.

---

## Monitoring

### Accès

| Service | URL | Credentials |
|---------|-----|-------------|
| Grafana | http://localhost:3001 | admin / (voir .env) |
| Prometheus | http://localhost:9090 | — |
| API Health | http://localhost:3000/api/monitoring/health | — |
| API Metrics | http://localhost:3000/api/monitoring/metrics | Token |

### Alertes configurées

- **6 alertes critiques** : API down, DB down, Redis down, error rate, payment failures, disk full
- **8 alertes warning** : latence, cache miss, mémoire, sockets, livreurs, temps livraison, Redis memory, disk
- **3 alertes info** : cash balance, KYC pending, new deployment

Voir `docs/monitoring.md` pour le guide complet.

---

## Sécurité

### Mesures implémentées

| Catégorie | Mesure |
|-----------|--------|
| Auth | JWT + RBAC strict sur tous les endpoints |
| Cache | Circuit breaker (pas de crash si Redis down) |
| Export | Anonymisation CIL, rate limit, expiration auto |
| Health | Endpoint public minimal (pas d'info sensible) |
| Metrics | Token dédié Prometheus (séparé du JWT) |
| Docker | Utilisateur non-root, dumb-init, health check |
| CI/CD | Scan Trivy, npm audit, tests obligatoires |
| Secrets | AWS Parameter Store (SecureString) |
| Réseau | VPC privé, TLS 1.2+, HSTS, WAF |
| Audit | Toutes les actions admin loggées |

Voir `docs/security_checklist.md` pour la checklist complète (70+ contrôles).

---

## Dépendances ajoutées

| Package | Version | Usage |
|---------|---------|-------|
| `ioredis` | ^5.3.0 | Client Redis |
| `prom-client` | ^15.1.0 | Métriques Prometheus |
| `node-cron` | ^3.0.3 | Jobs planifiés |
| `csv-stringify` | ^6.4.0 | Génération CSV |
| `etag` | ^1.8.1 | Génération ETag |

---

## Configuration requise

### Variables d'environnement (nouvelles)

| Variable | Description | Obligatoire |
|----------|-------------|-------------|
| `REDIS_URL` | URL de connexion Redis | Oui |
| `PROMETHEUS_METRICS_TOKEN` | Token d'accès aux métriques | Oui |
| `SENTRY_DSN` | DSN Sentry pour le tracking d'erreurs | Oui (prod) |
| `CACHE_TTL_*` | TTL par namespace (secondes) | Non (défauts) |
| `EXPORT_MAX_ROWS` | Limite de lignes par export | Non (50000) |
| `CRON_DISABLE_*` | Désactivation individuelle des crons | Non (false) |
| `CASH_ALERT_THRESHOLD` | Seuil d'alerte cash (FCFA) | Non (500000) |

---

## Points d'attention pour la production

### Avant le Go-Live

- [ ] Exécuter la migration SQL sur la base de production
- [ ] Configurer Redis (ElastiCache) avec auth token
- [ ] Configurer les variables d'environnement dans Parameter Store
- [ ] Valider la checklist de sécurité (`docs/security_checklist.md`)
- [ ] Configurer Prometheus + Grafana + AlertManager
- [ ] Configurer Sentry (DSN + alertes)
- [ ] Tester le pipeline CI/CD sur staging
- [ ] Valider les health checks depuis l'ALB
- [ ] Configurer les alertes Slack/PagerDuty
- [ ] Activer le 2FA pour tous les comptes admin

### Après le Go-Live

- [ ] Monitorer le cache hit ratio (objectif > 80%)
- [ ] Vérifier que les cron jobs s'exécutent correctement
- [ ] Valider les alertes en condition réelle
- [ ] Planifier un pen test externe (J+30)
- [ ] Documenter les runbooks spécifiques au contexte
- [ ] Configurer les webhooks PayDunya pour les payouts automatiques

---

## Récapitulatif des sprints

| Sprint | Thème | Statut |
|--------|-------|--------|
| 1 | Infrastructure & Setup | ✅ Livré |
| 2 | Authentification & Profils | ✅ Livré |
| 3 | Catalogue & Commandes | ✅ Livré |
| 4 | Paiements (Mobile Money + Cash) | ✅ Livré |
| 5 | Livraison & Géolocalisation | ✅ Livré |
| 6 | Notifications (Push, SMS, In-app) | ✅ Livré |
| 7 | Panel Admin & Réconciliation | ✅ Livré |
| 8 | Abonnements marchands | ✅ Livré |
| 9 | Évaluations & Avis | ✅ Livré |
| **10** | **Optimisation, Monitoring & Déploiement** | **✅ Livré** |

---

## Conclusion

Le Sprint 10 marque la finalisation de Hil_Delivre v4. L'application est désormais prête pour la production avec :

- **Performance** : Cache Redis, pagination curseur, viewport filtering
- **Observabilité** : Prometheus, Grafana, Sentry, alertes multi-niveaux
- **Fiabilité** : Health checks, circuit breakers, graceful shutdown
- **Sécurité** : 70+ contrôles validés, audit complet, conformité CIL/DGI
- **Automatisation** : CI/CD complet, cron jobs, cleanup automatique
- **Scalabilité** : ECS Fargate auto-scaling, Redis cluster, architecture stateless
