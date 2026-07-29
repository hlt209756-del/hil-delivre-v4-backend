// backend/src/config/supabase.js - Point d'accès unifié au client Supabase
// Ce fichier ré-exporte le client déjà configuré dans services/supabaseService.js
// pour que tous les modules du projet puissent l'importer via '../config/supabase'.

module.exports = require("../services/supabaseService");
