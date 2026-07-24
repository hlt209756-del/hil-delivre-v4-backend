-- ============================================================================
-- Hil_Delivre v4 — Sprint 7 : Migration SQL
-- Panel Admin, Réconciliation Cash, Statistiques, Modération
-- ============================================================================
-- Prérequis : schema.sql (Sprint 1), schema_sprint2-6.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUM : reconciliation_status
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reconciliation_status') THEN
        CREATE TYPE public.reconciliation_status AS ENUM (
            'pending',
            'submitted',
            'confirmed',
            'disputed',
            'resolved'
        );
    END IF;
END$$;

-- ============================================================================
-- 2. ENUM : payout_status
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status') THEN
        CREATE TYPE public.payout_status AS ENUM (
            'pending',
            'processing',
            'completed',
            'failed',
            'cancelled'
        );
    END IF;
END$$;

-- ============================================================================
-- 3. ENUM : admin_action_type
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_action_type') THEN
        CREATE TYPE public.admin_action_type AS ENUM (
            'user_suspended',
            'user_unsuspended',
            'user_deleted',
            'merchant_approved',
            'merchant_suspended',
            'deliverer_approved',
            'deliverer_suspended',
            'order_refunded',
            'order_cancelled_admin',
            'config_updated',
            'payout_approved',
            'payout_rejected',
            'reconciliation_confirmed',
            'reconciliation_disputed',
            'broadcast_sent'
        );
    END IF;
END$$;

