-- ============================================================================
-- Hil_Delivre v4 — Sprint 5 : Migration SQL
-- Livraison : Géolocalisation, Distance OSRM, Assignation, Surge Pricing
-- ============================================================================
-- Prérequis : schema.sql (Sprint 1), schema_sprint2.sql, schema_sprint3.sql,
--             schema_sprint4.sql
-- Dépendance : Extension PostGIS (activée dans Supabase par défaut)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ACTIVATION PostGIS (si pas déjà activée)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================================
-- 2. ENUM : delivery_assignment_status
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_assignment_status') THEN
        CREATE TYPE public.delivery_assignment_status AS ENUM (
            'proposed',
            'accepted',
            'rejected',
            'expired',
            'cancelled'
        );
    END IF;
END$$;

-- ============================================================================
-- 3. ENUM : deliverer_availability_status
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deliverer_availability_status') THEN
        CREATE TYPE public.deliverer_availability_status AS ENUM (
            'online',
            'busy',
            'offline'
        );
    END IF;
END$$;

-- ============================================================================
-- 4. TABLE : deliverer_locations
-- Description : Position GPS en temps réel des livreurs.
-- Mise à jour toutes les 10-30 secondes quand le livreur est en ligne.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deliverer_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deliverer_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    heading NUMERIC(5, 2),
    speed NUMERIC(6, 2),
    accuracy NUMERIC(6, 2),
    availability deliverer_availability_status NOT NULL DEFAULT 'offline',
    current_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_latitude CHECK (latitude >= -90 AND latitude <= 90),
    CONSTRAINT valid_longitude CHECK (longitude >= -180 AND longitude <= 180)
);

-- Index spatial pour les requêtes de proximité
CREATE INDEX IF NOT EXISTS idx_deliverer_locations_geo
    ON public.deliverer_locations USING GIST (location);

-- Index sur la disponibilité pour filtrer les livreurs en ligne
CREATE INDEX IF NOT EXISTS idx_deliverer_locations_availability
    ON public.deliverer_locations(availability)
    WHERE availability = 'online';

-- Index sur deliverer_id pour les lookups rapides
CREATE INDEX IF NOT EXISTS idx_deliverer_locations_deliverer_id
    ON public.deliverer_locations(deliverer_id);

-- Index sur last_updated_at pour détecter les livreurs inactifs
CREATE INDEX IF NOT EXISTS idx_deliverer_locations_last_updated
    ON public.deliverer_locations(last_updated_at DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.update_deliverer_location_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated_at = NOW();
    NEW.location = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_deliverer_locations_update ON public.deliverer_locations;
CREATE TRIGGER trg_deliverer_locations_update
    BEFORE INSERT OR UPDATE ON public.deliverer_locations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_deliverer_location_timestamp();

-- RLS
ALTER TABLE public.deliverer_locations ENABLE ROW LEVEL SECURITY;

-- Le livreur peut voir et modifier sa propre position
CREATE POLICY deliverer_locations_own ON public.deliverer_locations
    FOR ALL USING (deliverer_id = auth.uid());

-- Les clients et marchands peuvent voir les positions des livreurs assignés à leurs commandes
CREATE POLICY deliverer_locations_order_parties ON public.deliverer_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.delivery_id = deliverer_locations.deliverer_id
            AND (orders.client_id = auth.uid() OR orders.merchant_id = auth.uid())
            AND orders.status IN ('ready', 'picked_up', 'in_delivery')
        )
    );

