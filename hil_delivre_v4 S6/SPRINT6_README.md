# Sprint 6 — Notifications temps réel : Socket.IO, Push FCM, SMS OTP

## Vue d'ensemble

Le Sprint 6 implémente le système complet de notifications multi-canal pour Hil_Delivre v4 :

- **Socket.IO** : Communications temps réel (position livreur, mises à jour de commande, notifications instantanées)
- **Firebase Cloud Messaging (FCM)** : Notifications push iOS/Android
- **Africa's Talking SMS** : Vérification OTP du numéro de téléphone
- **In-app** : Persistance et historique des notifications en BDD
- **Préférences** : Contrôle granulaire par type de notification et canal

---

## Architecture

```
Sprint 6
├── database/
│   └── schema_sprint6.sql                    # Migration SQL (5 tables, 3 enums, 2 fonctions)
├── backend/src/
│   ├── config/
│   │   └── socketio.js                       # Configuration Socket.IO (auth JWT, rooms, events)
│   ├── services/
│   │   ├── notificationService.js            # Orchestration multi-canal (16 templates)
│   │   ├── fcmService.js                     # Push notifications FCM
│   │   └── otpService.js                     # OTP SMS via Africa's Talking
│   ├── controllers/
│   │   └── notificationController.js         # 9 handlers d'endpoints
│   ├── routes/
│   │   ├── notificationRoutes.js             # 7 routes notifications
│   │   └── otpRoutes.js                      # 2 routes OTP
│   ├── middlewares/
│   │   └── validationSprint6.js              # 7 schémas Joi
│   └── __tests__/
│       └── notification.test.js              # 30+ tests
├── apps/mobile/
│   ├── services/
│   │   └── notificationService.js            # Client API + Socket.IO + FCM
│   ├── screens/common/
│   │   ├── NotificationsScreen.js            # Liste des notifications
│   │   └── OTPVerificationScreen.js          # Écran de saisie OTP
│   ├── contexts/
│   │   └── NotificationContext.js            # Context global notifications
│   └── components/
│       └── NotificationBadge.js              # Badge animé (compteur non-lues)
├── docs/
│   └── API_SPRINT6.md                        # Documentation API complète
├── .env.example                              # Variables d'environnement
└── SPRINT6_README.md                         # Ce fichier
```

---

## Migration SQL

### Nouvelles tables

| Table | Description |
|-------|-------------|
| `notifications` | Historique de toutes les notifications (in-app) |
| `notification_preferences` | Préférences par utilisateur et type |
| `device_tokens` | Tokens FCM des appareils (multi-device) |
| `otp_codes` | Codes OTP hashés avec expiration et tentatives |
| `socket_connections` | Suivi des connexions Socket.IO actives |

### Nouvelles colonnes (profiles_data)

| Colonne | Type | Description |
|---------|------|-------------|
| `phone_verified` | BOOLEAN | Numéro de téléphone vérifié |
| `phone_verified_at` | TIMESTAMPTZ | Date de vérification |
| `push_notifications_enabled` | BOOLEAN | Push activés globalement |

### Fonctions PL/pgSQL

| Fonction | Description |
|----------|-------------|
| `cleanup_expired_otps()` | Supprime les OTP expirés (cron) |
| `cleanup_stale_sockets()` | Supprime les connexions mortes (cron) |

### Exécution

```bash
psql $DATABASE_URL < database/schema_sprint6.sql
```

---

## Services Backend

### notificationService.js — Orchestration multi-canal

**Fonctionnalité clé :** Pour chaque notification, orchestre automatiquement :
1. **Socket.IO** → Notification instantanée (si connecté)
2. **FCM Push** → Notification push (si activé dans les préférences)
3. **In-app** → Persistance en BDD (toujours)

**16 templates de notifications** avec :
- Titre et corps dynamiques (fonctions)
- Destinataires cibles par rôle
- Données contextuelles (order_ref, amount, eta, etc.)

