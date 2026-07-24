/**
 * ============================================================
 * Hil_Delivre v4 — Configuration centralisée
 * Sprint 1 : Infrastructure
 * ============================================================
 * Ce module lit et valide les variables d'environnement au
 * démarrage de l'application. Si une variable obligatoire est
 * manquante, le processus se termine immédiatement avec un code
 * d'erreur non nul.
 * ============================================================
 */

const dotenv = require('dotenv');

// Charger les variables d'environnement depuis .env (non bloquant si absent)
const dotenvResult = dotenv.config();
if (dotenvResult.error) {
  // En développement, c'est acceptable si .env.example guide le développeur
  if (process.env.NODE_ENV === 'production') {
    // En production, on ne crash pas ici car les variables peuvent être injectées
    // directement dans l'environnement du conteneur/VM
    process.stderr.write('[config] .env non trouvé — les variables doivent être injectées par l\'environnement.\n');
  }
}

/**
 * Lecture sécurisée d'une variable d'environnement obligatoire.
 * Fait planter le processus si la variable est absente en production.
 */
function requireEnvVar(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    if (process.env.NODE_ENV === 'production') {
      process.stderr.write(`[config] ERREUR FATALE : variable d'environnement obligatoire manquante : ${name}\n`);
      process.exit(1);
    }
    // En développement, on retourne une valeur par défaut non vide pour éviter les crashes
    return `DEV_${name}`;
  }
  return value;
}

/**
 * Lecture d'une variable d'environnement optionnelle avec valeur par défaut.
 */
function optionalEnvVar(name, defaultValue) {
  return process.env[name] || defaultValue;
}

/**
 * Lecture d'un entier positif depuis une variable d'environnement.
 */
function requirePositiveInt(name) {
  const value = parseInt(process.env[name], 10);
  if (isNaN(value) || value <= 0) {
    if (process.env.NODE_ENV === 'production') {
      process.stderr.write(`[config] ERREUR FATALE : ${name} doit être un entier positif, reçu : ${process.env[name]}\n`);
      process.exit(1);
    }
    return defaultValueMap[name] || 1;
  }
  return value;
}

const defaultValueMap = {
  PORT: 3000,
  RATE_LIMIT_WINDOW_MS: 900000,
  RATE_LIMIT_MAX_REQUESTS: 100,
};

// ============================================================
// Variables d'environnement validées
// ============================================================

const config = {
  env: optionalEnvVar('NODE_ENV', 'development'),
  port: requirePositiveInt('PORT') || 3000,

  // Supabase
  supabase: {
    url: requireEnvVar('SUPABASE_URL'),
    anonKey: requireEnvVar('SUPABASE_ANON_KEY'),
    serviceRoleKey: requireEnvVar('SUPABASE_SERVICE_ROLE_KEY'),
  },

  // CORS
  cors: {
    origins: optionalEnvVar('CORS_ORIGINS', 'http://localhost:8080')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  // Rate limiting
  rateLimit: {
    windowMs: requirePositiveInt('RATE_LIMIT_WINDOW_MS') || 900000, // 15 min par défaut
    maxRequests: requirePositiveInt('RATE_LIMIT_MAX_REQUESTS') || 100,
    sensitiveMaxRequests: 20, // Pour les endpoints sensibles (Sprint 2+)
  },
};

// ============================================================
// Export
// ============================================================

module.exports = config;
