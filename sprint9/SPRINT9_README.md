# Sprint 9 — Notation Bidirectionnelle, Certification Hygiène, Fidélisation

## Vue d'ensemble

Le Sprint 9 implémente trois systèmes complets pour Hil_Delivre v4 :

- **Notation bidirectionnelle** : Clients notent marchands/livreurs, livreurs notent clients (score 1-5, commentaire, fenêtre 72h)
- **Certification hygiène** : Programme "Hil_Delivre Qualité" (5000 FCFA/an, badge marchand, approbation admin)
- **Fidélisation** : Points de fidélité clients (1pt/100 FCFA, expiration 6 mois, conversion en crédit plateforme)

---

## Architecture

```
Sprint 9
├── database/
│   └── schema_sprint9.sql                         # Migration SQL (3 tables, 2 enums, 16 index, 6 RLS, 5 fonctions, 3 colonnes)
├── backend/src/
│   ├── services/
│   │   ├── ratingService.js                       # Notation bidirectionnelle
│   │   ├── loyaltyService.js                      # Programme de fidélisation
│   │   └── certificationService.js                # Certification hygiène
│   ├── controllers/
│   │   ├── ratingController.js                    # 7 handlers
│   │   ├── loyaltyController.js                   # 5 handlers
│   │   └── certificationController.js             # 7 handlers
│   ├── routes/
│   │   ├── ratingRoutes.js                        # 7 routes (2 publiques + 3 auth + 2 admin)
│   │   ├── loyaltyRoutes.js                       # 5 routes (3 client + 2 admin)
│   │   └── certificationRoutes.js                 # 7 routes (3 marchand + 4 admin)
│   ├── middlewares/
│   │   └── validationSprint9.js                   # 14 schémas Joi
│   └── __tests__/
│       ├── rating.test.js                         # 15+ tests
│       ├── loyalty.test.js                        # 12+ tests
│       └── certification.test.js                  # 14+ tests
├── apps/mobile/
│   ├── services/
│   │   ├── ratingService.js                       # Client API notation
│   │   ├── loyaltyService.js                      # Client API fidélisation
│   │   └── certificationService.js                # Client API certification
│   └── screens/
│       ├── client/
│       │   ├── RatingScreen.js                    # Écran notation (étoiles interactives)
│       │   └── LoyaltyScreen.js                   # Écran fidélité (solde, historique, conversion)
│       └── merchant/
│           └── CertificationScreen.js             # Écran certification (statut, demande, renouvellement)
├── docs/
│   └── API_SPRINT9.md                             # Documentation API complète
└── SPRINT9_README.md                              # Ce fichier
```

---

## Migration SQL

### Nouvelles tables

| Table | Description |
|-------|-------------|
| `ratings` | Notations bidirectionnelles entre acteurs d'une commande |
| `loyalty_points` | Transactions de points de fidélité (attribution, conversion, expiration) |
| `certification_hygiene` | Certifications hygiène "Hil_Delivre Qualité" des marchands |

### Nouveaux types ENUM

| Type | Valeurs |
|------|---------|
| `certification_status_type` | pending, certified, expired, revoked |
| `loyalty_transaction_type` | earned, redeemed, expired |

### Nouvelles colonnes (profiles_data)

| Colonne | Type | Description |
|---------|------|-------------|
| `is_certified` | BOOLEAN | Badge certification hygiène actif |
| `total_loyalty_points` | INTEGER | Solde de points disponibles (cache) |
| `ratings_count` | INTEGER | Nombre total de notations reçues |

### Fonctions PL/pgSQL

| Fonction | Description |
|----------|-------------|
| `update_user_avg_rating(user_id)` | Recalcule la note moyenne dans profiles_data |
| `update_user_ratings_count(user_id)` | Met à jour le compteur de notations |
| `expire_loyalty_points()` | Expire les points périmés (cron) |
| `award_loyalty_points(user_id, order_id, food_amount, ...)` | Attribue des points pour une commande |
| `redeem_loyalty_points(user_id, points, rate)` | Convertit des points en crédit (transactionnel) |

### Vues

