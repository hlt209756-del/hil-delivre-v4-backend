# ─────────────────────────────────────────────────────────────────────────────
# Hil_Delivre v4 — Backend API Dockerfile
# Multi-stage build optimisé pour la production
# ─────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copier uniquement les fichiers de dépendances pour le cache Docker
COPY package.json package-lock.json ./

# Installer les dépendances de production uniquement
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Sécurité : installer les mises à jour de sécurité
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache wget curl dumb-init && \
    rm -rf /var/cache/apk/*

# Sécurité : créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hildelivre -u 1001 -G nodejs

WORKDIR /app

# Copier les dépendances depuis le stage deps
COPY --from=deps --chown=hildelivre:nodejs /app/node_modules ./node_modules

# Copier le code source
COPY --chown=hildelivre:nodejs package.json ./
COPY --chown=hildelivre:nodejs src/ ./src/

# Créer le répertoire de logs
RUN mkdir -p /app/logs && chown hildelivre:nodejs /app/logs

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    PORT=3000 \
    # Optimisations Node.js
    NODE_OPTIONS="--max-old-space-size=512 --gc-interval=100" \
    # Désactiver les couleurs dans les logs
    NO_COLOR=1

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/monitoring/health || exit 1

# Exposer le port
EXPOSE 3000

# Utiliser l'utilisateur non-root
USER hildelivre

# Utiliser dumb-init pour gérer les signaux correctement (graceful shutdown)
ENTRYPOINT ["dumb-init", "--"]

# Démarrage
CMD ["node", "src/server.js"]
