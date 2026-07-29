// backend/src/middlewares/rateLimiter.js - Middleware de limitation de débit (rate limiting)
// Factory function : rateLimiter({ windowMs, max }) retourne un middleware Express
// qui limite le nombre de requêtes par IP sur une fenêtre de temps donnée.

const rateLimit = require("express-rate-limit");

const rateLimiter = ({ windowMs, max, message } = {}) => {
  return rateLimit({
    windowMs: windowMs || 15 * 60 * 1000,
    max: max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: message || "Trop de requêtes, veuillez réessayer plus tard.",
    },
  });
};

module.exports = { rateLimiter };
