-- ============================================================
-- Hil_Delivre v4 — Sprint 1 : Schéma initial de la base de données
-- Version 2.0 — CONSOLIDÉE ET FINALE
-- À exécuter dans le SQL Editor de Supabase, du début à la fin,
-- en une seule fois.
-- ============================================================
-- Ce script est IDEMPOTENT et DESTRUCTIF PAR CONCEPTION : la partie 0
-- supprime proprement tout ce qui a pu être créé par les scripts et
-- patches précédents (v1.0, v1.1, patches partiels), puis la partie 1
-- reconstruit l'ensemble depuis zéro avec tous les correctifs.
-- Aucune perte de données réelle attendue au stade actuel du projet
-- (Sprint 1, pas de données métier) — voir note en fin de fichier
-- pour la ré-association des comptes auth.users existants.
-- ============================================================
-- RÉCAPITULATIF DES CORRECTIFS INTÉGRÉS DANS CETTE VERSION :
--   [FIX-1] PostGIS et uuid-ossp dans un schéma "extensions" dédié,
--           pas dans "public" (RLS Disabled in Public / spatial_ref_sys).
--   [FIX-2] Rôle utilisateur JAMAIS lu depuis raw_user_meta_data
--           (faille d'élévation de privilège à l'inscription).
--   [FIX-3] Toutes les fonctions internes (is_admin, handle_new_user,
--           handle_updated_at, rls_auto_enable) déplacées dans un
--           schéma "private" non exposé par l'API Data de Supabase
--           (Public/Signed-In Can Execute SECURITY DEFINER Function).
--   [FIX-4] auth.uid() et auth.role() systématiquement wrappés en
--           (SELECT ...) dans les policies RLS (Auth RLS
--           Initialization Plan / performance).
--   [FIX-5] Policies SELECT/UPDATE consolidées en une seule policy
--           par rôle et par action (Multiple Permissive Policies).
--   [FIX-6] rls_auto_enable() : code vérifié ligne par ligne, conforme
--           au pattern officiel Supabase, conservé et simplement
--           déplacé dans "private".
-- ============================================================


-- ============================================================
-- PARTIE 0 : NETTOYAGE COMPLET (idempotent, sûr à rejouer)
-- ============================================================

DROP EVENT TRIGGER IF EXISTS ensure_rls;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

DROP TABLE IF EXISTS public.platform_config CASCADE;
DROP TABLE IF EXISTS public.profiles_data CASCADE;

DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.handle_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.rls_auto_enable() CASCADE;
DROP FUNCTION IF EXISTS private.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS private.handle_updated_at() CASCADE;
DROP FUNCTION IF EXISTS private.is_admin() CASCADE;
DROP FUNCTION IF EXISTS private.rls_auto_enable() CASCADE;

DROP TYPE IF EXISTS public.user_role;
DROP TYPE IF EXISTS public.language_pref;
DROP TYPE IF EXISTS public.kyc_status_type;

DROP SCHEMA IF EXISTS private CASCADE;
DROP EXTENSION IF EXISTS postgis CASCADE;
DROP EXTENSION IF EXISTS "uuid-ossp" CASCADE;
DROP SCHEMA IF EXISTS extensions CASCADE;


-- ============================================================
-- PARTIE 1 : RECONSTRUCTION
-- ============================================================

-- ---- ÉTAPE 1 : Schémas et extensions [FIX-1] ----------------

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS private;

CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;

-- Note pour la suite du projet (Sprint 5, colonnes geometry/geography) :
-- qualifier "extensions.geometry(...)" / "extensions.geography(...)",
-- ou exécuter : ALTER DATABASE postgres SET search_path = public, extensions;

-- ---- ÉTAPE 2 : Types ENUM ------------------------------------

CREATE TYPE public.user_role AS ENUM ('client', 'merchant', 'delivery', 'admin');
CREATE TYPE public.language_pref AS ENUM ('fr', 'mo', 'di');
CREATE TYPE public.kyc_status_type AS ENUM ('pending', 'approved', 'rejected');

-- ---- ÉTAPE 3 : Table profiles_data ---------------------------

