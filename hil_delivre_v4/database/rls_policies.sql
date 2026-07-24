-- ============================================================
-- Hil_Delivre v4 — Récapitulatif des politiques RLS
-- Sprint 1 : Référence des politiques de sécurité
-- ============================================================
-- Ce fichier documente les politiques Row Level Security
-- appliquées sur les tables du Sprint 1. Il sert de référence
-- pour les audits de sécurité et la documentation.
-- ============================================================

-- ============================================================
-- Table : public.profiles_data
-- ============================================================

-- profiles_data_select_authenticated
--   Rôle : authenticated
--   Action : SELECT
--   Condition :
--     - L'utilisateur consulte son propre profil
--     - OU l'utilisateur est admin
--     - OU le profil est un marchand actif et abonné
--   Objectif : Permettre la consultation des profils marchands
--              publics et des profils personnels

-- profiles_data_select_anon
--   Rôle : anon
--   Action : SELECT
--   Condition :
--     - Le profil est un marchand actif et abonné
--   Objectif : Permettre la navigation publique des marchands
--              sans authentification

-- profiles_data_update_authenticated
--   Rôle : authenticated
--   Action : UPDATE
--   Condition :
--     - L'utilisateur modifie son propre profil
--     - OU l'utilisateur est admin
--   Objectif : Restreindre les modifications aux propriétaires
--              et aux administrateurs

-- ============================================================
-- Table : public.platform_config
-- ============================================================

-- platform_config_select_authenticated
--   Rôle : authenticated
--   Action : SELECT
--   Condition :
--     - L'utilisateur est authentifié
--   Objectif : Permettre la lecture de la configuration par
--              tous les utilisateurs authentifiés

-- platform_config_update_admin
--   Rôle : authenticated
--   Action : UPDATE
--   Condition :
--     - L'utilisateur est admin (via private.is_admin())
--   Objectif : Restreindre les modifications de config aux admins

-- platform_config_insert_admin
--   Rôle : authenticated
--   Action : INSERT
--   Condition :
--     - L'utilisateur est admin (via private.is_admin())
--   Objectif : Restreindre les insertions de config aux admins

-- ============================================================
-- Notes de sécurité
-- ============================================================
-- Toutes les fonctions privées sont dans le schéma "private"
-- et ne sont pas exposées par l'API Data de Supabase.
-- La fonction is_admin() est la seule fonction callable depuis
-- les policies RLS (GRANT EXECUTE TO authenticated).
-- ============================================================
