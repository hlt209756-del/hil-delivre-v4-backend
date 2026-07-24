# Guide de Monitoring — Hil_Delivre v4

## Vue d'ensemble

Ce guide détaille la configuration complète du monitoring de Hil_Delivre v4 en production, couvrant Prometheus, Grafana, Sentry, Logtail et les alertes.

---

## Architecture de monitoring

```
┌─────────────────────────────────────────────────────────────────┐
│                      Monitoring Stack                             │
│                                                                   │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────┐  │
│  │  Prometheus  │────►│   Grafana    │     │    Sentry      │  │
│  │  (Scraping)  │     │ (Dashboards) │     │ (Error Track)  │  │
│  └──────────────┘     └──────────────┘     └────────────────┘  │
│         │                                           │            │
│         ▼                                           ▼            │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────┐  │
│  │ AlertManager │────►│    Slack     │     │   Logtail      │  │
│  │              │     │  PagerDuty   │     │ (Log Aggreg.)  │  │
│  └──────────────┘     └──────────────┘     └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. Prometheus

### 1.1 Configuration

Voir `prometheus/prometheus.yml` pour la configuration complète.

### 1.2 Métriques collectées

| Catégorie | Métrique | Type | Description |
|-----------|----------|------|-------------|
| HTTP | `http_requests_total` | Counter | Total des requêtes HTTP |
| HTTP | `http_request_duration_seconds` | Histogram | Durée des requêtes |
| Business | `orders_created_total` | Counter | Commandes créées |
| Business | `payments_processed_total` | Counter | Paiements traités |
| Business | `deliveries_completed_total` | Counter | Livraisons terminées |
| Business | `active_orders` | Gauge | Commandes en cours |
| Infra | `online_deliverers` | Gauge | Livreurs connectés |
| Infra | `connected_sockets` | Gauge | Connexions Socket.IO |
| Cache | `cache_hit_ratio` | Gauge | Ratio hit/miss du cache |
| Errors | `errors_total` | Counter | Erreurs par type |

### 1.3 Scraping intervals

| Target | Interval | Timeout |
|--------|----------|---------|
| API Backend | 15s | 10s |
| Redis Exporter | 30s | 10s |
| Node Exporter | 30s | 10s |
| PostgreSQL Exporter | 60s | 15s |

---

## 2. Grafana Dashboards

### 2.1 Dashboard principal : Hil_Delivre Overview

Voir `grafana/dashboards/hil_delivre.json` pour la configuration importable.

**Panels inclus :**

1. **Commandes actives** (Gauge) — Nombre de commandes en cours
2. **Revenue du jour** (Stat) — Revenue cumulée en FCFA
3. **Taux de complétion** (Gauge) — % de commandes livrées vs créées
4. **Livreurs en ligne** (Gauge) — Nombre de livreurs connectés
5. **Requêtes/seconde** (Graph) — Débit HTTP
6. **Latence P95** (Graph) — 95e percentile de la durée des requêtes
7. **Erreurs/minute** (Graph) — Taux d'erreurs
8. **Top endpoints** (Table) — Endpoints les plus sollicités
9. **Paiements** (Graph) — Paiements par méthode (Mobile Money vs Cash)
10. **Cache hit ratio** (Gauge) — Performance du cache Redis
11. **Socket.IO connexions** (Graph) — Connexions temps réel
12. **Health status** (Status map) — État des services

### 2.2 Dashboard Business

- GMV quotidien/hebdomadaire/mensuel
- Panier moyen
- Top marchands par volume
- Top livreurs par performance
- Répartition géographique des commandes
- Taux de rétention clients

### 2.3 Dashboard Infrastructure

- CPU/Memory par service ECS
- Connexions Redis (actives, idle)
- Requêtes PostgreSQL (QPS, slow queries)
- Bande passante réseau
- Espace disque
- Queue Socket.IO

---

## 3. Alertes

### 3.1 Alertes critiques (PagerDuty — réponse immédiate)

| Alerte | Condition | Sévérité |
|--------|-----------|----------|
| API Down | `up{job="hil-delivre-api"} == 0` pendant 2 min | Critical |
| DB Down | Health check PostgreSQL unhealthy pendant 1 min | Critical |
| Redis Down | Health check Redis unhealthy pendant 2 min | Critical |
| Error Rate Spike | `rate(errors_total[5m]) > 10` | Critical |
| Payment Failures | `rate(payments_failed_total[5m]) > 5` | Critical |
| Disk Full | Disk usage > 95% | Critical |

### 3.2 Alertes warning (Slack — réponse dans l'heure)

| Alerte | Condition | Sévérité |
|--------|-----------|----------|
| High Latency | P95 > 2s pendant 5 min | Warning |
| Cache Miss High | `cache_hit_ratio < 0.5` pendant 10 min | Warning |
| Memory High | Heap usage > 85% | Warning |
| Socket Overload | `connected_sockets > 5000` | Warning |
| Slow Queries | Queries > 1s pendant 5 min | Warning |
| Low Deliverers | `online_deliverers < 3` en heures de pointe | Warning |

### 3.3 Alertes info (Slack — pour information)

| Alerte | Condition | Sévérité |
|--------|-----------|----------|
| Deploy Success | Nouveau déploiement détecté | Info |
| Cash Balance High | `cash_balance > 500000` pour un livreur | Info |
| KYC Pending | KYC en attente > 24h | Info |

### 3.4 Configuration AlertManager

```yaml
# alertmanager/alertmanager.yml
global:
  resolve_timeout: 5m
  slack_api_url: 'https://hooks.slack.com/services/XXX/YYY/ZZZ'

