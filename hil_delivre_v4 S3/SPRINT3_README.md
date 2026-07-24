# Hil_Delivre v4 — Sprint 3 : Tunnel de commande, Menu, Panier

## Vue d'ensemble

Le Sprint 3 implémente le tunnel de commande complet : consultation des marchands, navigation dans les menus, gestion du panier côté mobile, et création/gestion des commandes côté backend. Il inclut la gestion des stocks en temps réel, les transitions de statut contrôlées par rôle, et les calculs financiers (commission, TVA plateforme).

## Architecture implémentée

```
backend/src/
├── controllers/
│   ├── menuController.js         # CRUD menu + liste marchands
│   └── orderController.js        # Création, liste, détails, statut, annulation
├── routes/
│   ├── menuRoutes.js             # Routes publiques + marchands
│   └── orderRoutes.js            # Routes commandes (auth requise)
├── middlewares/
│   └── validationSprint3.js      # Schémas Joi (menu + orders)
└── __tests__/
    ├── menu.test.js              # Tests intégration menu (13 tests)
    └── orders.test.js            # Tests intégration orders (13 tests)

database/
└── schema_sprint3.sql            # Migration : menu_items, orders, order_items

apps/mobile/
├── contexts/
│   └── CartContext.js            # Gestion panier (reducer + AsyncStorage)
├── services/
│   ├── menuService.js            # API marchands + menus
│   └── orderService.js           # API commandes
└── screens/client/
    ├── HomeScreen.js             # Liste marchands + recherche + pagination
    ├── MenuScreen.js             # Menu marchand + ajout panier
    ├── CartScreen.js             # Panier + quantités + total
    └── CheckoutScreen.js         # Confirmation + adresse + note
```

## Endpoints API

### Marchands & Menus (publics)

| Méthode | Endpoint | Auth | Description |
|---------|----------|------|-------------|
| GET | `/api/merchants` | Non | Liste des marchands actifs (paginée, recherche) |
| GET | `/api/merchants/:merchantId/menu` | Non | Menu d'un marchand (groupé par catégorie) |

### CRUD Menu (marchand)

| Méthode | Endpoint | Auth | Rôle | Description |
|---------|----------|------|------|-------------|
| GET | `/api/menu/my-items` | Oui | merchant | Mes articles (incluant indisponibles) |
| POST | `/api/menu/items` | Oui | merchant | Créer un article |
| PUT | `/api/menu/items/:itemId` | Oui | merchant | Modifier un article |
| DELETE | `/api/menu/items/:itemId` | Oui | merchant | Supprimer (soft-delete) |

### Commandes

| Méthode | Endpoint | Auth | Rôle | Description |
|---------|----------|------|------|-------------|
| POST | `/api/orders` | Oui | client | Créer une commande |
| GET | `/api/orders` | Oui | * | Liste des commandes (filtrée par rôle) |
| GET | `/api/orders/:orderId` | Oui | * | Détails d'une commande |
| PUT | `/api/orders/:orderId/status` | Oui | merchant/delivery/admin | Changer le statut |
| POST | `/api/orders/:orderId/cancel` | Oui | client | Annuler (si pending/accepted) |

## Logique métier clé

### Calcul des montants (à la création)

```
food_amount          = Σ (prix_article × quantité)
commission_amount    = food_amount × merchant_commission_rate (5%)
platform_vat_amount  = (commission_amount + delivery_fee) × 18%
service_fees         = commission_amount + platform_vat_amount
total_amount         = food_amount + service_fees + delivery_fee + surge_amount
```

**Note** : `delivery_fee` et `surge_amount` sont à 0 dans ce sprint. Ils seront calculés au Sprint 5 (dispatch + tarification dynamique).

### Transitions de statut

```
pending → accepted (marchand) → preparing (marchand) → ready_for_pickup (marchand)
       → on_the_way (livreur) → delivered (livreur)

Annulations :
  pending/accepted → cancelled (client)
  pending → cancelled (marchand)
  tout statut → cancelled/refunded (admin)
```

### Gestion des stocks

- Les stocks sont décrémentés à la création de la commande
- En cas d'annulation, les stocks sont restaurés automatiquement
- Si `stock_quantity` est NULL, l'article est considéré en stock illimité
- Vérification de disponibilité avant insertion

### Panier (côté mobile)

- Géré localement via React Context + useReducer
- Persisté dans AsyncStorage (survit aux redémarrages)
- Un seul marchand par panier (changement = vidage avec confirmation)
- Quantité max 99 par article, max 50 articles par commande
- Calcul du sous-total en temps réel

## Migration SQL Sprint 3

Le fichier `database/schema_sprint3.sql` crée :

1. **3 types ENUM** : `order_status`, `payment_method_type`, `cash_payment_status_type`
2. **3 tables** : `menu_items`, `orders`, `order_items`
3. **Indexes** : 9 index pour les performances (requêtes par marchand, client, statut, date)
4. **RLS** : 7 policies (lecture publique menu, accès par partie pour commandes)
5. **Triggers** : `updated_at` automatique sur `menu_items` et `orders`
6. **Contraintes** : prix positifs, quantités non-négatives, client ≠ marchand

## Sécurité

- **Validation Joi stricte** : `stripUnknown: true` sur tous les schémas
- **RBAC** : Chaque endpoint vérifie le rôle ET l'appartenance (ex: marchand ne peut modifier que SES articles)
- **KYC gating** : Les marchands doivent avoir un KYC approuvé pour gérer leur menu
- **Transitions contrôlées** : Matrice de transitions par rôle empêche les changements non autorisés
- **Soft-delete** : Les articles ne sont pas supprimés physiquement (intégrité des commandes historiques)
- **Snapshot prix** : Le prix est copié au moment de la commande (immunisé contre les modifications ultérieures)
- **Anti-fraude** : `client_id != merchant_id` (contrainte SQL), quantités limitées

## Tests

```bash
# Tous les tests (77 tests, 5 suites)
npx jest --forceExit --no-coverage

# Tests Sprint 3 uniquement
npx jest menu.test.js orders.test.js --forceExit
```

## Installation

```bash
# 1. La migration Sprint 3 nécessite les Sprints 1 et 2 préalablement exécutés
# 2. Exécuter database/schema_sprint3.sql dans le SQL Editor de Supabase
# 3. Redémarrer le backend (les nouvelles routes sont auto-montées)
npm run dev
```

## Points d'attention Sprint 4

1. **Paiement** : Intégration PayDunya (Mobile Money + Cash) — Sprint 4
2. **Frais de livraison** : Actuellement à 0, seront calculés au Sprint 5
3. **Notifications temps réel** : Socket.IO pour les changements de statut — Sprint 6
4. **Upload images menu** : Nécessite Supabase Storage (bucket `menu-images`)
