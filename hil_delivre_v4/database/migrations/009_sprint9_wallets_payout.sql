-- /home/ubuntu/sprint9/database/009_sprint9_wallets_payout.sql
-- Migration SQL pour le Sprint 9 : Portefeuille Virtuel (E-Wallet) et Mass Payout PayDunya

-- Création des types ENUM
CREATE TYPE wallet_transaction_type AS ENUM (
    'credit_commission',
    'credit_delivery_fee',
    'credit_food_sale',
    'credit_subscription',
    'debit_payout',
    'debit_adjustment'
);

CREATE TYPE payout_batch_status AS ENUM (
    'pending',
    'processing',
    'completed',
    'partial_failure',
    'failed'
);

CREATE TYPE payout_item_status AS ENUM (
    'pending',
    'processing',
    'success',
    'failed'
);

-- 1. Table `wallets`
CREATE TABLE public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    balance NUMERIC DEFAULT 0 CHECK (balance >= 0),
    total_earned NUMERIC DEFAULT 0 CHECK (total_earned >= 0),
    total_withdrawn NUMERIC DEFAULT 0 CHECK (total_withdrawn >= 0),
    last_payout_at TIMESTAMPTZ,
    currency TEXT DEFAULT 'XOF',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.wallets IS 'Portefeuilles virtuels des utilisateurs (marchands, livreurs, admin).';
COMMENT ON COLUMN public.wallets.user_id IS 'ID de l''utilisateur associé au portefeuille.';
COMMENT ON COLUMN public.wallets.balance IS 'Solde actuel du portefeuille.';
COMMENT ON COLUMN public.wallets.total_earned IS 'Montant total gagné par l''utilisateur.';
COMMENT ON COLUMN public.wallets.total_withdrawn IS 'Montant total retiré par l''utilisateur.';
COMMENT ON COLUMN public.wallets.last_payout_at IS 'Date du dernier virement PayDunya.';

-- 3. Table `wallet_transactions`
CREATE TABLE public.wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    type wallet_transaction_type NOT NULL,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    balance_before NUMERIC NOT NULL,
    balance_after NUMERIC NOT NULL,
    reference_id UUID, -- ID de la commande, de l'abonnement, ou du payout_item
    reference_type TEXT, -- 'order', 'subscription', 'payout'
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.wallet_transactions IS 'Historique des transactions pour chaque portefeuille.';
COMMENT ON COLUMN public.wallet_transactions.wallet_id IS 'ID du portefeuille concerné par la transaction.';
COMMENT ON COLUMN public.wallet_transactions.type IS 'Type de transaction (crédit, débit).';
COMMENT ON COLUMN public.wallet_transactions.amount IS 'Montant de la transaction.';
COMMENT ON COLUMN public.wallet_transactions.balance_before IS 'Solde du portefeuille avant la transaction.';
COMMENT ON COLUMN public.wallet_transactions.balance_after IS 'Solde du portefeuille après la transaction.';
COMMENT ON COLUMN public.wallet_transactions.reference_id IS 'Référence à l''entité source de la transaction (ex: ID de commande).';
COMMENT ON COLUMN public.wallet_transactions.reference_type IS 'Type de l''entité source (ex: ''order'', ''subscription'').';

-- 5. Table `payout_batches`
CREATE TABLE public.payout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number TEXT UNIQUE NOT NULL,
    status payout_batch_status DEFAULT 'pending',
    total_amount NUMERIC DEFAULT 0 CHECK (total_amount >= 0),
    total_transactions INTEGER DEFAULT 0 CHECK (total_transactions >= 0),
    success_count INTEGER DEFAULT 0 CHECK (success_count >= 0),
    failure_count INTEGER DEFAULT 0 CHECK (failure_count >= 0),
    initiated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    initiated_by TEXT DEFAULT 'cron_system',
    metadata JSONB DEFAULT '{}',
    error_message TEXT -- Pour les erreurs au niveau du batch entier
);
COMMENT ON TABLE public.payout_batches IS 'Enregistre les lots de virements de masse PayDunya.';
COMMENT ON COLUMN public.payout_batches.batch_number IS 'Numéro unique du lot de virement.';
COMMENT ON COLUMN public.payout_batches.status IS 'Statut global du lot de virement.';
COMMENT ON COLUMN public.payout_batches.total_amount IS 'Montant total de tous les virements dans ce lot.';
COMMENT ON COLUMN public.payout_batches.total_transactions IS 'Nombre total de virements dans ce lot.';