route:
  receiver: 'slack-default'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      repeat_interval: 5m
    - match:
        severity: warning
      receiver: 'slack-warning'
      repeat_interval: 1h

receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<PAGERDUTY_SERVICE_KEY>'
        severity: critical
  - name: 'slack-warning'
    slack_configs:
      - channel: '#hil-delivre-alerts'
        title: '⚠️ {{ .GroupLabels.alertname }}'
        text: '{{ .Annotations.description }}'
  - name: 'slack-default'
    slack_configs:
      - channel: '#hil-delivre-monitoring'
        title: 'ℹ️ {{ .GroupLabels.alertname }}'
        text: '{{ .Annotations.description }}'
```

---

## 4. Sentry (Error Tracking)

### 4.1 Configuration

```javascript
// src/config/sentry.js
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  release: process.env.APP_VERSION,
  tracesSampleRate: 0.1, // 10% des transactions
  profilesSampleRate: 0.05, // 5% des profils
  integrations: [
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ app }),
    new Sentry.Integrations.Postgres(),
  ],
  beforeSend(event) {
    // Ne pas envoyer les erreurs de validation (400)
    if (event.contexts?.response?.status_code === 400) {
      return null;
    }
    // Anonymiser les données sensibles
    if (event.request?.data) {
      delete event.request.data.password;
      delete event.request.data.phone_number;
    }
    return event;
  },
});
```

### 4.2 Alertes Sentry

- Nouvelle issue : notification Slack immédiate
- Régression : notification PagerDuty
- Spike d'erreurs (> 10x normal) : notification PagerDuty

---

## 5. Logtail (Log Aggregation)

### 5.1 Format des logs

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "service": "hil-delivre-api",
  "request_id": "uuid-v4",
  "user_id": "uuid-v4",
  "method": "POST",
  "path": "/api/orders",
  "status_code": 201,
  "duration_ms": 145,
  "message": "Order created successfully"
}
```

### 5.2 Rétention

| Type de log | Rétention | Indexation |
|-------------|-----------|------------|
| Application logs | 30 jours | Full-text |
| Access logs | 90 jours | Structured |
| Audit logs | 5 ans | Structured (conformité CIL) |
| Error logs | 90 jours | Full-text |

---

## 6. Runbooks

### 6.1 API Down

1. Vérifier le statut ECS : `aws ecs describe-services --cluster hil-delivre-cluster --services hil-delivre-api`
2. Vérifier les logs : CloudWatch Logs `/ecs/hil-delivre-api`
3. Vérifier la santé de la DB : `GET /api/monitoring/health/postgresql`
4. Si OOM : augmenter la mémoire du task definition
5. Si crash loop : rollback vers la version précédente

### 6.2 Redis Down

1. Vérifier ElastiCache : Console AWS → ElastiCache → Events
2. Vérifier la connectivité réseau (Security Groups)
3. L'application fonctionne en mode dégradé (fallback null)
4. Si failover : vérifier que le endpoint DNS a basculé
5. Monitorer le cache hit ratio après recovery

### 6.3 Payment Failures

1. Vérifier le statut PayDunya : https://status.paydunya.com
2. Vérifier les logs de webhook : `grep "payments/webhook" logs`
3. Vérifier la connectivité réseau vers PayDunya
4. Si PayDunya down : activer le mode "cash only" temporairement
5. Notifier les utilisateurs via push notification

### 6.4 High Latency

1. Identifier les endpoints lents : Grafana → Top endpoints by P95
2. Vérifier les slow queries : `pg_stat_statements`
3. Vérifier le cache hit ratio
4. Vérifier la charge CPU/Memory des containers
5. Si pic de trafic : scale up manuellement si auto-scaling trop lent

### 6.5 Cash Balance Alert

1. Identifier le livreur : `GET /api/admin/reconciliation/balance/:id`
2. Générer une fiche de réconciliation
3. Contacter le livreur (notification push + SMS)
4. Si non-résolu sous 48h : suspendre temporairement le compte

---

## 7. SLOs (Service Level Objectives)

| Métrique | Objectif | Mesure |
|----------|----------|--------|
| Disponibilité API | 99.9% | Uptime mensuel |
| Latence P95 | < 500ms | Percentile 95 |
| Latence P99 | < 2s | Percentile 99 |
| Taux d'erreur | < 0.1% | Erreurs 5xx / total |
| Temps de livraison | < 45 min | Médiane |
| Paiement success rate | > 98% | Paiements réussis / tentés |
