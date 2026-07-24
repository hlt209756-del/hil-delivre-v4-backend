-- ============================================================================
-- Hil_Delivre v4 — Sprint 4 : Migration SQL
-- Paiement (Mobile Money + Cash), TVA, FEC, Platform Config
-- ============================================================================
-- Prérequis : schema.sql (Sprint 1), schema_sprint2.sql, schema_sprint3.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLE : platform_config
-- Description : Paramètres de configuration modifiables par l'administrateur.
-- Permet d'ajuster les taux de commission, frais, TVA sans redéploiement.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key TEXT NOT NULL UNIQUE,
    config_value NUMERIC NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL
);

-- Index sur config_key pour les lookups rapides
CREATE INDEX IF NOT EXISTS idx_platform_config_key ON public.platform_config(config_key);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_platform_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_platform_config_updated_at ON public.platform_config;
CREATE TRIGGER trg_platform_config_updated_at
    BEFORE UPDATE ON public.platform_config
    FOR EACH ROW
    EXECUTE FUNCTION public.update_platform_config_updated_at();

-- RLS sur platform_config
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

-- Lecture publique (les taux sont nécessaires côté client pour l'affichage)
CREATE POLICY platform_config_select_all ON public.platform_config
    FOR SELECT USING (true);

-- Modification réservée aux admins
CREATE POLICY platform_config_update_admin ON public.platform_config
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Insertion réservée aux admins
CREATE POLICY platform_config_insert_admin ON public.platform_config
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 2. SEED DATA : platform_config (valeurs par défaut du plan v4)
-- ============================================================================

INSERT INTO public.platform_config (config_key, config_value, description) VALUES
    ('merchant_commission_rate', 0.05, 'Taux de commission sur la nourriture vendue par les marchands (5%)'),
    ('delivery_commission_rate', 0.01, 'Taux de commission plateforme sur les frais de livraison (1%)'),
    ('platform_vat_rate', 0.18, 'Taux de TVA sur les services propres de la plateforme (18%)'),
    ('delivery_base_fee', 250, 'Frais de livraison fixes de base en FCFA'),
    ('delivery_rate_per_km_tier1', 120, 'Tarif par km pour les 5 premiers km en FCFA'),
    ('delivery_rate_per_km_tier2', 90, 'Tarif par km au-delà de 5 km en FCFA (dégressif)'),
    ('delivery_tier1_max_km', 5, 'Distance maximale du palier 1 en km'),
    ('delivery_min_guaranteed', 500, 'Montant minimum garanti au livreur par course en FCFA'),
    ('merchant_subscription_amount', 5000, 'Montant abonnement mensuel marchand en FCFA'),
    ('delivery_subscription_amount', 2500, 'Montant abonnement mensuel livreur en FCFA'),
    ('cash_reconciliation_fee_rate', 0.05, 'Taux de frais de réconciliation cash (5%)'),
    ('surge_platform_share', 0.30, 'Part plateforme du surge pricing (30%)'),
    ('service_fee_rate', 0.02, 'Taux de frais de service client (2%)')
ON CONFLICT (config_key) DO NOTHING;

-- ============================================================================
-- 3. ENUM : payment_transaction_status
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_transaction_status') THEN
        CREATE TYPE public.payment_transaction_status AS ENUM (
            'initiated',
            'pending',
            'completed',
            'failed',
            'cancelled',
            'refunded'
        );
    END IF;
END$$;

-- ============================================================================
-- 4. TABLE : payment_transactions
-- Description : Historique complet des transactions de paiement.
-- Assure l'idempotence et la traçabilité de chaque opération financière.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    payment_method payment_method_type NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'XOF',
    status payment_transaction_status NOT NULL DEFAULT 'initiated',
    provider TEXT DEFAULT 'paydunya',
    provider_ref TEXT,
    provider_token TEXT,
    provider_response_url TEXT,
    provider_status TEXT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 1,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT payment_amount_positive CHECK (amount > 0),
    CONSTRAINT payment_attempts_valid CHECK (attempts >= 1 AND attempts <= max_attempts)
);