-- ============================================================================
-- 4. TABLE : admin_actions
-- Description : Journal d'audit de toutes les actions administratives.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES public.users(id),
    action_type admin_action_type NOT NULL,
    target_user_id UUID REFERENCES public.users(id),
    target_entity_type TEXT,
    target_entity_id UUID,
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id
    ON public.admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_type
    ON public.admin_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target_user
    ON public.admin_actions(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created_at
    ON public.admin_actions(created_at DESC);

-- RLS (admin only)
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_actions_admin_only ON public.admin_actions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 5. TABLE : reconciliation_records
-- Description : Suivi de la réconciliation cash des livreurs.
-- Quand un livreur collecte du cash, il doit le reverser à la plateforme.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deliverer_id UUID NOT NULL REFERENCES public.users(id),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    total_cash_collected NUMERIC(12, 0) NOT NULL DEFAULT 0,
    total_orders_cash INTEGER NOT NULL DEFAULT 0,
    platform_commission NUMERIC(12, 0) NOT NULL DEFAULT 0,
    delivery_fees_collected NUMERIC(12, 0) NOT NULL DEFAULT 0,
    amount_to_remit NUMERIC(12, 0) NOT NULL DEFAULT 0,
    amount_to_receive NUMERIC(12, 0) NOT NULL DEFAULT 0,
    status reconciliation_status NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMP WITH TIME ZONE,
    confirmed_at TIMESTAMP WITH TIME ZONE,
    confirmed_by UUID REFERENCES public.users(id),
    dispute_reason TEXT,
    resolution_notes TEXT,
    payment_reference TEXT,
    order_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_period CHECK (period_end > period_start),
    CONSTRAINT valid_amounts CHECK (
        total_cash_collected >= 0
        AND platform_commission >= 0
        AND delivery_fees_collected >= 0
        AND amount_to_remit >= 0
        AND amount_to_receive >= 0
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reconciliation_deliverer
    ON public.reconciliation_records(deliverer_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status
    ON public.reconciliation_records(status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_period
    ON public.reconciliation_records(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_reconciliation_created_at
    ON public.reconciliation_records(created_at DESC);

-- RLS
ALTER TABLE public.reconciliation_records ENABLE ROW LEVEL SECURITY;

-- Le livreur ne voit que ses propres enregistrements
CREATE POLICY reconciliation_own ON public.reconciliation_records
    FOR SELECT USING (deliverer_id = auth.uid());

-- Admin voit tout
CREATE POLICY reconciliation_admin ON public.reconciliation_records
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 6. TABLE : merchant_payouts
-- Description : Paiements aux marchands (reversement des commandes).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.users(id),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    total_orders_amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
    total_orders_count INTEGER NOT NULL DEFAULT 0,
    platform_commission NUMERIC(12, 0) NOT NULL DEFAULT 0,
    commission_rate NUMERIC(4, 2) NOT NULL DEFAULT 0.05,
    vat_on_commission NUMERIC(12, 0) NOT NULL DEFAULT 0,
    net_payout NUMERIC(12, 0) NOT NULL DEFAULT 0,
    status payout_status NOT NULL DEFAULT 'pending',
    payment_method TEXT DEFAULT 'mobile_money',
    payment_reference TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    processed_by UUID REFERENCES public.users(id),
    failure_reason TEXT,
    order_ids UUID[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_payout_period CHECK (period_end > period_start),
    CONSTRAINT valid_payout_amounts CHECK (
        total_orders_amount >= 0
        AND platform_commission >= 0
        AND net_payout >= 0
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_merchant_payouts_merchant
    ON public.merchant_payouts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_payouts_status
    ON public.merchant_payouts(status);
CREATE INDEX IF NOT EXISTS idx_merchant_payouts_period
    ON public.merchant_payouts(period_start, period_end);

-- RLS
ALTER TABLE public.merchant_payouts ENABLE ROW LEVEL SECURITY;

-- Le marchand ne voit que ses propres payouts
CREATE POLICY merchant_payouts_own ON public.merchant_payouts
    FOR SELECT USING (merchant_id = auth.uid());

-- Admin voit tout
CREATE POLICY merchant_payouts_admin ON public.merchant_payouts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 7. TABLE : platform_daily_stats
-- Description : Statistiques quotidiennes agrégées de la plateforme.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.platform_daily_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stat_date DATE NOT NULL UNIQUE,
    total_orders INTEGER NOT NULL DEFAULT 0,
    completed_orders INTEGER NOT NULL DEFAULT 0,
    cancelled_orders INTEGER NOT NULL DEFAULT 0,
    total_revenue NUMERIC(12, 0) NOT NULL DEFAULT 0,
    total_commissions NUMERIC(12, 0) NOT NULL DEFAULT 0,
    total_delivery_fees NUMERIC(12, 0) NOT NULL DEFAULT 0,
    total_vat_collected NUMERIC(12, 0) NOT NULL DEFAULT 0,
    total_gmv NUMERIC(12, 0) NOT NULL DEFAULT 0,
    new_users INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    active_merchants INTEGER NOT NULL DEFAULT 0,
    active_deliverers INTEGER NOT NULL DEFAULT 0,
    avg_delivery_time_minutes NUMERIC(6, 1),
    avg_order_value NUMERIC(10, 0),
    avg_delivery_distance_km NUMERIC(6, 2),
    peak_hour INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_platform_stats_date
    ON public.platform_daily_stats(stat_date DESC);

-- RLS (admin only)
ALTER TABLE public.platform_daily_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_stats_admin ON public.platform_daily_stats
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 8. MODIFICATION TABLE profiles_data : Colonnes admin
-- ============================================================================

DO $$
BEGIN
    -- Statut de suspension
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'is_suspended'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN is_suspended BOOLEAN DEFAULT false;
    END IF;

    -- Raison de suspension
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'suspension_reason'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN suspension_reason TEXT;
    END IF;

    -- Date de suspension
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'suspended_at'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN suspended_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Suspendu par (admin_id)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'suspended_by'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN suspended_by UUID;
    END IF;

    -- Solde cash en attente (livreur)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'cash_balance'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN cash_balance NUMERIC(12, 0) DEFAULT 0;
    END IF;

    -- Total des gains (livreur/marchand)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'total_earnings'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN total_earnings NUMERIC(12, 0) DEFAULT 0;
    END IF;

    -- Nombre total de commandes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'total_orders_count'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN total_orders_count INTEGER DEFAULT 0;
    END IF;

    -- Note moyenne (livreur/marchand)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'avg_rating'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN avg_rating NUMERIC(3, 2) DEFAULT 0;
    END IF;
END$$;

-- ============================================================================
-- 9. FONCTION : Calculer les stats quotidiennes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_daily_stats(p_date DATE DEFAULT CURRENT_DATE - 1)
RETURNS VOID AS $$
DECLARE
    v_stats RECORD;
BEGIN
    SELECT
        COUNT(*) FILTER (WHERE TRUE) AS total_orders,
        COUNT(*) FILTER (WHERE status = 'delivered') AS completed_orders,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_orders,
        COALESCE(SUM(commission_amount) FILTER (WHERE status = 'delivered'), 0) AS total_commissions,
        COALESCE(SUM(delivery_fee) FILTER (WHERE status = 'delivered'), 0) AS total_delivery_fees,
        COALESCE(SUM(vat_amount) FILTER (WHERE status = 'delivered'), 0) AS total_vat,
        COALESCE(SUM(total_amount) FILTER (WHERE status = 'delivered'), 0) AS total_gmv,
        COALESCE(SUM(commission_amount + delivery_fee * 0.01) FILTER (WHERE status = 'delivered'), 0) AS total_revenue,
        COALESCE(AVG(EXTRACT(EPOCH FROM (delivered_at - created_at)) / 60) FILTER (WHERE status = 'delivered'), 0) AS avg_delivery_time,
        COALESCE(AVG(food_amount) FILTER (WHERE status = 'delivered'), 0) AS avg_order_value,
        COALESCE(AVG(delivery_distance_km) FILTER (WHERE status = 'delivered'), 0) AS avg_distance
    INTO v_stats
    FROM public.orders
    WHERE created_at::date = p_date;

    INSERT INTO public.platform_daily_stats (
        stat_date,
        total_orders,
        completed_orders,
        cancelled_orders,
        total_revenue,
        total_commissions,
        total_delivery_fees,
        total_vat_collected,
        total_gmv,
        avg_delivery_time_minutes,
        avg_order_value,
        avg_delivery_distance_km,
        new_users,
        active_users,
        active_merchants,
        active_deliverers
    ) VALUES (
        p_date,
        v_stats.total_orders,
        v_stats.completed_orders,
        v_stats.cancelled_orders,
        v_stats.total_revenue,
        v_stats.total_commissions,
        v_stats.total_delivery_fees,
        v_stats.total_vat,
        v_stats.total_gmv,
        v_stats.avg_delivery_time,
        v_stats.avg_order_value,
        v_stats.avg_distance,
        (SELECT COUNT(*) FROM public.profiles_data WHERE created_at::date = p_date),
        (SELECT COUNT(DISTINCT client_id) FROM public.orders WHERE created_at::date = p_date),
        (SELECT COUNT(DISTINCT merchant_id) FROM public.orders WHERE created_at::date = p_date),
        (SELECT COUNT(DISTINCT delivery_id) FROM public.orders WHERE created_at::date = p_date AND delivery_id IS NOT NULL)
    )
    ON CONFLICT (stat_date) DO UPDATE SET
        total_orders = EXCLUDED.total_orders,
        completed_orders = EXCLUDED.completed_orders,
        cancelled_orders = EXCLUDED.cancelled_orders,
        total_revenue = EXCLUDED.total_revenue,
        total_commissions = EXCLUDED.total_commissions,
        total_delivery_fees = EXCLUDED.total_delivery_fees,
        total_vat_collected = EXCLUDED.total_vat_collected,
        total_gmv = EXCLUDED.total_gmv,
        avg_delivery_time_minutes = EXCLUDED.avg_delivery_time_minutes,
        avg_order_value = EXCLUDED.avg_order_value,
        avg_delivery_distance_km = EXCLUDED.avg_delivery_distance_km,
        new_users = EXCLUDED.new_users,
        active_users = EXCLUDED.active_users,
        active_merchants = EXCLUDED.active_merchants,
        active_deliverers = EXCLUDED.active_deliverers;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 10. FONCTION : Générer un enregistrement de réconciliation pour un livreur
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_reconciliation(
    p_deliverer_id UUID,
    p_period_start TIMESTAMP WITH TIME ZONE,
    p_period_end TIMESTAMP WITH TIME ZONE
)
RETURNS UUID AS $$
DECLARE
    v_record_id UUID;
    v_total_cash NUMERIC(12, 0);
    v_total_orders INTEGER;
    v_commission NUMERIC(12, 0);
    v_delivery_fees NUMERIC(12, 0);
    v_amount_to_remit NUMERIC(12, 0);
    v_amount_to_receive NUMERIC(12, 0);
    v_order_ids UUID[];
BEGIN
    -- Calculer les totaux pour la période
    SELECT
        COALESCE(SUM(total_amount), 0),
        COUNT(*),
        COALESCE(SUM(commission_amount), 0),
        COALESCE(SUM(delivery_fee), 0),
        ARRAY_AGG(id)
    INTO v_total_cash, v_total_orders, v_commission, v_delivery_fees, v_order_ids
    FROM public.orders
    WHERE delivery_id = p_deliverer_id
    AND payment_method = 'cash'
    AND status = 'delivered'
    AND delivered_at BETWEEN p_period_start AND p_period_end;

    -- Calcul : le livreur a collecté le total cash
    -- Il doit reverser : total - ses frais de livraison
    -- La plateforme lui doit : ses frais de livraison (déjà collectés en cash)
    -- Net : livreur reverse (total_cash - delivery_fees) à la plateforme
    v_amount_to_remit := GREATEST(v_total_cash - v_delivery_fees, 0);
    v_amount_to_receive := GREATEST(v_delivery_fees - v_total_cash, 0);

    INSERT INTO public.reconciliation_records (
        deliverer_id,
        period_start,
        period_end,
        total_cash_collected,
        total_orders_cash,
        platform_commission,
        delivery_fees_collected,
        amount_to_remit,
        amount_to_receive,
        order_ids
    ) VALUES (
        p_deliverer_id,
        p_period_start,
        p_period_end,
        v_total_cash,
        v_total_orders,
        v_commission,
        v_delivery_fees,
        v_amount_to_remit,
        v_amount_to_receive,
        v_order_ids
    ) RETURNING id INTO v_record_id;

    RETURN v_record_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 11. GRANTS
-- ============================================================================

GRANT ALL ON public.admin_actions TO service_role;
GRANT ALL ON public.reconciliation_records TO authenticated;
GRANT ALL ON public.reconciliation_records TO service_role;
GRANT ALL ON public.merchant_payouts TO authenticated;
GRANT ALL ON public.merchant_payouts TO service_role;
GRANT ALL ON public.platform_daily_stats TO service_role;
GRANT SELECT ON public.platform_daily_stats TO authenticated;

COMMIT;

-- ============================================================================
-- FIN Migration Sprint 7
-- ============================================================================
