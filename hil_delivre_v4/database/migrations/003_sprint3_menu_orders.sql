-- ============================================================
-- Hil_Delivre v4 — Sprint 3 : Migration additionnelle
-- Tunnel de commande : Menu, Panier, Commandes
-- ============================================================
-- Ce script est une MIGRATION ADDITIVE aux schémas Sprint 1 et 2.
-- À exécuter APRÈS schema.sql et schema_sprint2.sql dans le SQL Editor de Supabase.
-- ============================================================

-- ---- 1. Types ENUM pour les commandes --------------------------------

DO $$ BEGIN
    CREATE TYPE public.order_status AS ENUM (
        'pending',
        'accepted',
        'preparing',
        'ready_for_pickup',
        'on_the_way',
        'delivered',
        'cancelled',
        'refunded'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.payment_method_type AS ENUM (
        'mobile_money',
        'cash'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE public.cash_payment_status_type AS ENUM (
        'pending',
        'reconciled',
        'disputed'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ---- 2. Table menu_items --------------------------------

CREATE TABLE IF NOT EXISTS public.menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    image_url TEXT,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    stock_quantity INTEGER,
    -- Contraintes métier
    CONSTRAINT menu_items_price_positive CHECK (price > 0),
    CONSTRAINT menu_items_stock_non_negative CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
    CONSTRAINT menu_items_name_length CHECK (char_length(name) >= 2 AND char_length(name) <= 200),
    -- Horodatage
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_menu_items_merchant_id ON public.menu_items(merchant_id);
CREATE INDEX idx_menu_items_category ON public.menu_items(category);
CREATE INDEX idx_menu_items_available ON public.menu_items(merchant_id, is_available) WHERE is_available = TRUE;

COMMENT ON TABLE public.menu_items IS 'Articles disponibles dans le menu d''un marchand. Le prix est en FCFA.';

-- ---- 3. Table orders --------------------------------

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Acteurs
    client_id UUID NOT NULL REFERENCES auth.users(id),
    merchant_id UUID NOT NULL REFERENCES auth.users(id),
    delivery_id UUID REFERENCES auth.users(id),
    -- Statut
    status public.order_status NOT NULL DEFAULT 'pending',
    -- Montants financiers (tous en FCFA)
    food_amount NUMERIC NOT NULL DEFAULT 0,
    commission_amount NUMERIC NOT NULL DEFAULT 0,
    delivery_fee NUMERIC NOT NULL DEFAULT 0,
    surge_amount NUMERIC NOT NULL DEFAULT 0,
    platform_vat_amount NUMERIC NOT NULL DEFAULT 0,
    service_fees NUMERIC NOT NULL DEFAULT 0,
    delivery_commission_amount NUMERIC NOT NULL DEFAULT 0,
    reconciliation_fee NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    -- Paiement
    payment_method public.payment_method_type,
    cash_payment_status public.cash_payment_status_type,
    -- Livraison
    delivery_distance_km NUMERIC,
    delivery_fee_detail JSONB,
    delivery_address TEXT,
    delivery_latitude NUMERIC,
    delivery_longitude NUMERIC,
    pickup_address TEXT,
    pickup_latitude NUMERIC,
    pickup_longitude NUMERIC,
    estimated_delivery_time TIMESTAMP WITH TIME ZONE,
    actual_delivery_time TIMESTAMP WITH TIME ZONE,
    -- OTP de confirmation
    otp_code TEXT,
    otp_expires_at TIMESTAMP WITH TIME ZONE,
    -- Notes
    client_note TEXT,
    cancellation_reason TEXT,
    -- Horodatage
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Contraintes
    CONSTRAINT orders_food_amount_non_negative CHECK (food_amount >= 0),
    CONSTRAINT orders_total_amount_non_negative CHECK (total_amount >= 0),
    CONSTRAINT orders_delivery_fee_non_negative CHECK (delivery_fee >= 0),
    CONSTRAINT orders_client_not_merchant CHECK (client_id != merchant_id)
);

CREATE INDEX idx_orders_client_id ON public.orders(client_id);
CREATE INDEX idx_orders_merchant_id ON public.orders(merchant_id);
CREATE INDEX idx_orders_delivery_id ON public.orders(delivery_id);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX idx_orders_client_status ON public.orders(client_id, status);
CREATE INDEX idx_orders_merchant_status ON public.orders(merchant_id, status);

COMMENT ON TABLE public.orders IS 'Commandes passées sur la plateforme. Tous les montants sont en FCFA.';

-- ---- 4. Table order_items --------------------------------

CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES public.menu_items(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL,
    total_price NUMERIC NOT NULL,
    -- Snapshot du nom au moment de la commande (pour historique si le marchand renomme)
    item_name_snapshot TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Contraintes
    CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT order_items_unit_price_positive CHECK (unit_price > 0),
    CONSTRAINT order_items_total_price_positive CHECK (total_price > 0)
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX idx_order_items_menu_item_id ON public.order_items(menu_item_id);

COMMENT ON TABLE public.order_items IS 'Détails des articles inclus dans chaque commande. Le prix est snapshotté au moment de la commande.';

-- ---- 5. Triggers updated_at --------------------------------

CREATE TRIGGER on_menu_items_updated
    BEFORE UPDATE ON public.menu_items
    FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

CREATE TRIGGER on_orders_updated
    BEFORE UPDATE ON public.orders
    FOR EACH ROW EXECUTE FUNCTION private.handle_updated_at();

-- ---- 6. RLS --------------------------------

ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- menu_items : lecture publique, écriture par le marchand propriétaire ou admin
CREATE POLICY "menu_items_select_public"
    ON public.menu_items FOR SELECT
    TO authenticated, anon
    USING (TRUE);

CREATE POLICY "menu_items_insert_merchant"
    ON public.menu_items FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) = merchant_id
        OR (SELECT private.is_admin())
    );

CREATE POLICY "menu_items_update_merchant"
    ON public.menu_items FOR UPDATE
    TO authenticated
    USING (
        (SELECT auth.uid()) = merchant_id
        OR (SELECT private.is_admin())
    )
    WITH CHECK (
        (SELECT auth.uid()) = merchant_id
        OR (SELECT private.is_admin())
    );

CREATE POLICY "menu_items_delete_merchant"
    ON public.menu_items FOR DELETE
    TO authenticated
    USING (
        (SELECT auth.uid()) = merchant_id
        OR (SELECT private.is_admin())
    );

-- orders : le client voit ses commandes, le marchand voit les commandes qui le concernent,
-- le livreur voit celles qui lui sont assignées, l'admin voit tout
CREATE POLICY "orders_select"
    ON public.orders FOR SELECT
    TO authenticated
    USING (
        (SELECT auth.uid()) = client_id
        OR (SELECT auth.uid()) = merchant_id
        OR (SELECT auth.uid()) = delivery_id
        OR (SELECT private.is_admin())
    );

CREATE POLICY "orders_insert_client"
    ON public.orders FOR INSERT
    TO authenticated
    WITH CHECK ( (SELECT auth.uid()) = client_id );

CREATE POLICY "orders_update"
    ON public.orders FOR UPDATE
    TO authenticated
    USING (
        (SELECT auth.uid()) = client_id
        OR (SELECT auth.uid()) = merchant_id
        OR (SELECT auth.uid()) = delivery_id
        OR (SELECT private.is_admin())
    );

-- order_items : visibles par les parties de la commande
CREATE POLICY "order_items_select"
    ON public.order_items FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id
            AND (
                (SELECT auth.uid()) = o.client_id
                OR (SELECT auth.uid()) = o.merchant_id
                OR (SELECT auth.uid()) = o.delivery_id
                OR (SELECT private.is_admin())
            )
        )
    );

CREATE POLICY "order_items_insert"
    ON public.order_items FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = order_id
            AND (SELECT auth.uid()) = o.client_id
        )
    );

-- ============================================================
-- FIN DE LA MIGRATION SPRINT 3
-- ============================================================
-- VÉRIFICATIONS RECOMMANDÉES :
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
--   -- Doit inclure : profiles_data, platform_config, user_consents,
--   --               kyc_requests, audit_logs, menu_items, orders, order_items
--
--   SELECT * FROM pg_policies WHERE tablename IN
--     ('menu_items', 'orders', 'order_items');
-- ============================================================
