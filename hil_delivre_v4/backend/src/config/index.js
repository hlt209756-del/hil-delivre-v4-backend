'use strict';

/**
 * @fileoverview Configuration centralisée de l'environnement pour Hil_Delivre v4.
 * Valide les variables d'environnement requises au démarrage.
 *
 * @module config
 */

const Joi = require('joi');

/**
 * Schéma de validation des variables d'environnement.
 */
const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),

  PORT: Joi.number().integer().min(1024).max(65535).default(3000),
  HOST: Joi.string().default('0.0.0.0'),

  // Supabase
  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_ANON_KEY: Joi.string().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),

  // CORS
  CORS_ORIGINS: Joi.string().default('http://localhost:3000'),

  // Application
  APP_URL: Joi.string().uri().default('https://app.hildelivre.bf'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().default(900000), // 15 min
  RATE_LIMIT_MAX: Joi.number().integer().default(100),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().default(20),

}).unknown(true); // Autoriser les variables non définies dans le schéma

const { error, value: envVars } = envSchema.validate(process.env, {
  abortEarly: false,
});

if (error) {
  const missingVars = error.details.map((d) => d.message).join('\n  - ');
  throw new Error(
    `[CONFIG] Variables d'environnement invalides :\n  - ${missingVars}\n\nVérifiez votre fichier .env`
  );
}

/**
 * Configuration exportée et validée.
 */
const config = {
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isDevelopment: envVars.NODE_ENV === 'development',
  isTest: envVars.NODE_ENV === 'test',

  server: {
    port: envVars.PORT,
    host: envVars.HOST,
  },

  supabase: {
    url: envVars.SUPABASE_URL,
    anonKey: envVars.SUPABASE_ANON_KEY,
    serviceRoleKey: envVars.SUPABASE_SERVICE_ROLE_KEY,
  },

  cors: {
    origins: envVars.CORS_ORIGINS.split(',').map((o) => o.trim()),
  },

  app: {
    url: envVars.APP_URL,
  },

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    max: envVars.RATE_LIMIT_MAX,
    authMax: envVars.AUTH_RATE_LIMIT_MAX,
  },
};

module.exports = config;
