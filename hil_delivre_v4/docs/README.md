# Hil_Delivre v4 — Documentation

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Structure du projet](#structure-du-projet)
3. [Architecture technique](#architecture-technique)
4. [Base de données](#base-de-données)
5. [API Backend](#api-backend)
6. [Déploiement](#déploiement)
7. [Développement local](#développement-local)
8. [Conformité réglementaire](#conformité-réglementaire)

---

## Vue d'ensemble

Hil_Delivre v4 est une application de livraison pour le marché burkinabè, connectant des clients, des marchands (restaurants) et des livreurs. La plateforme optimise les itinéraires, gère les paiements Mobile Money via PayDunya, et assure la conformité fiscale (FEC, TVA) et la protection des données (CIL).

## Structure du projet

```
hil_delivre_v4/
├── apps/
│   ├── mobile/        # Application React Native (Expo)
│   └── admin/         # Application web d'administration
├── backend/           # API REST Node.js / Express
├── database/          # Schéma SQL et politiques RLS
├── docs/              # Documentation du projet
├── .github/           # Workflows CI/CD
├── .gitignore
├── README.md
└── package.json
```

## Architecture technique

| Couche | Technologie | Description |
|--------|-------------|-------------|
| Mobile | React Native / Expo | iOS & Android, Hermes, offline-first |
| Admin | React | Interface web d'administration |
| Backend | Node.js / Express | API REST, Socket.IO, JWT |
| BDD | Supabase (PostgreSQL + PostGIS) | Données, Auth, Realtime, Storage |
| Paiements | PayDunya | Mobile Money, Mass Payout |
| Cartographie | OSM / OSRM / GraphHopper | Itinéraires, géofencing |
| SMS/OTP | Africa's Talking / Orange SMS | Vérification, notifications |
| Push | Firebase Cloud Messaging | Notifications push |
| Monitoring | Prometheus + Grafana + Logtail | Métriques, logs, alerting |
| CI/CD | GitHub Actions | Tests, linting, déploiement auto |

## Base de données

Le schéma SQL se trouve dans `database/schema.sql`. Il est exécutable dans le SQL Editor de Supabase.

Pour la documentation détaillée du modèle de données, voir [data_model.md](./data_model.md).

## API Backend

La documentation des endpoints API se trouve dans [api_endpoints.md](./api_endpoints.md).

Sprint 1 — Endpoints disponibles :
- `GET /health` — Vérification de santé de l'application
- `GET /api/health` — Identique, avec préfixe `/api`

## Déploiement

| Composant | Plateforme | Environnements |
|-----------|-----------|----------------|
| Backend | Render / AWS ECS | staging, production |
| Mobile | Expo EAS Build | development, preview, production |
| Admin | Vercel / Netlify | staging, production |
| BDD | Supabase Cloud | single instance |

## Développement local

### Prérequis
- Node.js >= 18.0.0
- npm >= 9.0.0
- Compte Supabase (projet créé)

### Installation

```bash
# Cloner le projet
git clone <repo-url>
cd hil_delivre_v4

# Installer les dépendances
npm run setup

# Configurer les variables d'environnement
cp backend/.env.example backend/.env
# Éditer backend/.env avec vos valeurs réelles

# Lancer le backend
npm run backend:dev

# Lancer le mobile
npm run mobile:start
```

## Conformité réglementaire

Hil_Delivre v4 est conçue pour être conforme aux réglementations burkinabè :

| Organisme | Exigence | Implémentation |
|-----------|----------|----------------|
| CIL | Protection des données personnelles | Chiffrement, RLS, politique de rétention, audit logs |
| DGI | Factures électroniques FEC | Génération FEC sur les services propres de la plateforme |
| CNIL (inspiré) | Consentement, droit à l'oubli | Endpoints de suppression de compte et d'export de données |

Pour plus de détails, consultez la documentation de conformité réglementaire (à compléter au Sprint 8).
