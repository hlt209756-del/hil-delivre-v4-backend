-- ============================================================================
-- Hil_Delivre v4 — Sprint 9 : Notation, Certification Hygiène, Fidélisation
-- Migration SQL complète
-- Prérequis : Sprints 1-8 exécutés (tables users, profiles_data, orders existent)
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TYPES ENUM
-- ============================================================================

DO $$ BEGIN
    CREATE TYPE certification_status_type AS ENUM ('pending', 'certified', 'expired', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE loyalty_transaction_type AS ENUM ('earned', 'redeemed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 2. TABLE : ratings
-- Système de notation bidirectionnel (client↔marchand, client↔livreur)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rater_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rated_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    comment TEXT,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    moderated_at TIMESTAMPTZ,
    moderated_by UUID REFERENCES users(id),
    moderation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Contraintes
    CONSTRAINT ratings_score_range CHECK (score >= 1 AND score <= 5),
    CONSTRAINT ratings_comment_length CHECK (comment IS NULL OR char_length(comment) <= 500),
    CONSTRAINT ratings_no_self_rating CHECK (rater_id != rated_user_id),
    CONSTRAINT ratings_unique_per_order UNIQUE (order_id, rater_id, rated_user_id)
);

COMMENT ON TABLE ratings IS 'Notations bidirectionnelles entre les acteurs d''une commande';
COMMENT ON COLUMN ratings.is_visible IS 'FALSE si modéré/supprimé par un admin';
COMMENT ON COLUMN ratings.moderated_by IS 'Admin ayant modéré la notation';

-- ============================================================================
-- 3. TABLE : loyalty_points
-- Programme de fidélisation clients avec expiration
-- ============================================================================

CREATE TABLE IF NOT EXISTS loyalty_points (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    transaction_type loyalty_transaction_type NOT NULL DEFAULT 'earned',
    points_earned INTEGER NOT NULL DEFAULT 0,
    points_spent INTEGER NOT NULL DEFAULT 0,
    points_balance INTEGER NOT NULL DEFAULT 0,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    is_expired BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Contraintes
    CONSTRAINT loyalty_points_earned_positive CHECK (points_earned >= 0),
    CONSTRAINT loyalty_points_spent_positive CHECK (points_spent >= 0),
    CONSTRAINT loyalty_points_balance_non_negative CHECK (points_balance >= 0)
);

COMMENT ON TABLE loyalty_points IS 'Transactions de points de fidélité (attribution, utilisation, expiration)';
COMMENT ON COLUMN loyalty_points.points_balance IS 'Solde restant sur cette ligne (earned - spent pour earned, 0 pour redeemed/expired)';

-- ============================================================================
-- 4. TABLE : certification_hygiene
-- Certification qualité/hygiène des marchands (5000 FCFA/an)
-- ============================================================================

CREATE TABLE IF NOT EXISTS certification_hygiene (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status certification_status_type NOT NULL DEFAULT 'pending',
    certification_date TIMESTAMPTZ,
    expiration_date TIMESTAMPTZ,
    fee_amount NUMERIC(10, 0) NOT NULL DEFAULT 5000,
    fee_paid BOOLEAN NOT NULL DEFAULT FALSE,
    payment_reference TEXT,
    admin_id UUID REFERENCES users(id),
    rejection_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Contraintes
    CONSTRAINT certification_fee_positive CHECK (fee_amount > 0),
    CONSTRAINT certification_dates_coherent CHECK (
        expiration_date IS NULL OR certification_date IS NULL OR expiration_date > certification_date
    )
);

COMMENT ON TABLE certification_hygiene IS 'Certifications hygiène "Hil_Delivre Qualité" des marchands';
COMMENT ON COLUMN certification_hygiene.fee_amount IS 'Montant des frais de certification en FCFA';

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

-- Ratings
CREATE INDEX IF NOT EXISTS idx_ratings_order_id ON ratings(order_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rater_id ON ratings(rater_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rated_user_id ON ratings(rated_user_id);
CREATE INDEX IF NOT EXISTS idx_ratings_rated_user_visible ON ratings(rated_user_id, is_visible) WHERE is_visible = TRUE;
CREATE INDEX IF NOT EXISTS idx_ratings_created_at ON ratings(created_at DESC);

-- Loyalty points
CREATE INDEX IF NOT EXISTS idx_loyalty_user_id ON loyalty_points(user_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_user_active ON loyalty_points(user_id, is_expired) WHERE is_expired = FALSE AND transaction_type = 'earned';
CREATE INDEX IF NOT EXISTS idx_loyalty_expires_at ON loyalty_points(expires_at) WHERE is_expired = FALSE AND expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_order_id ON loyalty_points(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_created_at ON loyalty_points(created_at DESC);

-- Certification
CREATE INDEX IF NOT EXISTS idx_certification_merchant_id ON certification_hygiene(merchant_id);
CREATE INDEX IF NOT EXISTS idx_certification_status ON certification_hygiene(status);
CREATE INDEX IF NOT EXISTS idx_certification_expiration ON certification_hygiene(expiration_date) WHERE status = 'certified';
CREATE INDEX IF NOT EXISTS idx_certification_created_at ON certification_hygiene(created_at DESC);

-- ============================================================================
-- 6. TRIGGERS : updated_at automatique
-- ============================================================================

-- Trigger function (réutilisable, peut déjà exister des sprints précédents)
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_certification_hygiene ON certification_hygiene;
CREATE TRIGGER set_updated_at_certification_hygiene
    BEFORE UPDATE ON certification_hygiene
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================================
-- 7. FONCTION : Recalcul de la note moyenne d'un utilisateur
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_avg_rating(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_avg NUMERIC(3, 2);
    v_count INTEGER;
BEGIN
    SELECT 
        COALESCE(AVG(score)::NUMERIC(3, 2), 0),
        COUNT(*)
    INTO v_avg, v_count
    FROM ratings
    WHERE rated_user_id = p_user_id
      AND is_visible = TRUE;

    UPDATE profiles_data
    SET avg_rating = v_avg,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Log si la note change significativement (alerte potentielle)
    IF v_count > 5 AND v_avg < 2.0 THEN
        RAISE NOTICE 'ALERTE: Utilisateur % a une note moyenne de % sur % avis', p_user_id, v_avg, v_count;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_user_avg_rating IS 'Recalcule et met à jour la note moyenne d''un utilisateur dans profiles_data';

-- ============================================================================
-- 8. TRIGGER : Mise à jour automatique avg_rating après INSERT/UPDATE/DELETE sur ratings
-- ============================================================================

CREATE OR REPLACE FUNCTION trigger_update_avg_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        PERFORM update_user_avg_rating(OLD.rated_user_id);
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM update_user_avg_rating(NEW.rated_user_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ratings_update_avg ON ratings;
CREATE TRIGGER trg_ratings_update_avg
    AFTER INSERT OR UPDATE OR DELETE ON ratings
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_avg_rating();

-- ============================================================================
-- 9. FONCTION : Expiration automatique des points de fidélité
-- ============================================================================

CREATE OR REPLACE FUNCTION expire_loyalty_points()
RETURNS INTEGER AS $$
DECLARE
    v_expired_count INTEGER;
BEGIN
    UPDATE loyalty_points
    SET is_expired = TRUE,
        points_balance = 0
    WHERE is_expired = FALSE
      AND transaction_type = 'earned'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
      AND points_balance > 0;

    GET DIAGNOSTICS v_expired_count = ROW_COUNT;
    RETURN v_expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION expire_loyalty_points IS 'Expire les points de fidélité périmés. Retourne le nombre de lignes affectées.';

-- ============================================================================
-- 10. FONCTION : Attribution de points de fidélité
-- ============================================================================

CREATE OR REPLACE FUNCTION award_loyalty_points(
    p_user_id UUID,
    p_order_id UUID,
    p_food_amount NUMERIC,
    p_points_per_100fcfa INTEGER DEFAULT 1,
    p_expiry_months INTEGER DEFAULT 6
)
RETURNS INTEGER AS $$
DECLARE
    v_points INTEGER;
    v_expires_at TIMESTAMPTZ;
BEGIN
    -- Calcul des points : 1 point par tranche de 100 FCFA
    v_points := FLOOR(p_food_amount / 100) * p_points_per_100fcfa;
    
    IF v_points <= 0 THEN
        RETURN 0;
    END IF;

    -- Date d'expiration
    v_expires_at := NOW() + (p_expiry_months || ' months')::INTERVAL;

    INSERT INTO loyalty_points (
        user_id, transaction_type, points_earned, points_balance,
        order_id, description, expires_at
    ) VALUES (
        p_user_id, 'earned', v_points, v_points,
        p_order_id,
        'Points gagnés - Commande ' || p_order_id::TEXT,
        v_expires_at
    );

    RETURN v_points;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION award_loyalty_points IS 'Attribue des points de fidélité pour une commande livrée';

-- ============================================================================
-- 11. FONCTION : Conversion de points en crédit plateforme
-- ============================================================================

CREATE OR REPLACE FUNCTION redeem_loyalty_points(
    p_user_id UUID,
    p_points_to_redeem INTEGER,
    p_conversion_rate NUMERIC DEFAULT 5.0  -- 100 points = 500 FCFA → 1 point = 5 FCFA
)
RETURNS NUMERIC AS $$
DECLARE
    v_available_points INTEGER;
    v_credit_amount NUMERIC;
    v_remaining INTEGER;
    v_record RECORD;
BEGIN
    -- Vérifier le solde disponible (points non expirés, non entièrement dépensés)
    SELECT COALESCE(SUM(points_balance), 0)
    INTO v_available_points
    FROM loyalty_points
    WHERE user_id = p_user_id
      AND is_expired = FALSE
      AND transaction_type = 'earned'
      AND points_balance > 0;

    IF v_available_points < p_points_to_redeem THEN
        RAISE EXCEPTION 'Solde insuffisant: % points disponibles, % demandés', v_available_points, p_points_to_redeem;
    END IF;

    IF p_points_to_redeem < 100 THEN
        RAISE EXCEPTION 'Minimum 100 points requis pour la conversion';
    END IF;

    -- Calculer le crédit
    v_credit_amount := p_points_to_redeem * p_conversion_rate;
    v_remaining := p_points_to_redeem;

    -- Débiter les points (FIFO : les plus anciens d'abord)
    FOR v_record IN
        SELECT id, points_balance
        FROM loyalty_points
        WHERE user_id = p_user_id
          AND is_expired = FALSE
          AND transaction_type = 'earned'
          AND points_balance > 0
        ORDER BY expires_at ASC NULLS LAST, created_at ASC
        FOR UPDATE
    LOOP
        IF v_remaining <= 0 THEN
            EXIT;
        END IF;

        IF v_record.points_balance <= v_remaining THEN
            UPDATE loyalty_points
            SET points_spent = points_spent + v_record.points_balance,
                points_balance = 0
            WHERE id = v_record.id;
            v_remaining := v_remaining - v_record.points_balance;
        ELSE
            UPDATE loyalty_points
            SET points_spent = points_spent + v_remaining,
                points_balance = points_balance - v_remaining
            WHERE id = v_record.id;
            v_remaining := 0;
        END IF;
    END LOOP;

    -- Enregistrer la transaction de conversion
    INSERT INTO loyalty_points (
        user_id, transaction_type, points_spent, points_balance,
        description
    ) VALUES (
        p_user_id, 'redeemed', p_points_to_redeem, 0,
        'Conversion de ' || p_points_to_redeem || ' points en ' || v_credit_amount || ' FCFA'
    );

    -- Créditer le wallet de l'utilisateur
    UPDATE profiles_data
    SET wallet_balance = COALESCE(wallet_balance, 0) + v_credit_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    RETURN v_credit_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION redeem_loyalty_points IS 'Convertit des points de fidélité en crédit plateforme (wallet_balance)';

-- ============================================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Activer RLS
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE certification_hygiene ENABLE ROW LEVEL SECURITY;

-- --- RATINGS ---

-- Lecture publique des notations visibles
DROP POLICY IF EXISTS ratings_select_public ON ratings;
CREATE POLICY ratings_select_public ON ratings
    FOR SELECT
    USING (is_visible = TRUE);

-- Insertion : utilisateur authentifié, seulement pour soi-même comme rater
DROP POLICY IF EXISTS ratings_insert_own ON ratings;
CREATE POLICY ratings_insert_own ON ratings
    FOR INSERT
    WITH CHECK (auth.uid() = rater_id);

-- Admin : accès complet (lecture des modérés incluse)
DROP POLICY IF EXISTS ratings_admin_all ON ratings;
CREATE POLICY ratings_admin_all ON ratings
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );

-- --- LOYALTY POINTS ---

-- Lecture : uniquement ses propres points
DROP POLICY IF EXISTS loyalty_select_own ON loyalty_points;
CREATE POLICY loyalty_select_own ON loyalty_points
    FOR SELECT
    USING (user_id = auth.uid());

-- Admin : accès complet
DROP POLICY IF EXISTS loyalty_admin_all ON loyalty_points;
CREATE POLICY loyalty_admin_all ON loyalty_points
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );

-- --- CERTIFICATION HYGIENE ---

-- Lecture : le marchand voit ses propres certifications
DROP POLICY IF EXISTS certification_select_own ON certification_hygiene;
CREATE POLICY certification_select_own ON certification_hygiene
    FOR SELECT
    USING (merchant_id = auth.uid());

-- Lecture publique : certifications actives (pour badge dans la liste marchands)
DROP POLICY IF EXISTS certification_select_public_active ON certification_hygiene;
CREATE POLICY certification_select_public_active ON certification_hygiene
    FOR SELECT
    USING (status = 'certified');

-- Insertion : marchands uniquement
DROP POLICY IF EXISTS certification_insert_merchant ON certification_hygiene;
CREATE POLICY certification_insert_merchant ON certification_hygiene
    FOR INSERT
    WITH CHECK (
        merchant_id = auth.uid()
        AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'merchant')
    );

-- Admin : accès complet
DROP POLICY IF EXISTS certification_admin_all ON certification_hygiene;
CREATE POLICY certification_admin_all ON certification_hygiene
    FOR ALL
    USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );

-- ============================================================================
-- 13. COLONNES ADDITIONNELLES (si pas déjà présentes)
-- ============================================================================

-- Ajouter is_certified à profiles_data pour affichage rapide du badge
DO $$ BEGIN
    ALTER TABLE profiles_data ADD COLUMN is_certified BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ajouter total_loyalty_points à profiles_data pour affichage rapide
DO $$ BEGIN
    ALTER TABLE profiles_data ADD COLUMN total_loyalty_points INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Ajouter ratings_count à profiles_data
DO $$ BEGIN
    ALTER TABLE profiles_data ADD COLUMN ratings_count INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================================
-- 14. FONCTION : Mise à jour ratings_count
-- ============================================================================

CREATE OR REPLACE FUNCTION update_user_ratings_count(p_user_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE profiles_data
    SET ratings_count = (
        SELECT COUNT(*) FROM ratings
        WHERE rated_user_id = p_user_id AND is_visible = TRUE
    ),
    updated_at = NOW()
    WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Intégrer dans le trigger existant
CREATE OR REPLACE FUNCTION trigger_update_avg_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        PERFORM update_user_avg_rating(OLD.rated_user_id);
        PERFORM update_user_ratings_count(OLD.rated_user_id);
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM update_user_avg_rating(NEW.rated_user_id);
        PERFORM update_user_ratings_count(NEW.rated_user_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 15. SEED DATA : Configuration plateforme
-- ============================================================================

INSERT INTO platform_config (config_key, config_value, description)
VALUES
    ('loyalty_points_per_100fcfa', 1, 'Points de fidélité attribués par tranche de 100 FCFA commandés'),
    ('loyalty_expiry_months', 6, 'Durée de validité des points en mois'),
    ('loyalty_conversion_rate', 5, 'Valeur en FCFA d''un point lors de la conversion (1 point = 5 FCFA)'),
    ('loyalty_min_redeem', 100, 'Nombre minimum de points pour une conversion'),
    ('certification_fee', 5000, 'Frais de certification hygiène en FCFA par an'),
    ('rating_window_hours', 72, 'Fenêtre de notation après livraison en heures')
ON CONFLICT (config_key) DO UPDATE
SET config_value = EXCLUDED.config_value,
    description = EXCLUDED.description,
    updated_at = NOW();

-- ============================================================================
-- 16. VUES UTILITAIRES
-- ============================================================================

-- Vue : solde de points disponibles par utilisateur
CREATE OR REPLACE VIEW v_loyalty_balance AS
SELECT
    user_id,
    SUM(points_balance) AS available_points,
    COUNT(*) FILTER (WHERE transaction_type = 'earned' AND is_expired = FALSE AND points_balance > 0) AS active_entries,
    MIN(expires_at) FILTER (WHERE transaction_type = 'earned' AND is_expired = FALSE AND points_balance > 0) AS next_expiration
FROM loyalty_points
WHERE transaction_type = 'earned'
  AND is_expired = FALSE
  AND points_balance > 0
GROUP BY user_id;

-- Vue : certifications actives (pour jointure rapide avec marchands)
CREATE OR REPLACE VIEW v_certified_merchants AS
SELECT
    merchant_id,
    certification_date,
    expiration_date
FROM certification_hygiene
WHERE status = 'certified'
  AND expiration_date > NOW();

COMMIT;
