# Hil_Delivre v4 — Modèle de données

## Sprint 1 : Tables initiales

Au Sprint 1, deux tables sont créées dans le schéma `public` de Supabase. Toutes les futures tables seront ajoutées de manière incrémentale dans les sprints suivants.

---

## 1. Table `profiles_data`

Cette table stocke les données métier des utilisateurs et est liée à la table `auth.users` de Supabase via la colonne `user_id`.

| Colonne | Type | Contrainte | Description |
|---------|------|-----------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Identifiant unique du profil |
| `user_id` | UUID | NOT NULL, FK → auth.users(id), UNIQUE | Lien vers le compte auth |
| `role` | ENUM(user_role) | NOT NULL, DEFAULT 'client' | Rôle : client, merchant, delivery, admin |
| `first_name` | TEXT | — | Prénom |
| `last_name` | TEXT | — | Nom de famille |
| `display_name` | TEXT | — | Nom d'affichage |
| `phone_number` | TEXT | — | Numéro de téléphone |
| `address` | TEXT | — | Adresse postale |
| `latitude` | NUMERIC | — | Latitude (géospatial) |
| `longitude` | NUMERIC | — | Longitude (géospatial) |
| `preferred_language` | ENUM(language_pref) | DEFAULT 'fr' | Langue préférée : fr, mo, di |
| `default_waypoints` | JSONB | DEFAULT '[]' | Points de repère par défaut |
| `score_rating` | NUMERIC | DEFAULT 0.0 | Score moyen de notation |
| `total_ratings` | INTEGER | DEFAULT 0 | Nombre total de notations |
| `kyc_status` | ENUM(kyc_status_type) | DEFAULT 'pending' | Statut KYC : pending, approved, rejected |
| `id_document_url` | TEXT | — | URL du document d'identité |
| `business_registration_number` | TEXT | — | Numéro d'enregistrement commercial |
| `is_subscribed` | BOOLEAN | DEFAULT FALSE | Abonnement actif |
| `subscription_start_date` | TIMESTAMPTZ | — | Début d'abonnement |
| `subscription_end_date` | TIMESTAMPTZ | — | Fin d'abonnement |
| `onboarding_fee_paid` | BOOLEAN | DEFAULT FALSE | Frais d'inscription payés |
| `wallet_balance` | NUMERIC | DEFAULT 0.0, CHECK >= 0 | Solde du portefeuille (FCFA) |
| `is_active` | BOOLEAN | DEFAULT TRUE | Compte actif |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Date de création |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Dernière modification |

### Index

| Nom | Colonnes | Usage |
|-----|----------|-------|
| `idx_profiles_data_user_id` | `user_id` | Recherche par utilisateur |
| `idx_profiles_data_role` | `role` | Filtrage par rôle |
| `idx_profiles_data_phone` | `phone_number` | Recherche par téléphone |
| `idx_profiles_data_is_active` | `is_active` | Filtrage des comptes actifs |

---

## 2. Table `platform_config`

Cette table stocke la configuration centralisée de la plateforme (commissions, tarifs, abonnements). Elle est modifiable uniquement par les administrateurs.

| Colonne | Type | Contrainte | Description |
|---------|------|-----------|-------------|
| `id` | UUID | PK, DEFAULT gen_random_uuid() | Identifiant unique |
| `config_key` | TEXT | UNIQUE, NOT NULL | Clé de configuration |
| `config_value` | NUMERIC | NOT NULL | Valeur numérique |
| `description` | TEXT | NOT NULL | Description de la configuration |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Dernière modification |
| `updated_by` | UUID | FK → auth.users(id) | Administrateur qui a modifié |

### Données initiales

| config_key | config_value | description |
|------------|-------------|-------------|
| `merchant_commission_rate` | 0.05 | Commission restaurant (5%) |
| `delivery_commission_rate` | 0.01 | Commission plateforme sur livraison (1%) |
| `merchant_subscription_amount` | 6000 | Abonnement mensuel marchand (FCFA) |
| `delivery_subscription_amount` | 3000 | Abonnement mensuel livreur (FCFA) |
| `delivery_base_fee` | 250 | Frais fixe de base par livraison (FCFA) |
| `delivery_rate_per_km_tier1` | 120 | Tarif/km pour les 5 premiers km (FCFA) |
| `delivery_rate_per_km_tier2` | 90 | Tarif/km au-delà de 5 km — dégressif (FCFA) |
| `delivery_tier1_max_km` | 5 | Distance maximale palier 1 (km) |
| `delivery_min_guaranteed` | 500 | Rémunération minimale livreur (FCFA) |
| `platform_vat_rate` | 0.18 | TVA sur services propres (18%) |

---

## Types ENUM

| Type | Valeurs | Description |
|------|---------|-------------|
| `user_role` | client, merchant, delivery, admin | Rôles utilisateurs |
| `language_pref` | fr, mo, di | Langues supportées (Français, Mooré, Dioula) |
| `kyc_status_type` | pending, approved, rejected | Statut de vérification d'identité |

---

## Schémas PostgreSQL

| Schéma | Usage |
|--------|-------|
| `public` | Tables applicatives et ENUMs |
| `private` | Fonctions internes (is_admin, triggers, event triggers) |
| `extensions` | Extensions PostGIS et uuid-ossp |

---

## Sécurité — Row Level Security

Toutes les tables de `public` ont RLS activé. Les politiques sont documentées dans `database/rls_policies.sql`.

---

## Évolution prévue

| Sprint | Tables ajoutées | Description |
|--------|----------------|-------------|
| Sprint 3 | merchants, menu_categories, menu_items | Catalogue des marchands |
| Sprint 4 | orders, order_items, order_status_history | Gestion des commandes |
| Sprint 5 | payments, payment_transactions, invoices | Paiements et facturation |
| Sprint 6 | otp_verifications, delivery_zones | OTP et zones de livraison |
| Sprint 7 | ratings, reviews, notifications | Notations et notifications |
| Sprint 8 | audit_logs, user_deletion_requests | Audit et conformité |
