# Guide de Déploiement Production — Hil_Delivre v4

## Vue d'ensemble

Ce guide couvre le déploiement complet de Hil_Delivre v4 en production sur AWS Cape Town (af-south-1), optimisé pour le marché burkinabè avec une latence minimale vers l'Afrique de l'Ouest.

---

## Architecture de déploiement

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AWS Cape Town (af-south-1)                     │
│                                                                       │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────────────┐ │
│  │ CloudFront  │───►│     ALB      │───►│  ECS Fargate (Backend)  │ │
│  │    (CDN)    │    │ (Load Bal.)  │    │  - api-service (x3)     │ │
│  └─────────────┘    └──────────────┘    │  - socket-service (x2)  │ │
│                                          │  - cron-service (x1)    │ │
│                                          └─────────────────────────┘ │
│                                                      │                │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                       Data Layer                                 │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │ Supabase │  │  Redis   │  │   OSRM   │  │ S3 (Storage)  │  │ │
│  │  │(Postgres)│  │(Elastic  │  │ (EC2 t3) │  │               │  │ │
│  │  │+ PostGIS │  │  Cache)  │  │          │  │               │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                     Monitoring                                   │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │ │
│  │  │Prometheus│  │ Grafana  │  │  Sentry  │  │   Logtail     │  │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prérequis

| Composant | Version minimum | Notes |
|-----------|----------------|-------|
| Docker | 24.0+ | Build multi-stage |
| Terraform | 1.6+ | Infrastructure as Code |
| AWS CLI | 2.x | Configuré avec profil af-south-1 |
| Node.js | 20 LTS | Runtime backend |
| PostgreSQL | 15+ | Via Supabase |
| Redis | 7.x | Via AWS ElastiCache |

---

## 1. Configuration AWS

### 1.1 VPC et Networking

```hcl
# terraform/vpc.tf
resource "aws_vpc" "hil_delivre" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "hil-delivre-vpc"
    Environment = "production"
  }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.hil_delivre.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = "af-south-1${count.index == 0 ? "a" : "b"}"

  tags = {
    Name = "hil-delivre-private-${count.index}"
  }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.hil_delivre.id
  cidr_block              = "10.0.${count.index + 10}.0/24"
  availability_zone       = "af-south-1${count.index == 0 ? "a" : "b"}"
  map_public_ip_on_launch = true

  tags = {
    Name = "hil-delivre-public-${count.index}"
  }
}
```

### 1.2 ECS Fargate

```hcl
# terraform/ecs.tf
resource "aws_ecs_cluster" "main" {
  name = "hil-delivre-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "hil-delivre-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "api"
    image = "${aws_ecr_repository.api.repository_url}:latest"
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "3000" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_ssm_parameter.db_url.arn },
      { name = "REDIS_URL", valueFrom = aws_ssm_parameter.redis_url.arn },
      { name = "JWT_SECRET", valueFrom = aws_ssm_parameter.jwt_secret.arn },
      { name = "PAYDUNYA_MASTER_KEY", valueFrom = aws_ssm_parameter.paydunya_key.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/hil-delivre-api"
        "awslogs-region"        = "af-south-1"
        "awslogs-stream-prefix" = "api"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/api/monitoring/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "hil-delivre-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 3
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}
```

### 1.3 ElastiCache Redis

```hcl
# terraform/redis.tf
resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "hil-delivre-redis"
  description          = "Redis cluster for Hil_Delivre"
  node_type            = "cache.t3.small"
  num_cache_clusters   = 2
  port                 = 6379
  engine_version       = "7.0"

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = var.redis_auth_token

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  automatic_failover_enabled = true
  multi_az_enabled           = true

  snapshot_retention_limit = 7
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:07:00"
}
```

---

## 2. Docker

### 2.1 Dockerfile (Backend)

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

FROM node:20-alpine AS runtime

# Sécurité : utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hildelivre -u 1001

WORKDIR /app

# Copier les dépendances
COPY --from=builder --chown=hildelivre:nodejs /app/node_modules ./node_modules
COPY --chown=hildelivre:nodejs . .

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/monitoring/health || exit 1

# Exposer le port
EXPOSE 3000

# Utilisateur non-root
USER hildelivre

