'use strict';

/**
 * @fileoverview Point d'entrée du serveur Hil_Delivre v4.
 * Charge les variables d'environnement, démarre le serveur Express
 * et gère le graceful shutdown.
 *
 * @module server
 */

// Charger les variables d'environnement AVANT tout import
require('dotenv').config();

const app = require('./app');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ============================================================
// DÉMARRAGE DU SERVEUR
// ============================================================

const server = app.listen(PORT, HOST, () => {
  console.info(`
╔══════════════════════════════════════════════════════╗
║  Hil_Delivre v4 — Backend API                       ║
║  Environnement : ${(process.env.NODE_ENV || 'development').padEnd(33)}║
║  Serveur démarré sur : http://${HOST}:${String(PORT).padEnd(19)}║
╚══════════════════════════════════════════════════════╝
  `);
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

/**
 * Arrêt propre du serveur.
 * Ferme les connexions existantes avant de quitter le processus.
 *
 * @param {string} signal - Signal reçu (SIGTERM, SIGINT)
 */
function gracefulShutdown(signal) {
  console.info(`\n[SERVER] Signal ${signal} reçu. Arrêt gracieux en cours...`);

  server.close((err) => {
    if (err) {
      console.error('[SERVER] Erreur lors de la fermeture:', err.message);
      process.exit(1);
    }

    console.info('[SERVER] Serveur arrêté proprement.');
    process.exit(0);
  });

  // Forcer l'arrêt après 10 secondes si les connexions ne se ferment pas
  setTimeout(() => {
    console.error('[SERVER] Timeout de fermeture atteint (10s). Arrêt forcé.');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection:', reason);
  // Ne pas arrêter le serveur — logger et continuer
});

process.on('uncaughtException', (error) => {
  console.error('[SERVER] Uncaught Exception:', error.message);
  console.error(error.stack);
  // Arrêter le serveur — état potentiellement corrompu
  gracefulShutdown('uncaughtException');
});

module.exports = server;