| Vue | Description |
|-----|-------------|
| `v_loyalty_balance` | Solde de points disponibles par utilisateur |
| `v_certified_merchants` | Marchands avec certification active |

### Exécution

```bash
psql $DATABASE_URL < database/schema_sprint9.sql
```

---

## Endpoints API

### Notation (7 routes)

| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| POST | `/api/orders/:orderId/rate` | client, delivery | Créer une notation |
| GET | `/api/users/:userId/ratings` | Public | Notations d'un utilisateur |
| GET | `/api/users/:userId/rating-summary` | Public | Note moyenne |
| GET | `/api/orders/:orderId/can-rate` | client, delivery | Vérifier éligibilité |
| GET | `/api/orders/:orderId/ratings` | Authentifié | Notations d'une commande |
| GET | `/api/admin/ratings` | admin | Liste pour modération |
| DELETE | `/api/admin/ratings/:ratingId` | admin | Modérer une notation |

### Fidélisation (5 routes)

| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| GET | `/api/loyalty/points` | client | Solde de points |
| GET | `/api/loyalty/history` | client | Historique des transactions |
| POST | `/api/loyalty/redeem` | client | Convertir en crédit |
| GET | `/api/admin/loyalty/stats` | admin | Statistiques programme |
| POST | `/api/admin/loyalty/expire` | admin | Expiration manuelle |

### Certification (7 routes)

| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| POST | `/api/merchant/certify` | merchant | Demander certification |
| POST | `/api/merchant/certify/renew` | merchant | Renouveler |
| GET | `/api/merchant/certification` | merchant | Mon statut |
| GET | `/api/admin/certification-hygiene` | admin | Liste certifications |
| PUT | `/api/admin/certification-hygiene/:id/approve` | admin | Approuver |
| PUT | `/api/admin/certification-hygiene/:id/revoke` | admin | Révoquer |
| POST | `/api/admin/certification-hygiene/check-expirations` | admin | Vérifier expirations |

---

## Logique métier

### Notation

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│    CLIENT    │ ──note──►│   MARCHAND   │         │   LIVREUR    │
│              │ ──note──►│              │         │              │
└──────────────┘         └──────────────┘         └──────────────┘
       ▲                                                  │
       └──────────────────── note ────────────────────────┘
```

**Règles :**
- Fenêtre de notation : 72h après livraison (configurable)
- Score : 1 à 5 (entier)
- Commentaire : max 500 caractères, sanitizé (anti-XSS)
- Unicité : UNIQUE(order_id, rater_id, rated_user_id)
- Anti-fraude : pas d'auto-notation, vérification des parties
- Trigger SQL : recalcul automatique de avg_rating et ratings_count
- Modération admin : masquage (is_visible = false), audit trail

### Fidélisation

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  COMMANDE       │     │  POINTS         │     │  CRÉDIT         │
│  food_amount    │────►│  1pt / 100 FCFA │────►│  100pts = 500F  │
│  (livrée)       │     │  expire 6 mois  │     │  → wallet       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

**Règles :**
- Attribution : 1 point par tranche de 100 FCFA (floor)
- Expiration : 6 mois après attribution
- Conversion : 100 points minimum → 500 FCFA (taux : 1pt = 5 FCFA)
- FIFO : les points les plus anciens sont dépensés en premier
- Transaction SQL atomique pour la conversion (pas de perte)
- Cron recommandé : expiration quotidienne à 2h

### Certification Hygiène

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   PENDING   │ ──► │  CERTIFIED   │ ──► │    EXPIRED      │
│(marchand paie)│   │(admin approuve)│   │(après 1 an)     │
└─────────────┘     └──────────────┘     └─────────────────┘
       │                    │
       │                    ▼
       │             ┌──────────────┐
       └────────────►│   REVOKED    │
                     │(admin révoque)│
                     └──────────────┘
```

**Règles :**
- Frais : 5000 FCFA/an (débité du wallet_balance)
- Prérequis : KYC approuvé
- Validité : 12 mois à partir de l'approbation
- Badge : is_certified dans profiles_data (visible dans la liste marchands)
- Renouvellement : possible 30 jours avant expiration ou après expiration
- Cron recommandé : vérification quotidienne des expirations