CREATE TABLE public.profiles_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.user_role NOT NULL DEFAULT 'client',

    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    phone_number TEXT,
    address TEXT,
    latitude NUMERIC,
    longitude NUMERIC,

    preferred_language public.language_pref DEFAULT 'fr',
    default_waypoints JSONB DEFAULT '[]'::jsonb,

    score_rating NUMERIC DEFAULT 0.0,
    total_ratings INTEGER DEFAULT 0,

    kyc_status public.kyc_status_type DEFAULT 'pending',
    id_document_url TEXT,
    business_registration_number TEXT,

    is_subscribed BOOLEAN DEFAULT FALSE,
    subscription_start_date TIMESTAMP WITH TIME ZONE,
    subscription_end_date TIMESTAMP WITH TIME ZONE,

    onboarding_fee_paid BOOLEAN DEFAULT FALSE,
    wallet_balance NUMERIC DEFAULT 0.0 CHECK (wallet_balance >= 0),

    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT profiles_data_user_id_unique UNIQUE (user_id)
    -- NOTE : phone_number sans contrainte UNIQUE — à trancher avant
    -- Sprint 2/6 (OTP) : source de vérité du numéro (auth.users.phone
    -- vs ce champ) et ajout d'un UNIQUE le cas échéant.
);

CREATE INDEX idx_profiles_data_user_id ON public.profiles_data(user_id);
CREATE INDEX idx_profiles_data_role ON public.profiles_data(role);
CREATE INDEX idx_profiles_data_phone ON public.profiles_data(phone_number);
CREATE INDEX idx_profiles_data_is_active ON public.profiles_data(is_active);

COMMENT ON TABLE public.profiles_data IS 'Données métier des utilisateurs, liée à auth.users via user_id';

-- ---- ÉTAPE 4 : Table platform_config --------------------------

CREATE TABLE public.platform_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT UNIQUE NOT NULL,
    config_value NUMERIC NOT NULL,
    description TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.platform_config IS 'Configuration centralisée de la plateforme (commissions, tarifs, abonnements). Modifiable par les admins.';

-- ---- ÉTAPE 5 : Données initiales de platform_config -----------

INSERT INTO public.platform_config (config_key, config_value, description) VALUES
    ('merchant_commission_rate', 0.05, 'Taux de commission restaurant sur le montant de la nourriture (5%)'),
    ('delivery_commission_rate', 0.01, 'Taux de commission plateforme sur les frais de livraison (1%)'),
    ('merchant_subscription_amount', 6000, 'Montant de l''abonnement mensuel marchand (FCFA)'),
    ('delivery_subscription_amount', 3000, 'Montant de l''abonnement mensuel livreur (FCFA)'),
    ('delivery_base_fee', 250, 'Frais fixe de base pour chaque livraison (FCFA)'),
    ('delivery_rate_per_km_tier1', 120, 'Tarif par km pour les 5 premiers km (FCFA)'),
    ('delivery_rate_per_km_tier2', 90, 'Tarif par km au-delà de 5 km — tarif dégressif (FCFA)'),
    ('delivery_tier1_max_km', 5, 'Distance maximale du palier 1 (km)'),
    ('delivery_min_guaranteed', 500, 'Rémunération minimale garantie au livreur par course (FCFA)'),
    ('platform_vat_rate', 0.18, 'Taux de TVA appliqué sur les services propres de la plateforme (18%)');
-- NOTE : commission marchand fixée à 5% (cohérent avec commission_amount
-- et le calcul FEC détaillé dans le plan) — le tableau récap 9.5 du plan
-- indiquait 10% par erreur. À confirmer explicitement avant le Sprint 4.

-- ---- ÉTAPE 6 : Fonctions internes (schéma private) [FIX-3] ----

CREATE OR REPLACE FUNCTION private.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- [FIX-2] Le rôle n'est JAMAIS lu depuis raw_user_meta_data (modifiable
-- par le client au signUp => élévation de privilège triviale sinon).
-- Tout nouvel utilisateur est 'client'. Le passage à un autre rôle se
-- fait via un endpoint backend dédié, protégé et validé par KYC. Le
-- rôle 'admin' ne s'attribue JAMAIS via ce trigger, uniquement à la main
-- avec la clé service_role.
CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles_data (user_id, role)
    VALUES (NEW.id, 'client'::public.user_role);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles_data
        WHERE user_id = (SELECT auth.uid()) AND role = 'admin'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- [FIX-6] Code vérifié à l'identique du pattern officiel Supabase,
