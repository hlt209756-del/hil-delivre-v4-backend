-- database/schema_sprint8.sql - Migration SQL complète pour le Sprint 8
-- Système d'abonnements marchands et livreurs avec paiement récurrent via PayDunya.

-- Extension pour les fonctions UUID (nécessaire pour Supabase Auth)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table: public.subscription_plans
-- Définit les différents plans d'abonnement disponibles.
CREATE TABLE public.subscription_plans (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_type text UNIQUE NOT NULL CHECK (plan_type IN (
        'merchant_monthly',
        'delivery_monthly'
    )),
    name text NOT NULL,
    amount numeric NOT NULL CHECK (amount >= 0), -- Montant mensuel en F CFA
    duration_days integer NOT NULL CHECK (duration_days > 0), -- Durée de l'abonnement en jours (ex: 30)
    trial_duration_days integer DEFAULT 0 NOT NULL CHECK (trial_duration_days >= 0), -- Durée de la période d'essai en jours
    description text,
    is_active boolean DEFAULT TRUE NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Trigger pour mettre à jour `updated_at` automatiquement
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

-- RLS pour la table public.subscription_plans
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view subscription plans." ON public.subscription_plans FOR SELECT USING (TRUE);
CREATE POLICY "Admins can manage subscription plans." ON public.subscription_plans FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

-- Table: public.subscriptions
-- Enregistre les abonnements actifs et passés des utilisateurs.
CREATE TABLE public.subscriptions (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT, -- Lien vers le plan d'abonnement
    plan_type text NOT NULL CHECK (plan_type IN (
        'merchant_monthly',
        'delivery_monthly'
    )),
    amount numeric NOT NULL CHECK (amount >= 0), -- Montant payé pour cet abonnement
    status text NOT NULL CHECK (status IN (
        'active',
        'expired',
        'pending_renewal',
        'cancelled'
    )),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    renewed_at timestamp with time zone, -- Date du dernier renouvellement
    payment_transaction_id text, -- ID de transaction PayDunya pour le paiement de l'abonnement
    is_trial boolean DEFAULT FALSE NOT NULL, -- Indique si c'est une période d'essai
    trial_ends_at timestamp with time zone, -- Date de fin de la période d'essai
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION moddatetime('updated_at');

-- RLS pour la table public.subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own subscriptions." ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all subscriptions." ON public.subscriptions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

-- Modification de la table public.profiles_data
-- Ajout de la colonne `subscription_status` et mise à jour de `subscription_expires_at`
ALTER TABLE public.profiles_data
ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'inactive' NOT NULL CHECK (subscription_status IN (
    'active',
    'trial',
    'expired',
    'inactive'
));

-- Fonction PL/pgSQL pour mettre à jour profiles_data après un changement d'abonnement
CREATE OR REPLACE FUNCTION update_profile_subscription_status() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE public.profiles_data
        SET
            subscription_expires_at = NEW.expires_at,
            subscription_status = CASE
                WHEN NEW.is_trial THEN 'trial'
                WHEN NEW.status = 'active' AND NEW.expires_at > now() THEN 'active'
                ELSE 'expired'
            END,
            updated_at = now()
        WHERE user_id = NEW.user_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.profiles_data
        SET
            subscription_expires_at = NULL,
            subscription_status = 'inactive',
            updated_at = now()
        WHERE user_id = OLD.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger sur la table subscriptions pour appeler la fonction ci-dessus
CREATE TRIGGER update_profile_subscription_status_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION update_profile_subscription_status();

-- Index pour améliorer les performances des requêtes
CREATE INDEX idx_subscriptions_user_id ON public.subscriptions (user_id);
CREATE INDEX idx_subscriptions_expires_at ON public.subscriptions (expires_at);
CREATE INDEX idx_subscription_plans_plan_type ON public.subscription_plans (plan_type);

-- Seeds pour les plans d'abonnement
INSERT INTO public.subscription_plans (plan_type, name, amount, duration_days, trial_duration_days, description)
VALUES
('merchant_monthly', 'Abonnement Marchand Mensuel', 6000, 30, 30, 'Abonnement mensuel pour les marchands, inclut 30 jours d''essai gratuit.'),
('delivery_monthly', 'Abonnement Livreur Mensuel', 3000, 30, 30, 'Abonnement mensuel pour les livreurs, inclut 30 jours d''essai gratuit.')
ON CONFLICT (plan_type) DO UPDATE SET
    name = EXCLUDED.name,
    amount = EXCLUDED.amount,
    duration_days = EXCLUDED.duration_days,
    trial_duration_days = EXCLUDED.trial_duration_days,
    description = EXCLUDED.description,
    is_active = EXCLUDED.is_active,
    updated_at = now();

-- Fonction PL/pgSQL pour vérifier les abonnements expirés (utilisée par le cron job)
-- Cette fonction met à jour le statut des abonnements et des profils associés.
CREATE OR REPLACE FUNCTION check_expired_subscriptions() RETURNS void AS $$
BEGIN
    -- Mettre à jour les abonnements expirés dans la table subscriptions
    UPDATE public.subscriptions
    SET status = 'expired',
        updated_at = now()
    WHERE expires_at < now() AND status = 'active';

    -- Mettre à jour les profils dont l'abonnement est expiré
    UPDATE public.profiles_data pd
    SET subscription_status = 'expired',
        updated_at = now()
    FROM public.subscriptions s
    WHERE pd.user_id = s.user_id
      AND s.expires_at < now()
      AND pd.subscription_status IN ('active', 'trial');

    -- Mettre à jour les profils dont la période d'essai est terminée
    UPDATE public.profiles_data pd
    SET subscription_status = 'expired',
        updated_at = now()
    FROM public.subscriptions s
    WHERE pd.user_id = s.user_id
      AND s.is_trial = TRUE
      AND s.trial_ends_at < now()
      AND pd.subscription_status = 'trial';
END;
$$ LANGUAGE plpgsql;