-- 7. Table `payout_items`
CREATE TABLE public.payout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.payout_batches(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    amount NUMERIC NOT NULL CHECK (amount > 0),
    mobile_money_number TEXT NOT NULL,
    mobile_money_provider TEXT NOT NULL,
    status payout_item_status DEFAULT 'pending',
    provider_ref TEXT, -- Référence de transaction PayDunya
    error_message TEXT,
    attempts INTEGER DEFAULT 0 CHECK (attempts >= 0),
    last_attempt_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.payout_items IS 'Détails de chaque virement individuel au sein d''un lot.';
COMMENT ON COLUMN public.payout_items.batch_id IS 'ID du lot de virement auquel cet élément appartient.';
COMMENT ON COLUMN public.payout_items.wallet_id IS 'ID du portefeuille duquel les fonds sont débités.';
COMMENT ON COLUMN public.payout_items.user_id IS 'ID de l''utilisateur recevant le virement.';
COMMENT ON COLUMN public.payout_items.idempotency_key IS 'Clé d''idempotence unique pour PayDunya.';
COMMENT ON COLUMN public.payout_items.amount IS 'Montant du virement.';
COMMENT ON COLUMN public.payout_items.mobile_money_number IS 'Numéro Mobile Money du destinataire.';
COMMENT ON COLUMN public.payout_items.mobile_money_provider IS 'Fournisseur Mobile Money (Orange Money, Wave, Moov).';
COMMENT ON COLUMN public.payout_items.status IS 'Statut du virement individuel.';

-- 8. Index sur les tables
CREATE INDEX idx_wallet_transactions_wallet_created_at ON public.wallet_transactions (wallet_id, created_at DESC);
CREATE INDEX idx_payout_items_batch_status ON public.payout_items (batch_id, status);
CREATE UNIQUE INDEX idx_payout_items_idempotency_key ON public.payout_items (idempotency_key);
CREATE INDEX idx_payout_items_user_status ON public.payout_items (user_id, status);
CREATE UNIQUE INDEX idx_wallets_user_id ON public.wallets (user_id);

-- 9. RLS policies
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Wallets are viewable by their owners" ON public.wallets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all wallets" ON public.wallets
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Wallet transactions are viewable by wallet owners" ON public.wallet_transactions
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.wallets WHERE id = wallet_id AND user_id = auth.uid()));
CREATE POLICY "Admins can manage all wallet transactions" ON public.wallet_transactions
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

ALTER TABLE public.payout_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Payout batches are only accessible by admins" ON public.payout_batches
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

