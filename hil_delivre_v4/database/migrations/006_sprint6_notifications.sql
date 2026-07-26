-- ============================================================================
-- Hil_Delivre v4 — Sprint 6 : Migration SQL
-- Notifications temps réel, Push FCM, SMS OTP
-- ============================================================================
-- Prérequis : schema.sql (Sprint 1), schema_sprint2-5.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUM : notification_type
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
        CREATE TYPE public.notification_type AS ENUM (
            'order_created',
            'order_accepted',
            'order_ready',
            'order_picked_up',
            'order_in_delivery',
            'order_delivered',
            'order_cancelled',
            'delivery_proposed',
            'delivery_accepted',
            'delivery_rejected',
            'payment_received',
            'payment_failed',
            'kyc_approved',
            'kyc_rejected',
            'system_alert',
            'promotion'
        );
    END IF;
END$$;

-- ============================================================================
-- 2. ENUM : notification_channel
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
        CREATE TYPE public.notification_channel AS ENUM (
            'push',
            'sms',
            'in_app',
            'socket'
        );
    END IF;
END$$;

-- ============================================================================
-- 3. ENUM : otp_purpose
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'otp_purpose') THEN
        CREATE TYPE public.otp_purpose AS ENUM (
            'phone_verification',
            'login_2fa',
            'password_reset',
            'delivery_confirmation'
        );
    END IF;
END$$;

-- ============================================================================
-- 4. TABLE : notifications
-- Description : Historique de toutes les notifications envoyées.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    channel notification_channel NOT NULL DEFAULT 'in_app',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}',
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    is_sent BOOLEAN NOT NULL DEFAULT false,
    sent_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    related_entity_type TEXT,
    related_entity_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
    ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON public.notifications(user_id, is_read)
    WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type
    ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
    ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_related_entity
    ON public.notifications(related_entity_type, related_entity_id);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- L'utilisateur ne voit que ses propres notifications
CREATE POLICY notifications_own ON public.notifications
    FOR ALL USING (user_id = auth.uid());

-- Admin voit tout
CREATE POLICY notifications_admin ON public.notifications
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 5. TABLE : notification_preferences
-- Description : Préférences de notification par utilisateur et type.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    notification_type notification_type NOT NULL,
    push_enabled BOOLEAN NOT NULL DEFAULT true,
    sms_enabled BOOLEAN NOT NULL DEFAULT true,
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_user_notification_pref UNIQUE (user_id, notification_type)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_notification_prefs_user_id
    ON public.notification_preferences(user_id);

-- RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_prefs_own ON public.notification_preferences
    FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- 6. TABLE : device_tokens
-- Description : Tokens FCM des appareils pour les notifications push.
-- Un utilisateur peut avoir plusieurs appareils.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT unique_device_token UNIQUE (token)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_id
    ON public.device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active
    ON public.device_tokens(user_id, is_active)
    WHERE is_active = true;

-- RLS
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY device_tokens_own ON public.device_tokens
    FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- 7. TABLE : otp_codes
-- Description : Codes OTP pour la vérification téléphone et 2FA.
-- Sécurité : hashés, limités en tentatives, avec expiration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    phone_number TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    purpose otp_purpose NOT NULL DEFAULT 'phone_verification',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    verified_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT max_attempts_check CHECK (attempts <= max_attempts + 1)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_otp_codes_phone
    ON public.otp_codes(phone_number, purpose)
    WHERE is_verified = false;
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires
    ON public.otp_codes(expires_at)
    WHERE is_verified = false;
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id
    ON public.otp_codes(user_id);

-- RLS
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Seul le service_role peut accéder aux OTP (pas d'accès direct utilisateur)
CREATE POLICY otp_codes_service_only ON public.otp_codes
    FOR ALL USING (false);

-- ============================================================================
-- 8. TABLE : socket_connections
-- Description : Suivi des connexions Socket.IO actives.
-- Utilisé pour le monitoring et le targeting des messages.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.socket_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    socket_id TEXT NOT NULL UNIQUE,
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_ping_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    rooms TEXT[] DEFAULT '{}'
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_socket_connections_user_id
    ON public.socket_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_socket_connections_socket_id
    ON public.socket_connections(socket_id);

-- RLS (admin only)
ALTER TABLE public.socket_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY socket_connections_admin ON public.socket_connections
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.profiles_data
            WHERE user_id = auth.uid() AND role = 'admin'
        )
    );

-- ============================================================================
-- 9. MODIFICATION TABLE profiles_data : Ajout colonnes notification
-- ============================================================================

DO $$
BEGIN
    -- Numéro de téléphone vérifié
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'phone_verified'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN phone_verified BOOLEAN DEFAULT false;
    END IF;

    -- Date de vérification du téléphone
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'phone_verified_at'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN phone_verified_at TIMESTAMP WITH TIME ZONE;
    END IF;

    -- Notifications push activées globalement
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles_data' AND column_name = 'push_notifications_enabled'
    ) THEN
        ALTER TABLE public.profiles_data ADD COLUMN push_notifications_enabled BOOLEAN DEFAULT true;
    END IF;
END$$;

-- ============================================================================
-- 10. FONCTION : Nettoyer les OTP expirés (à appeler via cron)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_otps()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.otp_codes
    WHERE expires_at < NOW() - INTERVAL '1 hour'
    AND is_verified = false;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 11. FONCTION : Nettoyer les connexions socket inactives
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_stale_sockets()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.socket_connections
    WHERE last_ping_at < NOW() - INTERVAL '5 minutes';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 12. GRANTS
-- ============================================================================

GRANT ALL ON public.notifications TO authenticated;
GRANT ALL ON public.notification_preferences TO authenticated;
GRANT ALL ON public.device_tokens TO authenticated;
GRANT ALL ON public.otp_codes TO service_role;
GRANT ALL ON public.socket_connections TO service_role;
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON public.notification_preferences TO service_role;
GRANT ALL ON public.device_tokens TO service_role;

COMMIT;

-- ============================================================================
-- FIN Migration Sprint 6
-- ============================================================================
