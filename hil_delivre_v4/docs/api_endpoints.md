# Hil_Delivre v4 — Documentation des Endpoints API

## Sprint 1 : Endpoints disponibles

Au Sprint 1, seul l'endpoint de santé est disponible. Aucun endpoint métier n'est implémenté à ce stade.

---

### GET /health

**Description :** Vérification de l'état de santé de l'application et de ses dépendances.

**URL :** `/health` ou `/api/health`

**Authentification :** Non requise

**Paramètres :** Aucun

**Réponse 200 — Application opérationnelle :**

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "4.0.0-sprint1",
  "environment": "production",
  "uptime": 3600.5,
  "services": {
    "api": "operational",
    "database": "operational"
  }
}
```

**Réponse 503 — Application dégradée :**

```json
{
  "status": "degraded",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "4.0.0-sprint1",
  "environment": "production",
  "uptime": 3600.5,
  "services": {
    "api": "operational",
    "database": "error"
  }
}
```

**Codes de statut :**

| Code | Description |
|------|-------------|
| 200 | Application et dépendances opérationnelles |
| 503 | Application dégradée (dépendance indisponible) |
| 429 | Trop de requêtes (rate limit dépassé) |

---

### GET /health/ready

**Description :** Probe de readiness pour les environnements Kubernetes/conteneurisés.

**URL :** `/health/ready`

**Authentification :** Non requise

**Réponse 200 :**

```json
{
  "status": "ready",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## Prévu pour les sprints suivants

| Endpoint | Méthode | Sprint | Description |
|----------|---------|--------|-------------|
| /api/auth/register | POST | Sprint 2 | Inscription utilisateur (OTP) |
| /api/auth/login | POST | Sprint 2 | Connexion utilisateur |
| /api/auth/logout | POST | Sprint 2 | Déconnexion |
| /api/profile | GET | Sprint 2 | Récupérer le profil |
| /api/profile | PUT | Sprint 2 | Mettre à jour le profil |
| /api/profile/kyc | POST | Sprint 3 | Soumettre documents KYC |
| /api/merchants | GET | Sprint 3 | Liste des marchands |
| /api/orders | POST | Sprint 4 | Créer une commande |
| /api/orders/:id | GET | Sprint 4 | Détail d'une commande |
| /api/payments | POST | Sprint 5 | Initier un paiement |

---

## Sécurité de l'API

- **Rate Limiting :** 100 requêtes / 15 minutes (global), 20 requêtes / 15 minutes (endpoints sensibles)
- **CORS :** Whitelist d'origines configurables
- **Helmet :** CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Body Parser :** Limite de 10kb par requête
- **Validation :** Joi/Yup pour tous les endpoints métier (Sprint 2+)
- **Erreur :** Aucun détail interne exposé en production