-- Indexes pour payment_transactions
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order_id ON public.payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON public.payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON public.payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_provider_ref ON public.payment_transactions(provider_ref);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_idempotency ON public.payment_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_created_at ON public.payment_transactions(created_at DESC);

-- Trigger updated_at pour payment_transactions
DROP TRIGGER IF EXISTS trg_payment_transactions_updated_at ON public.payment_transactions;
CREATE TRIGGER trg_payment_transactions_updated_at
    BEFORE UPDATE ON public.payment_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_platform_config_updated_at();

-- RLS sur payment_transactions
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Le client voit ses propres transactions
CREATE POLICY payment_transactions_select_own ON public.payment_transactions
    FOR SELECT USING (user_id = auth.uid());

-- Le marchand voit les transactions de ses commandes
CREATE POLICY payment_transactions_select_merchant ON public.payment_transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = payment_transactions.order_id
            AND orders.merchant_id = auth.uid()
        )
    );

-- L'admin voit tout
CREATE POLICY payment_transactions_select_admin ON public.payment_transactions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Insertion uniquement par le service backend (via service_role_key)
CREATE POLICY payment_transactions_insert_service ON public.payment_transactions
    FOR INSERT WITH CHECK (true);

-- Mise à jour uniquement par le service backend
CREATE POLICY payment_transactions_update_service ON public.payment_transactions
    FOR UPDATE USING (true);

-- ============================================================================
-- 5. ENUM : invoice_fec_status
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_fec_status') THEN
        CREATE TYPE public.invoice_fec_status AS ENUM (
            'generated',
            'submitted',
            'failed'
        );
    END IF;
END$$;

