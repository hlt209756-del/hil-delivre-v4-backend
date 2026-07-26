-- Migration SQL pour le Sprint 10 de Hil_Delivre v4

-- Table: export_jobs
CREATE TABLE export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES users(id) NOT NULL, -- ID de l'administrateur ayant initié l'export
    export_type TEXT NOT NULL, -- Type d'export (e.g., 'orders', 'users', 'reconciliations')
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')), -- Statut actuel du job d'export
    filters JSONB, -- Filtres appliqués à l'export (e.g., dates, statuts)
    file_url TEXT, -- URL du fichier exporté dans Supabase Storage
    file_size_bytes BIGINT, -- Taille du fichier exporté en octets
    total_rows INTEGER, -- Nombre total de lignes exportées
    error_message TEXT, -- Message d'erreur en cas d'échec
    started_at TIMESTAMPTZ, -- Horodatage du début du traitement
    completed_at TIMESTAMPTZ, -- Horodatage de la fin du traitement
    expires_at TIMESTAMPTZ, -- Horodatage d'expiration du fichier exporté
    created_at TIMESTAMPTZ DEFAULT NOW() -- Horodatage de création du job
);
COMMENT ON TABLE export_jobs IS 'Enregistre les jobs d\'export de données asynchrones initiés par les administrateurs.';
COMMENT ON COLUMN export_jobs.id IS 'Identifiant unique du job d\'export.';
COMMENT ON COLUMN export_jobs.admin_id IS 'Identifiant de l\'administrateur qui a demandé l\'export.';
COMMENT ON COLUMN export_jobs.export_type IS 'Type de données exportées (ex: orders, users).';
COMMENT ON COLUMN export_jobs.status IS 'Statut actuel du job d\'export (pending, processing, completed, failed).';
COMMENT ON COLUMN export_jobs.filters IS 'Filtres appliqués lors de l\'export, au format JSONB.';
COMMENT ON COLUMN export_jobs.file_url IS 'URL du fichier exporté, stocké sur Supabase Storage.';
COMMENT ON COLUMN export_jobs.file_size_bytes IS 'Taille du fichier exporté en octets.';
COMMENT ON COLUMN export_jobs.total_rows IS 'Nombre total de lignes incluses dans l\'export.';
COMMENT ON COLUMN export_jobs.error_message IS 'Détails de l\'erreur si le job a échoué.';
COMMENT ON COLUMN export_jobs.started_at IS 'Horodatage du début du traitement de l\'export.';
COMMENT ON COLUMN export_jobs.completed_at IS 'Horodatage de la fin du traitement de l\'export.';
COMMENT ON COLUMN export_jobs.expires_at IS 'Horodatage auquel le fichier exporté doit être supprimé.';
COMMENT ON COLUMN export_jobs.created_at IS 'Horodatage de la création du job d\'export.';

-- Table: health_checks
CREATE TABLE health_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_name TEXT NOT NULL, -- Nom du service vérifié (e.g., 'PostgreSQL', 'Redis', 'OSRM')
    status TEXT NOT NULL CHECK(status IN ('healthy','degraded','unhealthy')), -- Statut du service
    response_time_ms INTEGER, -- Temps de réponse en millisecondes
    details JSONB, -- Détails supplémentaires sur le check (e.g., messages d'erreur, métriques spécifiques)
    checked_at TIMESTAMPTZ DEFAULT NOW() -- Horodatage de la vérification
);
COMMENT ON TABLE health_checks IS 'Enregistre l\'historique des vérifications de santé des services de l\'application.';
COMMENT ON COLUMN health_checks.id IS 'Identifiant unique de l\'enregistrement du health check.';
COMMENT ON COLUMN health_checks.service_name IS 'Nom du service qui a été vérifié.';
COMMENT ON COLUMN health_checks.status IS 'Statut de santé du service (healthy, degraded, unhealthy).';
COMMENT ON COLUMN health_checks.response_time_ms IS 'Temps de réponse du service en millisecondes.';
COMMENT ON COLUMN health_checks.details IS 'Détails supplémentaires sur le résultat du health check, au format JSONB.';
COMMENT ON COLUMN health_checks.checked_at IS 'Horodatage de la vérification de santé.';