| Fonction | Description |
|----------|-------------|
| `sendNotification({type, recipients, data, orderId})` | Envoi multi-canal |
| `getUserNotifications(userId, options)` | Liste paginée |
| `markAsRead(userId, notificationIds)` | Marquage lu |
| `updatePreferences(userId, type, prefs)` | Mise à jour préférences |
| `getPreferences(userId)` | Récupération préférences |

### fcmService.js — Push notifications

| Fonction | Description |
|----------|-------------|
| `sendToUser(userId, notification, data)` | Push à un utilisateur (multi-device) |
| `sendToUsers(userIds, notification, data)` | Push à plusieurs utilisateurs |
| `sendToTopic(topic, notification, data)` | Push à un topic |
| `registerToken(userId, token, platform)` | Enregistrement token |
| `unregisterToken(userId, token)` | Suppression token |

**Caractéristiques :**
- Multicast par lots de 1000 tokens
- Désactivation automatique des tokens invalides (NotRegistered)
- Timeout 10s avec AbortController
- Respect des préférences utilisateur

### otpService.js — SMS OTP

| Fonction | Description |
|----------|-------------|
| `sendOTP(phoneNumber, purpose, userId, ip)` | Génère et envoie un OTP |
| `verifyOTP(phoneNumber, code, purpose)` | Vérifie un code OTP |
| `normalizePhoneNumber(phone)` | Normalise au format +226XXXXXXXX |

**Sécurité OTP :**
- Code 6 chiffres généré avec `crypto.randomBytes()`
- Stocké hashé (SHA-256) en BDD
- Expiration : 5 minutes
- Max 3 tentatives par code
- Rate limit : 3 OTP par numéro par heure
- Cooldown : 60 secondes entre deux envois
- Comparaison timing-safe (anti timing attack)
- Invalidation des anciens codes non vérifiés

### socketio.js — Configuration Socket.IO

| Fonction | Description |
|----------|-------------|
| `initializeSocketIO(httpServer)` | Initialise le serveur Socket.IO |
| `emitToUser(userId, event, data)` | Émet à un utilisateur |
| `emitToOrder(orderId, event, data)` | Émet à une room de commande |
| `emitToRole(role, event, data)` | Émet à un rôle |
| `broadcast(event, data)` | Broadcast global |

**Caractéristiques :**
- Authentification JWT à la connexion (middleware)
- Rooms automatiques : `user:{id}`, `role:{role}`
- Rooms de commande avec vérification d'accès
- Heartbeat personnalisé (monitoring)
- Enregistrement/désenregistrement en BDD

---

## Endpoints API

### Notifications

| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| GET | `/api/notifications` | * | Liste paginée |
| PUT | `/api/notifications/read` | * | Marquer comme lu |
| GET | `/api/notifications/preferences` | * | Récupérer préférences |
| PUT | `/api/notifications/preferences` | * | Modifier préférences |
| POST | `/api/notifications/device` | * | Enregistrer token FCM |
| DELETE | `/api/notifications/device` | * | Supprimer token FCM |
| POST | `/api/notifications/broadcast` | admin | Broadcast par rôle |

### OTP

| Méthode | Route | Rôle | Description |
|---------|-------|------|-------------|
| POST | `/api/otp/send` | * | Envoyer OTP par SMS |
| POST | `/api/otp/verify` | * | Vérifier code OTP |

---

## Intégration avec les Sprints précédents

### Sprint 2 (Auth)
- La vérification OTP met à jour `phone_verified` dans `profiles_data`
- Le token FCM est enregistré au login, supprimé au logout

### Sprint 3 (Commandes)
- Notification `order_created` au marchand à la création
- Notification `order_accepted` au client à l'acceptation
- Notification `order_cancelled` aux parties à l'annulation

### Sprint 4 (Paiement)
- Notification `payment_received` à la confirmation PayDunya
- Notification `payment_failed` en cas d'échec

### Sprint 5 (Livraison)
- Notification `delivery_proposed` au livreur lors de l'assignation
- Notification `delivery_accepted` au client/marchand
- Socket.IO remplace le polling pour la position du livreur
- Événements de tracking émis via Socket.IO à la room de commande

---

## Mobile

