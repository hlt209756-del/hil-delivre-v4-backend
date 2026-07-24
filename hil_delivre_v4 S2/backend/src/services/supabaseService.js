'use strict';

/**
 * @fileoverview Service centralisé Supabase pour Hil_Delivre v4.
 * Fournit deux clients :
 * - supabaseAdmin : utilise la clé service_role (opérations admin, bypass RLS)
 * - getSupabaseClient(token) : client authentifié avec le JWT utilisateur (respecte RLS)
 *
 * @module services/supabaseService
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validation au démarrage — fail-fast si les variables manquent
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    '[FATAL] Variables Supabase manquantes. Vérifiez SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY dans .env'
  );
}

/**
 * Client Supabase admin (service_role).
 * Bypass RLS — à utiliser UNIQUEMENT côté backend pour les opérations privilégiées.
 * JAMAIS exposé au client.
 */
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/**
 * Crée un client Supabase authentifié avec le JWT de l'utilisateur.
 * Respecte les politiques RLS.
 *
 * @param {string} accessToken - JWT Bearer token de l'utilisateur
 * @returns {import('@supabase/supabase-js').SupabaseClient} Client Supabase authentifié
 */
function getSupabaseClient(accessToken) {
  if (!accessToken) {
    throw new Error('[supabaseService] accessToken requis pour créer un client authentifié');
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

module.exports = {
  supabaseAdmin,
  getSupabaseClient,
  SUPABASE_URL,
};