-- Table: cache_invalidation_log
CREATE TABLE cache_invalidation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cache_key TEXT NOT NULL, -- Clé ou motif de clé du cache invalidé
    reason TEXT, -- Raison de l'invalidation
    invalidated_by UUID REFERENCES users(id) NULLABLE, -- ID de l'utilisateur ayant initié l'invalidation (si applicable)
    created_at TIMESTAMPTZ DEFAULT NOW() -- Horodatage de l'invalidation
);
COMMENT ON TABLE cache_invalidation_log IS 'Enregistre les événements d\'invalidation du cache Redis.';
COMMENT ON COLUMN cache_invalidation_log.id IS 'Identifiant unique de l\'enregistrement d\'invalidation.';
COMMENT ON COLUMN cache_invalidation_log.cache_key IS 'Clé ou motif de clé du cache qui a été invalidé.';
COMMENT ON COLUMN cache_invalidation_log.reason IS 'Raison pour laquelle le cache a été invalidé.';
COMMENT ON COLUMN cache_invalidation_log.invalidated_by IS 'Identifiant de l\'utilisateur ou du système qui a déclenché l\'invalidation.';
COMMENT ON COLUMN cache_invalidation_log.created_at IS 'Horodatage de l\'événement d\'invalidation.';

-- Performance indexes
CREATE INDEX idx_orders_created_status ON orders (created_at, status);
CREATE INDEX idx_orders_merchant_created ON orders (merchant_id, created_at);
CREATE INDEX idx_orders_delivery_status ON orders (delivery_id, status);
CREATE INDEX idx_deliverer_locations_online_updated ON deliverer_locations (is_online, updated_at);
CREATE INDEX idx_notifications_user_read_created ON notifications (user_id, is_read, created_at);
CREATE INDEX idx_platform_daily_stats_date ON platform_daily_stats (date);
CREATE INDEX idx_reconciliation_records_deliverer_status ON reconciliation_records (deliverer_id, status);
CREATE INDEX idx_merchant_payouts_merchant_status ON merchant_payouts (merchant_id, status);

-- Function: cleanup_expired_exports()
CREATE OR REPLACE FUNCTION cleanup_expired_exports()
RETURNS VOID AS $$
BEGIN
    DELETE FROM export_jobs
    WHERE expires_at < NOW();
END;
$$
LANGUAGE plpgsql;
COMMENT ON FUNCTION cleanup_expired_exports() IS 'Supprime les enregistrements de jobs d\'export dont la date d\'expiration est passée.';

-- Function: aggregate_hourly_metrics(p_hour TIMESTAMPTZ)
CREATE OR REPLACE FUNCTION aggregate_hourly_metrics(p_hour TIMESTAMPTZ)
RETURNS VOID AS $$
BEGIN
    -- Exemple d'agrégation, à adapter selon les métriques réelles à agréger
    -- Cette fonction serait appelée par un cron job pour agréger les données horaires
    -- et pourrait insérer/mettre à jour une table de métriques agrégées.
    RAISE NOTICE 'Agrégation des métriques pour l\'heure: %', p_hour;
    -- INSERT INTO hourly_metrics (hour, total_orders, total_revenue) -- Exemple
    -- SELECT date_trunc('hour', created_at), COUNT(id), SUM(total_amount)
    -- FROM orders
    -- WHERE created_at >= p_hour AND created_at < p_hour + INTERVAL '1 hour'
    -- GROUP BY 1;
END;
$$
LANGUAGE plpgsql;
COMMENT ON FUNCTION aggregate_hourly_metrics(p_hour TIMESTAMPTZ) IS 'Agrège les métriques de l\'application pour une heure donnée. À implémenter avec les logiques d\'agrégation spécifiques.';

-- RLS policies for new tables
-- export_jobs: Admin only
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_access_export_jobs ON export_jobs;
CREATE POLICY admin_all_access_export_jobs ON export_jobs
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles_data WHERE user_id = admin_id AND role = 'admin'));

-- health_checks: Admin only
ALTER TABLE health_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_access_health_checks ON health_checks;
CREATE POLICY admin_all_access_health_checks ON health_checks
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles_data WHERE user_id = auth.uid() AND role = 'admin'));

-- cache_invalidation_log: Admin only (read/write), users can read their own invalidations if needed (not specified, so admin only for now)
ALTER TABLE cache_invalidation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all_access_cache_invalidation_log ON cache_invalidation_log;
CREATE POLICY admin_all_access_cache_invalidation_log ON cache_invalidation_log
    FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles_data WHERE user_id = auth.uid() AND role = 'admin'));