# Démarrage avec graceful shutdown
CMD ["node", "src/server.js"]
```

### 2.2 Docker Compose (Développement local)

Voir `docker-compose.yml` à la racine du projet.

---

## 3. Secrets Management

### 3.1 AWS Systems Manager Parameter Store

```bash
# Créer les secrets (une seule fois)
aws ssm put-parameter --name "/hil-delivre/prod/DATABASE_URL" \
  --type "SecureString" --value "postgresql://..." --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/REDIS_URL" \
  --type "SecureString" --value "rediss://..." --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/JWT_SECRET" \
  --type "SecureString" --value "$(openssl rand -hex 64)" --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/PAYDUNYA_MASTER_KEY" \
  --type "SecureString" --value "..." --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/AFRICAS_TALKING_API_KEY" \
  --type "SecureString" --value "..." --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/FCM_SERVER_KEY" \
  --type "SecureString" --value "..." --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/SENTRY_DSN" \
  --type "SecureString" --value "..." --region af-south-1

aws ssm put-parameter --name "/hil-delivre/prod/PROMETHEUS_METRICS_TOKEN" \
  --type "SecureString" --value "$(openssl rand -hex 32)" --region af-south-1
```

### 3.2 Rotation des secrets

- JWT_SECRET : rotation trimestrielle (avec période de grâce de 24h pour les tokens existants)
- PAYDUNYA_MASTER_KEY : rotation selon les recommandations PayDunya
- REDIS_URL auth_token : rotation semestrielle
- DATABASE_URL : rotation annuelle (coordonnée avec Supabase)

---

## 4. SSL/TLS

### 4.1 Certificat ACM

```hcl
resource "aws_acm_certificate" "main" {
  domain_name               = "api.hildelivre.bf"
  subject_alternative_names = ["*.hildelivre.bf"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
```

### 4.2 Configuration ALB

- TLS 1.2 minimum (policy `ELBSecurityPolicy-TLS13-1-2-2021-06`)
- HSTS activé via headers CloudFront
- Redirect HTTP → HTTPS automatique

---

## 5. DNS

### 5.1 Route 53

```hcl
resource "aws_route53_zone" "main" {
  name = "hildelivre.bf"
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.hildelivre.bf"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
```

---

## 6. CI/CD Pipeline

### 6.1 GitHub Actions

```yaml
# .github/workflows/deploy-production.yml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
      - run: npm run test:e2e

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: af-south-1
      - uses: aws-actions/amazon-ecr-login@v2
      - run: |
          docker build -t $ECR_REGISTRY/hil-delivre-api:${{ github.ref_name }} .
          docker push $ECR_REGISTRY/hil-delivre-api:${{ github.ref_name }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: af-south-1
      - run: |
          aws ecs update-service --cluster hil-delivre-cluster \
            --service hil-delivre-api \
            --force-new-deployment
      - name: Wait for deployment
        run: |
          aws ecs wait services-stable --cluster hil-delivre-cluster \
            --services hil-delivre-api
```

---

## 7. Migrations de base de données

### 7.1 Procédure de migration

```bash
# 1. Backup avant migration
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Exécuter la migration en mode transaction
psql $DATABASE_URL -v ON_ERROR_STOP=1 -1 -f database/schema_sprint10.sql

# 3. Vérifier la migration
psql $DATABASE_URL -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"

# 4. Rollback si nécessaire
psql $DATABASE_URL < backup_YYYYMMDD_HHMMSS.sql
```

---

## 8. Scaling

| Service | Min | Max | Trigger |
|---------|-----|-----|---------|
| API (ECS) | 3 | 10 | CPU > 70% ou Requests > 1000/min |
| Socket (ECS) | 2 | 6 | Connections > 5000 |
| Cron (ECS) | 1 | 1 | N/A (singleton) |
| Redis | 2 nodes | 2 nodes | Upgrade node type si memory > 80% |

### Auto-scaling policy

```hcl
resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "api-cpu-scaling"
  service_namespace  = "ecs"
  resource_id        = "service/hil-delivre-cluster/hil-delivre-api"
  scalable_dimension = "ecs:service:DesiredCount"
  policy_type        = "TargetTrackingScaling"

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
```

---

## 9. Checklist de déploiement

- [ ] Tous les tests passent (unit + E2E)
- [ ] Migration SQL testée sur staging
- [ ] Secrets configurés dans Parameter Store
- [ ] Certificat SSL validé
- [ ] DNS configuré et propagé
- [ ] Health checks fonctionnels
- [ ] Monitoring configuré (Prometheus + Grafana + Sentry)
- [ ] Alertes configurées (PagerDuty/Slack)
- [ ] Backup automatique activé
- [ ] Rate limiting vérifié
- [ ] CORS configuré pour les domaines de production
- [ ] 2FA activé pour tous les comptes admin
- [ ] Logs structurés et indexés
- [ ] Rollback plan documenté et testé
