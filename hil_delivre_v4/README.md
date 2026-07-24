# Hil_Delivre v4

> Application de livraison pour le marché burkinabè — Version 4.0

---

## Résumé

Hil_Delivre est une plateforme de livraison connectant des **clients**, des **marchands** (restaurants) et des **livreurs**. Elle optimise les itinéraires, gère les paiements Mobile Money (PayDunya), et assure la conformité fiscale (FEC/DGI) et la protection des données (CIL).

---

## Sprint 1 — Ce qui est livré

Ce sprint pose les fondations techniques du projet :

- **Backend Node.js/Express** avec configuration sécurisée (Helmet, CORS, Rate Limiting, Helmet)
- **Endpoint de santé** (`GET /health` et `GET /api/health`)
- **Schéma de base de données** (Supabase/PostgreSQL + PostGIS) — `database/schema.sql`
- **Application mobile Expo** (splash screen initial)
- **Pipelines CI/CD** GitHub Actions (backend + mobile)
- **Documentation** (API, modèle de données, guide de développement)

---

## Démarrage rapide

### 1. Prérequis

- Node.js >= 18.0.0
- npm >= 9.0.0
- Compte Supabase (projet créé)

### 2. Installation

```bash
# Cloner le projet
git clone <repo-url>
cd hil_delivre_v4

# Installer toutes les dépendances
npm run setup
```

### 3. Configuration

```bash
# Copier le fichier d'environnement
cp backend/.env.example backend/.env

# Éditer avec vos valeurs réelles :
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SUPABASE_SERVICE_ROLE_KEY
# - CORS_ORIGINS
```

### 4. Base de données

Exécuter le script `database/schema.sql` dans le SQL Editor de Supabase.

**Étape manuelle obligatoire après exécution :** Créer le premier administrateur :
```sql
UPDATE public.profiles_data SET role = 'admin' WHERE user_id = '<uuid>';
```

### 5. Lancer le backend

```bash
npm run backend:dev
```

Le serveur démarre sur `http://localhost:3000`. Vérifier la santé :
```bash
curl http://localhost:3000/health
```

### 6. Lancer le mobile

```bash
npm run mobile:start
```

---

## Structure du projet

```
hil_delivre_v4/
├── apps/
│   ├── mobile/        # Application React Native (Expo)
│   └── admin/         # Application web d'administration
├── backend/
│   ├── src/
│   │   ├── config/    # Configuration de l'environnement
│   │   ├── routes/    # Routes API
│   │   ├── __tests__/ # Tests unitaires
│   │   ├── app.js     # Application Express
│   │   └── server.js  # Point d'entrée
│   ├── .env.example   # Modèle de variables d'environnement
│   └── package.json
├── database/
│   ├── schema.sql     # Schéma SQL complet (Sprint 1)
│   └── rls_policies.sql
├── docs/
│   ├── README.md      # Documentation générale
│   ├── api_endpoints.md
│   └── data_model.md
├── .github/workflows/
│   ├── backend_ci_cd.yml
│   └── mobile_ci_cd.yml
├── .gitignore
└── package.json       # Scripts racine
```

---

## Configuration des variables d'environnement

Le fichier `.env.example` se trouve dans `backend/.env.example`. Les variables obligatoires sont :

| Variable | Description | Exemple |
|----------|-------------|---------|
| `NODE_ENV` | Environnement | `production` |
| `PORT` | Port du serveur | `3000` |
| `SUPABASE_URL` | URL du projet Supabase | `https://xxxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Clé publique Supabase | `eyJhbG...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé de service Supabase | `eyJhbG...` |
| `CORS_ORIGINS` | Origines autorisées | `https://app.hildelivre.bf` |

---

## Sécurité

Hil_Delivre v4 implémente les mesures de sécurité suivantes :

- **Helmet** : CSP stricte, HSTS, protection contre le clickjacking
- **CORS** : Whitelist restrictive d'origines
- **Rate Limiting** : 100 req/15min global, 20 req/15min endpoints sensibles
- **Validation** : Body parser limité à 10kb, Joi/Yup pour les entrées
- **Supabase RLS** : Row Level Security sur toutes les tables
- **Schéma private** : Fonctions internes non exposées par l'API Data
- **Graceful shutdown** : Arrêt propre sur SIGTERM/SIGINT
- **Erreur handler** : Aucun détail interne leak en production

---

## Tests

```bash
cd backend
npm test
```

---

## Licence

Propriétaire — Hil_Delivre Team © 2024
