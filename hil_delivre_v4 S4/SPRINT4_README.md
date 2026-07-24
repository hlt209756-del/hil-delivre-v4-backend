# Hil_Delivre v4 — Sprint 4 : Paiement (Mobile Money + Cash), TVA, FEC

## Résumé du Sprint

Le Sprint 4 implémente le système de paiement complet de Hil_Delivre avec :
- **Paiement Mobile Money** via PayDunya (Orange Money, Moov Money, Coris Money)
- **Paiement Cash** (espèces à la livraison)
- **Calcul TVA** conforme à la réglementation du Burkina Faso
- **Facturation FEC** (Facturation Électronique Certifiée) conforme DGI
- **Configuration plateforme** dynamique (taux modifiables sans redéploiement)

---

## Architecture du Sprint

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT MOBILE                            │
│  PaymentSelectionScreen → PaymentConfirmationScreen             │
│  (Choix méthode)          (Polling statut / Confirmation)       │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │     API BACKEND          │
                    │  /api/payments/initiate  │
                    │  /api/payments/webhook   │
                    │  /api/payments/:id/status│
                    │  /api/orders/:id/invoice │
                    │  /api/config/rates       │
                    │  /api/admin/config       │
                    └──────┬──────────┬───────┘
                           │          │
              ┌────────────▼──┐   ┌───▼──────────────┐
              │  PayDunya API │   │  Supabase (BDD)  │
              │  (Mobile Money)│   │  payment_transactions │
              │               │   │  invoices_fec    │
              │               │   │  platform_config │
              └───────────────┘   └──────────────────┘
```

---

## Fichiers livrés

### Base de données
| Fichier | Description |
|---------|-------------|
| `database/schema_sprint4.sql` | Migration complète (tables, enums, indexes, RLS, fonctions, seeds) |

### Backend
| Fichier | Description |
|---------|-------------|
| `backend/src/services/paymentService.js` | Service paiement (Mobile Money, Cash, webhook, statut) |
| `backend/src/services/fecService.js` | Service facturation FEC conforme DGI |
| `backend/src/services/platformConfigService.js` | Service configuration plateforme (cache TTL 5min) |
| `backend/src/controllers/paymentController.js` | Contrôleur des endpoints paiement |
| `backend/src/routes/paymentRoutes.js` | Routes paiement avec rate limiting |
| `backend/src/routes/configRoutes.js` | Routes configuration (publique + admin) |
| `backend/src/middlewares/validationSprint4.js` | Schémas Joi pour validation des entrées |
| `backend/src/middlewares/rawBodyMiddleware.js` | Capture du raw body pour vérification HMAC |
| `backend/src/utils/responseHelper.js` | Utilitaire de formatage des réponses API |
| `backend/src/__tests__/payment.test.js` | Tests d'intégration paiement (15 tests) |
| `backend/src/__tests__/fec.test.js` | Tests d'intégration FEC (14 tests) |

### Mobile
| Fichier | Description |
|---------|-------------|
| `apps/mobile/services/paymentService.js` | Service API mobile (initiation, polling, factures) |
| `apps/mobile/screens/client/PaymentSelectionScreen.js` | Écran sélection méthode de paiement |
| `apps/mobile/screens/client/PaymentConfirmationScreen.js` | Écran confirmation/attente paiement |

### Documentation
| Fichier | Description |
|---------|-------------|
| `docs/API_SPRINT4.md` | Documentation API complète (7 endpoints) |
| `.env.example` | Variables d'environnement requises |

---

## Modèle de données (nouvelles tables)

### `platform_config`
Configuration dynamique de la plateforme.

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID PK | Identifiant unique |
| config_key | TEXT UNIQUE | Clé de configuration |
| config_value | NUMERIC | Valeur numérique |
| description | TEXT | Description humaine |
| updated_at | TIMESTAMPTZ | Dernière modification |
| updated_by | UUID FK → users | Admin ayant modifié |

### `payment_transactions`
Historique complet des transactions de paiement.

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID PK | Identifiant unique |
| order_id | UUID FK → orders | Commande associée |
| user_id | UUID FK → users | Client payeur |
| idempotency_key | UUID UNIQUE | Clé d'idempotence |
| payment_method | ENUM | `mobile_money` ou `cash` |
| amount | NUMERIC > 0 | Montant en FCFA |
| currency | TEXT | Devise (XOF) |
| status | ENUM | initiated/pending/completed/failed/cancelled/refunded |
| provider | TEXT | Fournisseur (paydunya/cash) |
| provider_ref | TEXT | Référence PayDunya |
| provider_token | TEXT | Token PayDunya |
| error_message | TEXT | Message d'erreur si échec |
| metadata | JSONB | Données complémentaires |
| attempts | INTEGER | Nombre de tentatives |
| created_at | TIMESTAMPTZ | Date de création |
| completed_at | TIMESTAMPTZ | Date de complétion |

### `invoices_fec`
Factures électroniques conformes FEC/DGI.

| Colonne | Type | Description |
|---------|------|-------------|
| id | UUID PK | Identifiant unique |
| order_id | UUID FK UNIQUE | Commande (1 facture par commande) |
| merchant_id | UUID FK | Marchand |
| client_id | UUID FK | Client |
| invoice_number | TEXT UNIQUE | Numéro séquentiel (HIL-YYYY-NNNNNN) |
| commission_ht | NUMERIC | Commission HT |
| delivery_fee_ht | NUMERIC | Frais livraison HT |
| total_ht | NUMERIC | Total HT |
| total_tva | NUMERIC | TVA (18% sur services propres) |
| total_ttc | NUMERIC | Total TTC |
| vat_rate | NUMERIC | Taux TVA appliqué |
| fec_data | JSONB | Données FEC complètes |
| status | ENUM | generated/submitted/failed |

---

## Logique financière

### Calcul des montants (par commande)

```
food_amount          = Σ(prix_item × quantité)           → Revient au marchand
commission_amount    = food_amount × 5%                   → Revient à Hil_Delivre
delivery_fee         = Calculé par distance (Sprint 5)    → Revient au livreur
platform_vat_amount  = (commission + delivery_fee) × 18%  → Reversé à la DGI
service_fees         = commission + platform_vat_amount    → Affiché au client
total_amount         = food_amount + service_fees + delivery_fee + surge_amount
```

### Règle TVA (conformité DGI Burkina Faso)

> **La TVA de 18% s'applique UNIQUEMENT sur les services propres de Hil_Delivre** :
> - Commission plateforme (5% du food_amount)
> - Frais de livraison
>
> Le prix des plats (food_amount) n'est PAS soumis à la TVA par la plateforme.
> Les marchands gèrent leur propre TVA séparément s'ils y sont assujettis.

### Numérotation des factures FEC

- Format : `HIL-YYYY-NNNNNN` (ex: HIL-2024-000001)
- Séquence PostgreSQL garantissant l'unicité et la continuité
- Pas de trous dans la numérotation (conformité DGI)

---

## Sécurité implémentée

| Mesure | Détail |
|--------|--------|
| **Signature HMAC SHA-256** | Vérification du webhook PayDunya avec comparaison timing-safe |
| **Idempotence** | Chaque transaction a un `idempotency_key` UUID unique. Les webhooks déjà traités ne sont pas retraités |
| **Rate Limiting** | Initiation : 10/15min, Webhook : 100/min, Status : 30/min |
| **RBAC** | Seul le client propriétaire peut initier un paiement |
| **Données sensibles** | Seuls les 4 derniers chiffres du téléphone sont stockés en metadata |
| **Anti-replay** | Transactions complétées ne sont jamais retraitées |
| **Validation Joi** | Tous les inputs sont validés avec stripUnknown |
| **RLS Supabase** | Policies par rôle sur toutes les tables |
| **Audit trail** | Chaque action de paiement est loggée dans audit_logs |
| **Graceful degradation** | Si PayDunya est down, l'erreur est gérée proprement |
| **Cache avec fallback** | Si la DB est inaccessible, le cache config est retourné |

---

## Intégration dans app.js

```javascript
// backend/src/app.js — Ajouts Sprint 4

