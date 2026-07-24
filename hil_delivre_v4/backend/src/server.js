/**
 * ============================================================
 * Hil_Delivre v4 — Point d'entrée du serveur
 * Sprint 1 : Infrastructure
 * ============================================================
 * Ce fichier démarre le serveur HTTP, gère le graceful shutdown
 * et capture les erreurs non gérées (unhandledRejection,
 * uncaughtException).
 * ============================================================
 */

const http = require('http');
const app = require('./app');
const config = require('./config');
const { createClient } = require('@supabase/supabase-js');

// ============================================================
// Initialisation du client Supabase
// ============================================================

const supabaseClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Test de connexion à la base de données au démarrage
async function testDatabaseConnection() {
  try {
    const { error } = await supabaseClient
      .from('platform_config')
      .select('config_key')
      .limit(1);

    if (error) {
      process.stderr.write(`[server] Avertissement : connexion Supabase échouée — ${error.message}\n`);
      process.stderr.write('[server] Vérifiez les variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.\n');
    } else {
      process.stdout.write('[server] Connexion à Supabase établie avec succès.\n');
    }
  } catch (err) {
    process.stderr.write(`[server] Erreur critique lors du test de connexion : ${err.message}\n`);
    if (config.env === 'production') {
      process.exit(1);
    }
  }
}

// ============================================================
// Démarrage du serveur
// ============================================================

const server = http.createServer(app);

async function startServer() {
  await testDatabaseConnection();

  server.listen(config.port, () => {
    process.stdout.write(`[server] Hil_Delivre v4 Backend démarré sur le port ${config.port}\n`);
    process.stdout.write(`[server] Environnement : ${config.env}\n`);
    process.stdout.write(`[server] Health check : http://localhost:${config.port}/health\n`);
  });
}

startServer().catch((err) => {
  process.stderr.write(`[server] Échec du démarrage : ${err.message}\n`);
  process.exit(1);
});

// ============================================================
// Graceful Shutdown
// ============================================================

function gracefulShutdown(signal) {
  process.stdout.write(`\n[server] Signal reçu : ${signal}. Arrêt gracieux en cours...\n`);

  server.close(() => {
    process.stdout.write('[server] Serveur HTTP fermé.\n');
    process.exit(0);
  });

  // Forcer la fermeture après 10 secondes si le shutdown gracieux échoue
  setTimeout(() => {
    process.stderr.write('[server] Arrêt forcé après timeout de 10 secondes.\n');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================
// Gestion des erreurs non capturées
// ============================================================

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[server] UNHANDLED REJECTION : ${reason?.message || reason}\n`);
  if (config.env === 'production') {
    // En production, on ne crash pas pour les rejections non capturées
    // mais on log pour diagnostique
  }
});

process.on('uncaughtException', (error) => {
  process.stderr.write(`[server] UNCAUGHT EXCEPTION : ${error.message}\n${error.stack || ''}\n`);
  if (config.env === 'production') {
    // En production, on arrête le processus pour éviter un état corrompu
    process.exit(1);
  }
});