-- ============================================================================
-- 6. TABLE : invoices_fec
-- Description : Factures électroniques conformes FEC/DGI.
-- Hil_Delivre facture ses propres services (commission + frais de livraison).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invoices_fec (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
    merchant_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    client_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    invoice_number TEXT NOT NULL UNIQUE,
    invoice_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Montants des services propres de Hil_Delivre
    commission_ht NUMERIC NOT NULL DEFAULT 0,
    delivery_fee_ht NUMERIC NOT NULL DEFAULT 0,
    total_ht NUMERIC NOT NULL DEFAULT 0,
    total_tva NUMERIC NOT NULL DEFAULT 0,
    total_ttc NUMERIC NOT NULL DEFAULT 0,
    vat_rate NUMERIC NOT NULL DEFAULT 0.18,
    -- Données complètes FEC en JSONB pour flexibilité et conformité
    fec_data JSONB NOT NULL DEFAULT '{}',
    status invoice_fec_status NOT NULL DEFAULT 'generated',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes pour invoices_fec
CREATE INDEX IF NOT EXISTS idx_invoices_fec_order_id ON public.invoices_fec(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_fec_merchant_id ON public.invoices_fec(merchant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_fec_client_id ON public.invoices_fec(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_fec_invoice_number ON public.invoices_fec(invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_fec_invoice_date ON public.invoices_fec(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_fec_status ON public.invoices_fec(status);

-- Trigger updated_at pour invoices_fec
DROP TRIGGER IF EXISTS trg_invoices_fec_updated_at ON public.invoices_fec;
CREATE TRIGGER trg_invoices_fec_updated_at
    BEFORE UPDATE ON public.invoices_fec
    FOR EACH ROW
    EXECUTE FUNCTION public.update_platform_config_updated_at();

-- RLS sur invoices_fec
ALTER TABLE public.invoices_fec ENABLE ROW LEVEL SECURITY;

-- Le client voit ses propres factures
CREATE POLICY invoices_fec_select_client ON public.invoices_fec
    FOR SELECT USING (client_id = auth.uid());

-- Le marchand voit les factures de ses commandes
CREATE POLICY invoices_fec_select_merchant ON public.invoices_fec
    FOR SELECT USING (merchant_id = auth.uid());

-- L'admin voit toutes les factures
CREATE POLICY invoices_fec_select_admin ON public.invoices_fec
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- Insertion par le service backend uniquement
CREATE POLICY invoices_fec_insert_service ON public.invoices_fec
    FOR INSERT WITH CHECK (true);

-- Mise à jour par le service backend uniquement
CREATE POLICY invoices_fec_update_service ON public.invoices_fec
    FOR UPDATE USING (true);

-- ============================================================================
-- 7. SEQUENCE : Numérotation séquentielle des factures FEC
-- Format : HIL-YYYY-NNNNNN (ex: HIL-2024-000001)
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.invoice_fec_seq
    START WITH 1
    INCREMENT BY 1
    NO MAXVALUE
    CACHE 1;

-- ============================================================================
-- 8. FONCTION : Génération du numéro de facture FEC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
    seq_val BIGINT;
    year_str TEXT;
BEGIN
    seq_val := nextval('public.invoice_fec_seq');
    year_str := EXTRACT(YEAR FROM NOW())::TEXT;
    RETURN 'HIL-' || year_str || '-' || LPAD(seq_val::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 9. MODIFICATION TABLE orders : Ajout colonne payment_transaction_id
-- Lien vers la transaction de paiement active
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = 'payment_transaction_id'
    ) THEN
        ALTER TABLE public.orders
            ADD COLUMN payment_transaction_id UUID REFERENCES public.payment_transactions(id);
    END IF;
END$$;

-- ============================================================================
-- 10. FONCTION PRIVÉE : Calcul des montants de commande
-- Utilisée par le backend pour recalculer les montants avec les taux actuels
-- ============================================================================

CREATE OR REPLACE FUNCTION private.calculate_order_amounts(
    p_food_amount NUMERIC,
    p_delivery_fee NUMERIC DEFAULT 0,
    p_surge_amount NUMERIC DEFAULT 0
)
RETURNS JSONB AS $$
DECLARE
    v_commission_rate NUMERIC;
    v_vat_rate NUMERIC;
    v_commission NUMERIC;
    v_platform_vat NUMERIC;
    v_service_fees NUMERIC;
    v_total NUMERIC;
BEGIN
    -- Récupérer les taux depuis platform_config
    SELECT config_value INTO v_commission_rate
    FROM public.platform_config WHERE config_key = 'merchant_commission_rate';

    SELECT config_value INTO v_vat_rate
    FROM public.platform_config WHERE config_key = 'platform_vat_rate';

    -- Valeurs par défaut si non trouvées
    v_commission_rate := COALESCE(v_commission_rate, 0.05);
    v_vat_rate := COALESCE(v_vat_rate, 0.18);

    -- Calculs
    v_commission := CEIL(p_food_amount * v_commission_rate);
    v_platform_vat := CEIL((v_commission + p_delivery_fee) * v_vat_rate);
    v_service_fees := v_commission + v_platform_vat;
    v_total := p_food_amount + v_service_fees + p_delivery_fee + p_surge_amount;

    RETURN jsonb_build_object(
        'food_amount', p_food_amount,
        'commission_amount', v_commission,
        'delivery_fee', p_delivery_fee,
        'surge_amount', p_surge_amount,
        'platform_vat_amount', v_platform_vat,
        'service_fees', v_service_fees,
        'total_amount', v_total,
        'commission_rate', v_commission_rate,
        'vat_rate', v_vat_rate
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 11. GRANT : Permissions pour le service backend
-- ============================================================================

GRANT USAGE ON SEQUENCE public.invoice_fec_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.invoice_fec_seq TO service_role;
GRANT SELECT ON public.platform_config TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;
GRANT ALL ON public.invoices_fec TO service_role;

COMMIT;

-- ============================================================================
-- FIN Migration Sprint 4
-- ============================================================================