-- Admin voit tout
CREATE POLICY deliverer_locations_admin ON public.deliverer_locations
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 5. TABLE : delivery_assignments
-- Description : Historique des propositions de course aux livreurs.
-- Permet le matching et le suivi des acceptations/rejets.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    deliverer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status delivery_assignment_status NOT NULL DEFAULT 'proposed',
    distance_to_merchant NUMERIC(8, 2),
    estimated_pickup_time INTEGER,
    proposed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    responded_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '60 seconds'),
    rejection_reason TEXT,
    assignment_round INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_active_assignment UNIQUE (order_id, deliverer_id, assignment_round)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_order_id
    ON public.delivery_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_deliverer_id
    ON public.delivery_assignments(deliverer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_status
    ON public.delivery_assignments(status);
CREATE INDEX IF NOT EXISTS idx_delivery_assignments_expires_at
    ON public.delivery_assignments(expires_at)
    WHERE status = 'proposed';

-- RLS
ALTER TABLE public.delivery_assignments ENABLE ROW LEVEL SECURITY;

-- Le livreur voit ses propres assignations
CREATE POLICY delivery_assignments_deliverer ON public.delivery_assignments
    FOR ALL USING (deliverer_id = auth.uid());

-- Le client voit les assignations de ses commandes (lecture seule)
CREATE POLICY delivery_assignments_client ON public.delivery_assignments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = delivery_assignments.order_id
            AND orders.client_id = auth.uid()
        )
    );

-- Le marchand voit les assignations de ses commandes (lecture seule)
CREATE POLICY delivery_assignments_merchant ON public.delivery_assignments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = delivery_assignments.order_id
            AND orders.merchant_id = auth.uid()
        )
    );

-- Admin voit tout
CREATE POLICY delivery_assignments_admin ON public.delivery_assignments
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 6. TABLE : delivery_zones
-- Description : Zones de livraison avec tarification spécifique.
-- Permet de définir des zones géographiques avec des tarifs différents.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    city TEXT NOT NULL DEFAULT 'Ouagadougou',
    polygon GEOGRAPHY(POLYGON, 4326),
    base_fee NUMERIC NOT NULL DEFAULT 250,
    rate_per_km NUMERIC NOT NULL DEFAULT 120,
    is_active BOOLEAN NOT NULL DEFAULT true,
    surge_multiplier NUMERIC NOT NULL DEFAULT 1.0 CHECK (surge_multiplier >= 1.0 AND surge_multiplier <= 5.0),
    max_delivery_radius_km NUMERIC NOT NULL DEFAULT 15,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index spatial pour les zones
CREATE INDEX IF NOT EXISTS idx_delivery_zones_polygon
    ON public.delivery_zones USING GIST (polygon);

-- RLS
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

-- Lecture publique (les zones sont nécessaires côté client)
CREATE POLICY delivery_zones_select_all ON public.delivery_zones
    FOR SELECT USING (true);

-- Modification admin uniquement
CREATE POLICY delivery_zones_admin ON public.delivery_zones
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 7. TABLE : surge_pricing_config
-- Description : Configuration du surge pricing par créneaux horaires.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.surge_pricing_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    day_of_week INTEGER[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    multiplier NUMERIC NOT NULL DEFAULT 1.0 CHECK (multiplier >= 1.0 AND multiplier <= 3.0),
    min_active_deliverers INTEGER NOT NULL DEFAULT 0,
    max_pending_orders INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (start_time < end_time)
);

-- RLS
ALTER TABLE public.surge_pricing_config ENABLE ROW LEVEL SECURITY;

-- Lecture publique
CREATE POLICY surge_pricing_select_all ON public.surge_pricing_config
    FOR SELECT USING (true);

-- Modification admin uniquement
CREATE POLICY surge_pricing_admin ON public.surge_pricing_config
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 8. TABLE : delivery_tracking_events
-- Description : Historique des événements de livraison pour le suivi.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    deliverer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_order_id
    ON public.delivery_tracking_events(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_created_at
    ON public.delivery_tracking_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_event_type
    ON public.delivery_tracking_events(event_type);

-- RLS
ALTER TABLE public.delivery_tracking_events ENABLE ROW LEVEL SECURITY;

-- Les parties de la commande peuvent voir les événements
CREATE POLICY delivery_tracking_parties ON public.delivery_tracking_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.orders
            WHERE orders.id = delivery_tracking_events.order_id
            AND (orders.client_id = auth.uid()
                 OR orders.merchant_id = auth.uid()
                 OR orders.delivery_id = auth.uid())
        )
    );

-- Le livreur peut insérer des événements pour ses commandes
CREATE POLICY delivery_tracking_insert_deliverer ON public.delivery_tracking_events
    FOR INSERT WITH CHECK (deliverer_id = auth.uid());

