-- ============================================================
-- Hil_Delivre v4 — Sprint 2 : Migration additionnelle
-- Authentification, KYC, Gating, Conformité CIL
-- ============================================================
-- Ce script est une MIGRATION ADDITIVE au schéma Sprint 1 (schema.sql).
-- Il ne supprime rien, il ajoute uniquement les éléments nécessaires
-- au Sprint 2.
-- À exécuter APRÈS schema.sql dans le SQL Editor de Supabase.
-- ============================================================

-- ---- 1. Table de consentements CIL --------------------------------
-- Enregistre les consentements explicites des utilisateurs pour la
-- conformité CIL (Commission de l'Informatique et des Libertés).
-- Chaque consentement est horodaté et versionné.

CREATE TABLE IF NOT EXISTS public.user_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    -- Types de consentement :
    -- 'privacy_policy' : Politique de confidentialité
    -- 'terms_of_service' : Conditions d'utilisation
    -- 'data_processing' : Traitement des données personnelles (CIL)
    -- 'marketing' : Communications marketing (optionnel)
    consent_given BOOLEAN NOT NULL DEFAULT TRUE,
    consent_version TEXT NOT NULL DEFAULT '1.0',
    ip_address TEXT,
    user_agent TEXT,
    given_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT user_consents_unique_active
        UNIQUE (user_id, consent_type, consent_version)
);

CREATE INDEX idx_user_consents_user_id ON public.user_consents(user_id);
CREATE INDEX idx_user_consents_type ON public.user_consents(consent_type);

COMMENT ON TABLE public.user_consents IS 'Registre des consentements utilisateurs pour la conformité CIL. Chaque consentement est horodaté, versionné et révocable.';

-- ---- 2. Table des demandes KYC (historique) -------------------------
-- Enregistre l'historique des demandes KYC pour traçabilité.
-- Le statut actuel est dans profiles_data.kyc_status, mais cette table
-- conserve l'historique complet des soumissions et décisions.

CREATE TABLE IF NOT EXISTS public.kyc_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    requested_role public.user_role NOT NULL,
    -- Documents soumis
    id_document_url TEXT NOT NULL,
    business_registration_number TEXT,
    -- Décision admin
    status public.kyc_status_type NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES auth.users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    -- Métadonnées
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address TEXT,

    CONSTRAINT kyc_requests_valid_role
        CHECK (requested_role IN ('merchant', 'delivery'))
);

CREATE INDEX idx_kyc_requests_user_id ON public.kyc_requests(user_id);
CREATE INDEX idx_kyc_requests_status ON public.kyc_requests(status);
CREATE INDEX idx_kyc_requests_submitted_at ON public.kyc_requests(submitted_at DESC);

COMMENT ON TABLE public.kyc_requests IS 'Historique des demandes KYC. Permet la traçabilité complète des soumissions et décisions pour audit CIL/DGI.';

-- ---- 3. Table d'audit des actions sensibles -------------------------
-- Enregistre les actions critiques pour la conformité et la résolution
-- de litiges. Complète les logs applicatifs avec une trace en BDD.

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    action_type TEXT NOT NULL,
    -- Types d'actions :
    -- 'auth.register', 'auth.login', 'auth.logout', 'auth.password_reset'
    -- 'profile.update', 'profile.delete'
    -- 'kyc.submit', 'kyc.approve', 'kyc.reject'
    -- 'admin.role_change', 'admin.deactivate_user'
    entity_type TEXT,
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

COMMENT ON TABLE public.audit_logs IS 'Journal d''audit des actions critiques. Requis pour la conformité CIL et la résolution de litiges.';

-- ---- 4. RLS sur les nouvelles tables --------------------------------

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Policies user_consents : l'utilisateur voit ses propres consentements, admin voit tout
CREATE POLICY "user_consents_select_own"
    ON public.user_consents FOR SELECT
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        OR (SELECT private.is_admin())
    );

CREATE POLICY "user_consents_insert_own"
    ON public.user_consents FOR INSERT
    TO authenticated
    WITH CHECK ( (SELECT auth.uid()) = user_id );

-- Policies kyc_requests : l'utilisateur voit ses propres demandes, admin voit tout
CREATE POLICY "kyc_requests_select"
    ON public.kyc_requests FOR SELECT
    TO authenticated
    USING (
        (SELECT auth.uid()) = user_id
        OR (SELECT private.is_admin())
    );

CREATE POLICY "kyc_requests_insert_own"
    ON public.kyc_requests FOR INSERT
    TO authenticated
    WITH CHECK ( (SELECT auth.uid()) = user_id );

CREATE POLICY "kyc_requests_update_admin"
    ON public.kyc_requests FOR UPDATE
    TO authenticated
    USING ( (SELECT private.is_admin()) )
    WITH CHECK ( (SELECT private.is_admin()) );

-- Policies audit_logs : seuls les admins peuvent lire, insertion via service_role uniquement
CREATE POLICY "audit_logs_select_admin"
    ON public.audit_logs FOR SELECT
    TO authenticated
    USING ( (SELECT private.is_admin()) );

-- NOTE : L'insertion dans audit_logs se fait via le backend avec service_role
-- (bypass RLS). Aucune policy INSERT n'est nécessaire pour les utilisateurs.

-- ---- 5. Trigger updated_at sur kyc_requests -------------------------

CREATE TRIGGER on_kyc_requests_updated
    BEFORE UPDATE ON public.kyc_requests
    FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

-- ============================================================
-- FIN DE LA MIGRATION SPRINT 2
-- ============================================================
-- VÉRIFICATIONS RECOMMANDÉES :
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
--   -- Doit inclure : profiles_data, platform_config, user_consents,
--   --               kyc_requests, audit_logs
--
--   SELECT * FROM pg_policies WHERE tablename IN
--     ('user_consents', 'kyc_requests', 'audit_logs');
-- ============================================================