ALTER TABLE public.payout_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Payout items are viewable by their owners" ON public.payout_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all payout items" ON public.payout_items
  FOR ALL USING (EXISTS (SELECT 1 FROM public.profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

-- 10. Trigger auto_create_wallet
-- Crée un portefeuille pour chaque nouvel utilisateur inséré dans profiles_data
CREATE OR REPLACE FUNCTION public.handle_new_user_wallet() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.wallets (user_id)
  VALUES (NEW.user_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_create_wallet
AFTER INSERT ON public.profiles_data
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_wallet();
COMMENT ON TRIGGER auto_create_wallet ON public.profiles_data IS 'Crée automatiquement un portefeuille pour chaque nouvel utilisateur.';

-- 14. Trigger updated_at sur wallets
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_wallets_updated_at
BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();
COMMENT ON TRIGGER set_wallets_updated_at ON public.wallets IS 'Met à jour la colonne updated_at avant chaque modification du portefeuille.';

-- 11. Fonction PL/pgSQL `credit_wallet`
CREATE OR REPLACE FUNCTION public.credit_wallet(
    p_user_id UUID,
    p_amount NUMERIC,
    p_type wallet_transaction_type,
    p_reference_id UUID DEFAULT NULL,
    p_reference_type TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_wallet_id UUID;
    v_balance_before NUMERIC;
    v_balance_after NUMERIC;
    v_transaction_id UUID;
BEGIN
    -- Récupérer le wallet de l'utilisateur
    SELECT id, balance INTO v_wallet_id, v_balance_before
    FROM public.wallets
    WHERE user_id = p_user_id;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Portefeuille introuvable pour l''utilisateur %', p_user_id;
    END IF;

    -- Calculer le nouveau solde
    v_balance_after := v_balance_before + p_amount;

    -- Mettre à jour le solde du portefeuille et total_earned
    UPDATE public.wallets
    SET
        balance = v_balance_after,
        total_earned = total_earned + p_amount,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- Enregistrer la transaction
    INSERT INTO public.wallet_transactions (
        wallet_id, type, amount, balance_before, balance_after, reference_id, reference_type, description
    )
    VALUES (
        v_wallet_id, p_type, p_amount, v_balance_before, v_balance_after, p_reference_id, p_reference_type, p_description
    )
    RETURNING id INTO v_transaction_id;

    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMENT ON FUNCTION public.credit_wallet IS 'Crédite le portefeuille d''un utilisateur et enregistre la transaction.';

-- 12. Fonction PL/pgSQL `debit_wallet_for_payout`
CREATE OR REPLACE FUNCTION public.debit_wallet_for_payout(
    p_user_id UUID,
    p_amount NUMERIC,
    p_payout_item_id UUID
) RETURNS UUID AS $$
DECLARE
    v_wallet_id UUID;
    v_balance_before NUMERIC;
    v_balance_after NUMERIC;
    v_transaction_id UUID;
BEGIN
    -- Récupérer le wallet de l'utilisateur
    SELECT id, balance INTO v_wallet_id, v_balance_before
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE; -- Verrouiller la ligne pour éviter les problèmes de concurrence

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Portefeuille introuvable pour l''utilisateur %', p_user_id;
    END IF;

    -- Vérifier que le solde est suffisant
    IF v_balance_before < p_amount THEN
        RAISE EXCEPTION 'Solde insuffisant pour le virement. Solde actuel: %, Montant demandé: %', v_balance_before, p_amount;
    END IF;

    -- Calculer le nouveau solde
    v_balance_after := v_balance_before - p_amount;

    -- Mettre à jour le solde du portefeuille et total_withdrawn
    UPDATE public.wallets
    SET
        balance = v_balance_after,
        total_withdrawn = total_withdrawn + p_amount,
        last_payout_at = NOW(),
        updated_at = NOW()
    WHERE id = v_wallet_id;

    -- Enregistrer la transaction de débit
    INSERT INTO public.wallet_transactions (
        wallet_id, type, amount, balance_before, balance_after, reference_id, reference_type, description
    )
    VALUES (
        v_wallet_id, 'debit_payout', p_amount, v_balance_before, v_balance_after, p_payout_item_id, 'payout', 'Débit pour virement PayDunya'
    )
    RETURNING id INTO v_transaction_id;

    RETURN v_transaction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMENT ON FUNCTION public.debit_wallet_for_payout IS 'Débite le portefeuille d''un utilisateur pour un virement PayDunya et enregistre la transaction.';

-- 13. Fonction `release_frozen_payout`
CREATE OR REPLACE FUNCTION public.release_frozen_payout(
    p_payout_item_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_payout_item public.payout_items;
    v_wallet_id UUID;
    v_user_id UUID;
    v_amount NUMERIC;
    v_transaction_id UUID;
BEGIN
    -- Récupérer les détails du payout_item
    SELECT * INTO v_payout_item
    FROM public.payout_items
    WHERE id = p_payout_item_id;

    IF v_payout_item IS NULL THEN
        RAISE EXCEPTION 'Payout item % introuvable.', p_payout_item_id;
    END IF;

    -- Vérifier si le statut est 'failed' et si les fonds ont déjà été débités
    IF v_payout_item.status = 'failed' AND v_payout_item.error_message LIKE '%fonds gelés%' THEN
        -- Les fonds ont été débités mais le virement a échoué définitivement, il faut les recréditer
        v_wallet_id := v_payout_item.wallet_id;
        v_user_id := v_payout_item.user_id;
        v_amount := v_payout_item.amount;

        -- Recréditer le portefeuille
        PERFORM public.credit_wallet(
            v_user_id,
            v_amount,
            'debit_adjustment', -- Utiliser un type de transaction approprié pour le recrédit
            p_payout_item_id,
            'payout',
            'Recrédit suite à l''échec définitif d''un virement PayDunya'
        );

        -- Mettre à jour le statut du payout_item pour indiquer qu'il a été traité
        UPDATE public.payout_items
        SET status = 'failed', error_message = 'Virement échoué et fonds recrédités.', completed_at = NOW()
        WHERE id = p_payout_item_id;

        RETURN TRUE;
    ELSIF v_payout_item.status = 'processing' THEN
        -- Les fonds sont gelés, mais le statut n'est pas encore 'failed' définitif.
        -- Cette fonction est censée être appelée APRÈS une vérification externe qui confirme l'échec.
        RAISE EXCEPTION 'Le virement % est toujours en traitement ou n''a pas de statut d''échec définitif.', p_payout_item_id;
    END IF;

    RETURN FALSE; -- Aucun recrédit nécessaire ou effectué
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
COMMENT ON FUNCTION public.release_frozen_payout IS 'Recrédite le portefeuille si un virement PayDunya en statut PROCESSING échoue définitivement après vérification externe.';

-- Mise à jour de la table profiles_data pour ajouter le numéro mobile money
ALTER TABLE public.profiles_data
ADD COLUMN mobile_money_number TEXT,
ADD COLUMN mobile_money_provider TEXT;
COMMENT ON COLUMN public.profiles_data.mobile_money_number IS 'Numéro Mobile Money de l''utilisateur pour les virements.';
COMMENT ON COLUMN public.profiles_data.mobile_money_provider IS 'Fournisseur Mobile Money de l''utilisateur (Orange Money, Wave, Moov).';

-- Optionnel: Créer un index sur profiles_data(mobile_money_number) si les recherches par ce champ sont fréquentes
-- CREATE INDEX idx_profiles_data_mobile_money_number ON public.profiles_data (mobile_money_number);

-- Ajout de RLS pour les nouvelles colonnes de profiles_data
-- Assurez-vous que les politiques RLS existantes pour profiles_data sont compatibles ou mettez-les à jour.
-- Exemple (à adapter à vos politiques existantes):
-- CREATE POLICY "Users can update their own mobile money info" ON public.profiles_data
--   FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Fin de la migration SQL pour le Sprint 9