-- déplacé de public vers private.
CREATE OR REPLACE FUNCTION private.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Droits : aucune de ces fonctions n'est appelable directement via
-- l'API. handle_updated_at / handle_new_user / rls_auto_enable ne
-- sont invoquées que par des triggers internes (aucun grant requis).
-- is_admin() est appelée depuis les policies RLS : seul le rôle
-- "authenticated" en a besoin.
REVOKE ALL ON FUNCTION private.handle_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated;

-- ---- ÉTAPE 7 : Triggers ----------------------------------------

CREATE TRIGGER on_profiles_data_updated
    BEFORE UPDATE ON public.profiles_data
    FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

CREATE TRIGGER on_platform_config_updated
    BEFORE UPDATE ON public.platform_config
    FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION private.handle_new_user();

CREATE EVENT TRIGGER ensure_rls
    ON ddl_command_end
    EXECUTE FUNCTION private.rls_auto_enable();

-- ---- ÉTAPE 8 : Row Level Security --------------------------------

ALTER TABLE public.profiles_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

-- ---- ÉTAPE 9 : Policies profiles_data [FIX-4] [FIX-5] ------------

-- Une seule policy SELECT pour "authenticated" (own + admin + marchands publics)
CREATE POLICY "profiles_data_select_authenticated"
    ON public.profiles_data FOR SELECT
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        OR (SELECT private.is_admin())
        OR (role = 'merchant' AND is_active = TRUE AND is_subscribed = TRUE)
    );

-- Policy SELECT séparée pour "anon" (navigation publique des marchands)
CREATE POLICY "profiles_data_select_anon"
    ON public.profiles_data FOR SELECT
    TO anon
    USING (role = 'merchant' AND is_active = TRUE AND is_subscribed = TRUE);

-- Une seule policy UPDATE pour "authenticated" (own + admin)
CREATE POLICY "profiles_data_update_authenticated"
    ON public.profiles_data FOR UPDATE
    TO authenticated
    USING ( (SELECT auth.uid()) = user_id OR (SELECT private.is_admin()) )
    WITH CHECK ( (SELECT auth.uid()) = user_id OR (SELECT private.is_admin()) );

-- ---- ÉTAPE 10 : Policies platform_config [FIX-4] ------------------

CREATE POLICY "platform_config_select_authenticated"
    ON public.platform_config FOR SELECT
    TO authenticated
    USING ( (SELECT auth.role()) = 'authenticated' );

CREATE POLICY "platform_config_update_admin"
    ON public.platform_config FOR UPDATE
    TO authenticated
    USING ( (SELECT private.is_admin()) )
    WITH CHECK ( (SELECT private.is_admin()) );

CREATE POLICY "platform_config_insert_admin"
    ON public.platform_config FOR INSERT
    TO authenticated
    WITH CHECK ( (SELECT private.is_admin()) );

-- ---- ÉTAPE 11 : Ré-association des comptes auth.users existants --
-- Si des comptes ont été créés AVANT ce script (donc sans profil,
-- puisque la table vient d'être recréée), on leur crée un profil
-- 'client' par défaut. Sans effet si la base est vierge.

INSERT INTO public.profiles_data (user_id, role)
SELECT id, 'client'::public.user_role
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM public.profiles_data)
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- FIN DU SCHÉMA SPRINT 1 (v2.0 — consolidée)
-- ============================================================
-- ÉTAPE MANUELLE OBLIGATOIRE APRÈS EXÉCUTION :
--   Aucun compte admin n'existe automatiquement. Créer le premier admin :
--     UPDATE public.profiles_data SET role = 'admin' WHERE user_id = '<uuid>';
--
-- VÉRIFICATIONS RECOMMANDÉES APRÈS EXÉCUTION :
--   SELECT evtname, evtenabled FROM pg_event_trigger WHERE evtname = 'ensure_rls';
--   -- doit renvoyer evtenabled = 'O'
--   Puis relancer le Security Advisor ET le Performance Advisor complets.
--
-- POINTS EN SUSPENS (voir commentaires ci-dessus) :
--   - Unicité de phone_number : à trancher avant Sprint 2/6.
--   - Commission marchand 5% vs 10% (incohérence du plan) : à confirmer
--     avant Sprint 4.
-- ============================================================
