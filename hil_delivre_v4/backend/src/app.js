'use strict';
/**
• @fileoverview Application Express principale pour Hil_Delivre v4.
• Configure les middlewares de sécurité, les routes et la gestion d'erreurs.
• @module app
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
// Routes - Sprint 2 (Auth/KYC/Profils)
const authRoutes = require('./routes/authRoutes');
const kycRoutes = require('./routes/kycRoutes');
const profileRoutes = require('./routes/profileRoutes');
// Routes - Sprint 3 (Menu/Commandes)
const menuRoutes = require('./routes/menuRoutes');
const orderRoutes = require('./routes/orderRoutes');
// Routes - Sprint 4 (Paiements)
const paymentRoutes = require('./routes/paymentRoutes');
const configRoutes = require('./routes/configRoutes');
// Routes - Sprint 5 (Livraison)
const deliveryRoutes = require('./routes/deliveryRoutes');
// Routes - Sprint 6 (Notifications/OTP)
const notificationRoutes = require('./routes/notificationRoutes');
const otpRoutes = require('./routes/otpRoutes');
// Routes - Sprint 7 (Admin)
const adminRoutes = require('./routes/adminRoutes');
const delivererRoutes = require('./routes/delivererRoutes');
// Routes - Sprint 8 (Abonnements)
const subscriptionRoutes = require('./routes/subscriptionRoutes');
// Routes - Sprint 9 (Notation/Certification/Fidélisation)
const ratingRoutes = require('./routes/ratingRoutes');
const certificationRoutes = require('./routes/certificationRoutes');
const loyaltyRoutes = require('./routes/loyaltyRoutes');
// Routes - Sprint 10 (Monitoring)
const monitoringRoutes = require('./routes/monitoringRoutes');
const app = express();
// Middlewares globaux
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Rate limiting
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: parseInt(process.env.RATE_LIMIT_USER) || 60,
  message: { message: 'Trop de requêtes depuis cette IP, veuillez réessayer plus tard.' }
});
app.use('/api/', apiLimiter);
// Définition des routes API
app.use('/api/auth', authRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/config', configRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/deliverer', delivererRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/certifications', certificationRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/monitoring', monitoringRoutes);
// Route de santé (Health check)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'API Hil_Delivre v4 opérationnelle' });
});
// Gestion des erreurs 404
app.use((req, res, next) => {
  res.status(404).json({ message: 'Route non trouvée' });
});
// Gestion globale des erreurs
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    message: err.message || 'Erreur interne du serveur',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});
module.exports = app;