const rawBodyMiddleware = require('./middlewares/rawBodyMiddleware');
const paymentRoutes = require('./routes/paymentRoutes');
const configRoutes = require('./routes/configRoutes');

// Webhook PayDunya : capturer le raw body AVANT express.json()
app.use('/api/payments/webhook', rawBodyMiddleware);

// JSON parser standard (après le raw body middleware)
app.use(express.json());

// Routes Sprint 4
app.use('/api/payments', paymentRoutes);
app.use('/api/config', configRoutes);
app.use('/api/admin/config', configRoutes);
```

---

## Configuration PayDunya

### Étapes de configuration

1. Créer un compte sur [app.paydunya.com](https://app.paydunya.com)
2. Créer une application dans le dashboard
3. Récupérer les clés API (Master Key, Private Key, Token)
4. Configurer le webhook URL : `https://api.hildelivre.bf/api/payments/webhook`
5. Configurer les URLs de retour (return/cancel)

### Mode Test vs Production

| Variable | Test | Production |
|----------|------|------------|
| `PAYDUNYA_MODE` | `test` | `live` |
| Base URL | `sandbox-api/v1` | `api/v1` |
| Signature | Non vérifiée | Vérifiée HMAC |

---

## Tests

### Exécution

```bash
cd backend
npm test -- --testPathPattern="payment|fec"
```

### Couverture

| Suite | Tests | Description |
|-------|-------|-------------|
| `payment.test.js` | 15 | Initiation, idempotence, webhook, sécurité |
| `fec.test.js` | 14 | Génération factures, calculs TVA, conformité |
| **Total** | **29** | |

---

## Points d'attention pour les sprints suivants

| # | Point | Sprint concerné |
|---|-------|-----------------|
| 1 | Frais de livraison calculés par distance (OSRM) | Sprint 5 |
| 2 | Surge pricing (heures de pointe) | Sprint 5 |
| 3 | Notifications temps réel (Socket.IO) après paiement | Sprint 6 |
| 4 | OTP SMS pour confirmation de livraison cash | Sprint 6 |
| 5 | Dashboard admin avec rapports financiers | Sprint 7 |
| 6 | Abonnements marchands/livreurs (récurrent PayDunya) | Sprint 8 |
| 7 | Réconciliation cash livreur (fin de journée) | Sprint 7 |

---

## Dépendances ajoutées

```json
{
  "dependencies": {
    "joi": "^17.x",
    "express-rate-limit": "^7.x"
  }
}
```

> Note : `crypto` et `fetch` sont natifs dans Node.js 18+. Aucune dépendance externe supplémentaire n'est requise pour PayDunya.

---

## Conformité réglementaire

### CIL (Commission de l'Informatique et des Libertés)
- Les données de paiement sont minimisées (pas de stockage de numéro complet)
- Audit trail complet pour traçabilité
- Droit à l'effacement respecté (soft-delete des transactions)

### DGI (Direction Générale des Impôts)
- Factures FEC avec numérotation séquentielle sans trous
- TVA de 18% correctement calculée sur les services propres uniquement
- Données FEC complètes en JSONB pour export
- IFU et RCCM de l'entreprise inclus dans chaque facture

---

*Sprint 4 livré — Archimède, CTO Hil_Delivre v4*