### NotificationsScreen
- Liste paginée avec pull-to-refresh et infinite scroll
- Filtres : Toutes / Non lues
- Marquage comme lu au tap
- Navigation contextuelle (tap → détail commande)
- Badge de compteur non-lues
- Icônes par type de notification

### OTPVerificationScreen
- 6 champs de saisie individuels avec auto-focus
- Auto-submit quand le code est complet
- Support du paste (collage)
- Timer de cooldown pour le renvoi (60s)
- Affichage du numéro masqué
- Gestion des erreurs (tentatives restantes, expiration)

### NotificationContext
- Connexion Socket.IO automatique au login
- Enregistrement push token FCM
- Compteur global de non-lues
- Handlers pour les événements Socket.IO
- Reconnexion automatique (foreground/background)
- Vibration pour les notifications importantes

### NotificationBadge
- Badge animé (pop-in) sur l'icône de navigation
- Affiche "99+" au-delà de 99 notifications

---

## Sécurité

### OTP
- Codes hashés SHA-256 (jamais stockés en clair)
- Expiration stricte (5 min)
- Brute-force protection (3 tentatives max)
- Rate limiting multi-niveau (IP + numéro)
- Cooldown anti-spam (60s)
- Timing-safe comparison
- Nettoyage automatique (fonction PL/pgSQL)
- Numéro masqué dans les réponses API

### Socket.IO
- JWT obligatoire à la connexion
- Vérification d'accès pour les rooms de commande
- Heartbeat + cleanup des connexions mortes
- Pas de données sensibles dans les payloads

### FCM
- Tokens auto-désactivés si invalides
- Respect des préférences utilisateur
- Pas de données sensibles dans les notifications push
- Server key jamais exposée côté client

### Rate Limiting
| Endpoint | Limite |
|----------|--------|
| Notifications list | 60 req/min |
| OTP send | 5 req/h par IP |
| OTP verify | 10 req/15min par IP |
| Admin broadcast | 10 req/h |

---

## Configuration

### Variables d'environnement (nouvelles)

```env
# Firebase Cloud Messaging
FCM_SERVER_KEY=your-fcm-server-key
FCM_PROJECT_ID=your-firebase-project-id

# Africa's Talking SMS
AFRICASTALKING_API_KEY=your-at-api-key
AFRICASTALKING_USERNAME=sandbox
AFRICASTALKING_SENDER_ID=HilDelivre
AFRICASTALKING_ENV=sandbox

# Socket.IO
CORS_ORIGINS=http://localhost:3000,http://localhost:19006
```

### Intégration serveur Express

```javascript
const http = require('http');
const app = require('./app');
const { initializeSocketIO } = require('./config/socketio');

const server = http.createServer(app);
initializeSocketIO(server);

server.listen(process.env.PORT || 3000);
```

---

## Tests

```bash
# Exécuter tous les tests Sprint 6
npm test -- --testPathPattern="notification"

# Tests complets
npm test -- backend/src/__tests__/notification.test.js
```

**Couverture :** 30+ tests (services, validation, templates, OTP)

---

## Dépendances ajoutées

### Backend
```json
{
  "socket.io": "^4.x",
  "jsonwebtoken": "^9.x"
}
```

### Mobile
```json
{
  "socket.io-client": "^4.x",
  "expo-notifications": "^0.28.x",
  "expo-device": "^6.x"
}
```

---

## Points d'attention pour les sprints suivants

1. **Sprint 7 (Admin)** :
   - Dashboard de monitoring Socket.IO (connexions actives)
   - Statistiques de notifications (taux de lecture, taux de livraison push)
   - Interface de broadcast avec ciblage avancé

2. **Sprint 8 (Abonnements)** :
   - Notifications de renouvellement d'abonnement
   - Notifications d'expiration imminente
   - Push pour les promotions ciblées

3. **Production** :
   - Migrer vers FCM HTTP v1 API (Legacy sera déprécié)
   - Configurer un sender ID Africa's Talking vérifié
   - Mettre en place les cron jobs Supabase pour cleanup_expired_otps et cleanup_stale_sockets
   - Considérer Redis adapter pour Socket.IO si multi-instances