---

## Sécurité

### RBAC strict

| Action | client | merchant | delivery | admin |
|--------|--------|----------|----------|-------|
| Noter marchand/livreur | ✅ | ❌ | ❌ | ❌ |
| Noter client | ❌ | ❌ | ✅ | ❌ |
| Voir ses points | ✅ | ❌ | ❌ | ❌ |
| Convertir points | ✅ | ❌ | ❌ | ❌ |
| Demander certification | ❌ | ✅ | ❌ | ❌ |
| Approuver/révoquer cert. | ❌ | ❌ | ❌ | ✅ |
| Modérer notation | ❌ | ❌ | ❌ | ✅ |
| Stats fidélité | ❌ | ❌ | ❌ | ✅ |

### Validation

- 14 schémas Joi avec `stripUnknown: true`
- Validation UUID sur tous les paramètres d'URL
- Contraintes CHECK en base de données
- Sanitization des commentaires (anti-XSS)

### Audit

- Toutes les actions admin loggées dans `admin_actions`
- Champs : admin_id, action_type, target_type, target_id, reason, metadata
- Types d'actions : rating_moderated, certification_approved, certification_revoked, loyalty_points_expired, certification_expiration_check

### Rate Limiting

| Endpoint | Limite |
|----------|--------|
| Création notation | 20 req / 15 min |
| Lecture notations | 60 req / min |
| Conversion points | 5 req / 15 min |
| Demande certification | 5 req / heure |
| Admin global | 120 req / min |

### Transactions SQL

- `redeem_loyalty_points` : atomique (débit FIFO + crédit wallet)
- `requestCertification` : débit wallet + création record (rollback si échec)

---

## Tests

```bash
# Exécuter tous les tests Sprint 9
npm test -- --testPathPattern="(rating|loyalty|certification)"

# Tests individuels
npm test -- --testPathPattern="rating"
npm test -- --testPathPattern="loyalty"
npm test -- --testPathPattern="certification"
```

**Couverture :** 40+ tests (notation: 15+, fidélisation: 12+, certification: 14+)

---

## Configuration requise

### Variables d'environnement

```env
# Supabase (existant)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
DATABASE_URL=postgresql://...

# Sprint 9 - Configuration dans platform_config
# loyalty_points_per_100fcfa = 1
# loyalty_expiry_months = 6
# loyalty_conversion_rate = 5
# loyalty_min_redeem = 100
# certification_fee = 5000
# rating_window_hours = 72
```

### Cron jobs recommandés

| Job | Fréquence | Fonction |
|-----|-----------|----------|
| Expiration points | Quotidien 2h | `expire_loyalty_points()` |
| Expiration certifications | Quotidien 3h | `checkExpirations()` |

---

## Intégration avec les sprints précédents

### Sprint 3 (Commandes)
- La notation requiert `orders.status = 'delivered'`
- L'attribution de points utilise `orders.food_amount`
- Référence FK vers `orders.id`

### Sprint 5 (Livraison)
- Le livreur (delivery_id) peut noter le client
- Le client peut noter le livreur

### Sprint 7 (Admin)
- Utilise `admin_actions` pour l'audit trail
- Met à jour `profiles_data.avg_rating` (colonne existante)
- Utilise `profiles_data.wallet_balance` pour la certification et la conversion
- Ajoute des routes admin cohérentes avec le pattern existant

---

## Points d'attention pour les sprints suivants

1. **Sprint 10 (Optimisation)** :
   - Cache Redis pour avg_rating (lecture fréquente)
   - Pagination curseur pour les listes de notations volumineuses
   - Notifications push 30 jours avant expiration certification
   - Notifications push quand des points expirent bientôt

2. **Production** :
   - Configurer les cron jobs Supabase (expire_loyalty_points, checkExpirations)
   - Mettre en place des alertes si avg_rating < 2.0 (marchands/livreurs problématiques)
   - Surveiller le volume de points en circulation (risque financier)
   - Implémenter les notifications d'expiration (certification + points)
   - Ajouter un export CSV des notations pour analyse