-- Admin voit tout
CREATE POLICY delivery_tracking_admin ON public.delivery_tracking_events
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 9. MODIFICATION TABLE orders : Ajout colonnes livraison
-- ============================================================================

DO $$
BEGIN
    -- Distance en km entre marchand et client
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'delivery_distance_km'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN delivery_distance_km NUMERIC(8, 2);
    END IF;

    -- Durée estimée de livraison en minutes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'estimated_delivery_minutes'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN estimated_delivery_minutes INTEGER;
    END IF;

    -- Coordonnées GPS du marchand
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'merchant_latitude'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN merchant_latitude NUMERIC(10, 7);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'merchant_longitude'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN merchant_longitude NUMERIC(10, 7);
    END IF;

    -- Coordonnées GPS de livraison
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'delivery_latitude'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN delivery_latitude NUMERIC(10, 7);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'delivery_longitude'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN delivery_longitude NUMERIC(10, 7);
    END IF;

    -- Multiplicateur surge appliqué
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'surge_multiplier'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN surge_multiplier NUMERIC(3, 2) DEFAULT 1.0;
    END IF;

    -- Heure de pickup effective
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'picked_up_at'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN picked_up_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Heure de livraison effective
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'delivered_at'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN delivered_at TIMESTAMP WITH TIME ZONE;
    END IF;
END$$;

-- ============================================================================
-- 10. SEED DATA : Zones de livraison par défaut (Ouagadougou)
-- ============================================================================

INSERT INTO public.delivery_zones (name, city, base_fee, rate_per_km, max_delivery_radius_km) VALUES
    ('Centre-ville Ouagadougou', 'Ouagadougou', 250, 120, 5),
    ('Périphérie Ouagadougou', 'Ouagadougou', 350, 100, 15),
    ('Bobo-Dioulasso Centre', 'Bobo-Dioulasso', 250, 120, 5)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 11. SEED DATA : Surge pricing par défaut
-- ============================================================================

INSERT INTO public.surge_pricing_config (name, day_of_week, start_time, end_time, multiplier) VALUES
    ('Déjeuner semaine', '{1,2,3,4,5}', '11:30', '13:30', 1.3),
    ('Dîner semaine', '{1,2,3,4,5}', '19:00', '21:00', 1.2),
    ('Weekend midi', '{0,6}', '12:00', '14:00', 1.5),
    ('Weekend soir', '{0,6}', '19:00', '22:00', 1.4)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 12. FONCTION : Trouver les livreurs les plus proches
-- ============================================================================

CREATE OR REPLACE FUNCTION public.find_nearest_deliverers(
    p_latitude NUMERIC,
    p_longitude NUMERIC,
    p_radius_km NUMERIC DEFAULT 5,
    p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
    deliverer_id UUID,
    distance_meters NUMERIC,
    latitude NUMERIC,
    longitude NUMERIC,
    availability deliverer_availability_status
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        dl.deliverer_id,
        ST_Distance(
            dl.location,
            ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
        )::NUMERIC AS distance_meters,
        dl.latitude,
        dl.longitude,
        dl.availability
    FROM public.deliverer_locations dl
    WHERE dl.availability = 'online'
    AND dl.last_updated_at > NOW() - INTERVAL '5 minutes'
    AND ST_DWithin(
        dl.location,
        ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
        p_radius_km * 1000
    )
    ORDER BY distance_meters ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 13. GRANTS
-- ============================================================================

GRANT ALL ON public.deliverer_locations TO authenticated;
GRANT ALL ON public.delivery_assignments TO authenticated;
GRANT SELECT ON public.delivery_zones TO authenticated;
GRANT SELECT ON public.surge_pricing_config TO authenticated;
GRANT ALL ON public.delivery_tracking_events TO authenticated;
GRANT ALL ON public.deliverer_locations TO service_role;
GRANT ALL ON public.delivery_assignments TO service_role;
GRANT ALL ON public.delivery_zones TO service_role;
GRANT ALL ON public.surge_pricing_config TO service_role;
GRANT ALL ON public.delivery_tracking_events TO service_role;

COMMIT;

-- ============================================================================
-- FIN Migration Sprint 5
-- ============================================================================
