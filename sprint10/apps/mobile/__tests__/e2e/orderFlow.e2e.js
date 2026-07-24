'use strict';

/**
 * @fileoverview Tests E2E mobile (Detox) du flux de commande pour Hil_Delivre v4.
 * Simule le parcours utilisateur complet sur l'application mobile.
 * @module __tests__/e2e/orderFlow.e2e
 */

/* global describe, it, beforeAll, beforeEach, expect, element, by, device, waitFor */

describe('E2E Mobile: Flux de commande complet', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      permissions: { location: 'always', notifications: 'YES' },
    });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
  });

  // ─── Phase 1 : Connexion ───────────────────────────────────────────────────

  describe('Phase 1: Connexion utilisateur', () => {
    it('affiche l\'écran de connexion', async () => {
      await expect(element(by.id('login-screen'))).toBeVisible();
      await expect(element(by.id('email-input'))).toBeVisible();
      await expect(element(by.id('password-input'))).toBeVisible();
      await expect(element(by.id('login-button'))).toBeVisible();
    });

    it('se connecte avec un compte client de test', async () => {
      await element(by.id('email-input')).typeText('client.test@hildelivre.bf');
      await element(by.id('password-input')).typeText('TestP@ss2024!');
      await element(by.id('login-button')).tap();

      // Attendre la navigation vers l'écran principal
      await waitFor(element(by.id('home-screen')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('affiche le message de bienvenue', async () => {
      await expect(element(by.text('Bonjour, Amadou'))).toBeVisible();
    });
  });

  // ─── Phase 2 : Parcours du menu ───────────────────────────────────────────

  describe('Phase 2: Consultation du menu et ajout au panier', () => {
    it('navigue vers la liste des restaurants', async () => {
      await element(by.id('tab-restaurants')).tap();
      await waitFor(element(by.id('restaurants-list')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('affiche les restaurants disponibles', async () => {
      await expect(element(by.id('restaurant-card-0'))).toBeVisible();
    });

    it('sélectionne un restaurant', async () => {
      await element(by.id('restaurant-card-0')).tap();
      await waitFor(element(by.id('menu-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('affiche le menu du restaurant', async () => {
      await expect(element(by.id('menu-category-0'))).toBeVisible();
      await expect(element(by.id('menu-item-0'))).toBeVisible();
    });

    it('ajoute un article au panier', async () => {
      await element(by.id('menu-item-0-add-button')).tap();

      // Vérifier que le badge du panier est mis à jour
      await expect(element(by.id('cart-badge'))).toHaveText('1');
    });

    it('augmente la quantité d\'un article', async () => {
      await element(by.id('menu-item-0-add-button')).tap();
      await expect(element(by.id('cart-badge'))).toHaveText('2');
    });
  });

  // ─── Phase 3 : Panier et commande ─────────────────────────────────────────

  describe('Phase 3: Validation du panier et passage de commande', () => {
    it('navigue vers le panier', async () => {
      await element(by.id('cart-button')).tap();
      await waitFor(element(by.id('cart-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('affiche le récapitulatif du panier', async () => {
      await expect(element(by.id('cart-item-0'))).toBeVisible();
      await expect(element(by.id('cart-subtotal'))).toBeVisible();
      await expect(element(by.id('cart-delivery-fee'))).toBeVisible();
      await expect(element(by.id('cart-total'))).toBeVisible();
    });

    it('affiche les frais de livraison estimés', async () => {
      const deliveryFee = element(by.id('cart-delivery-fee'));
      await expect(deliveryFee).toBeVisible();
      // Les frais doivent être >= 500 FCFA (minimum garanti)
    });

    it('sélectionne l\'adresse de livraison', async () => {
      await element(by.id('delivery-address-input')).tap();
      await waitFor(element(by.id('address-picker-screen')))
        .toBeVisible()
        .withTimeout(5000);

      // Sélectionner une adresse enregistrée
      await element(by.id('saved-address-0')).tap();
      await waitFor(element(by.id('cart-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('sélectionne le mode de paiement Mobile Money', async () => {
      await element(by.id('payment-method-selector')).tap();
      await element(by.id('payment-method-mobile-money')).tap();
    });

    it('passe la commande', async () => {
      await element(by.id('place-order-button')).tap();

      // Attendre la confirmation
      await waitFor(element(by.id('order-confirmation-screen')))
        .toBeVisible()
        .withTimeout(15000);
    });

    it('affiche la confirmation de commande', async () => {
      await expect(element(by.id('order-number'))).toBeVisible();
      await expect(element(by.id('order-status'))).toHaveText('En attente de paiement');
    });
  });

  // ─── Phase 4 : Paiement ───────────────────────────────────────────────────

  describe('Phase 4: Paiement Mobile Money', () => {
    it('redirige vers l\'interface de paiement', async () => {
      await waitFor(element(by.id('payment-webview')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('simule la confirmation du paiement', async () => {
      // En mode test, le paiement est auto-confirmé
      await waitFor(element(by.id('payment-success-screen')))
        .toBeVisible()
        .withTimeout(30000);

      await expect(element(by.text('Paiement confirmé'))).toBeVisible();
    });

    it('navigue vers le suivi de commande', async () => {
      await element(by.id('track-order-button')).tap();
      await waitFor(element(by.id('order-tracking-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });

  // ─── Phase 5 : Suivi de livraison ─────────────────────────────────────────

  describe('Phase 5: Suivi de la livraison en temps réel', () => {
    it('affiche la carte de suivi', async () => {
      await expect(element(by.id('tracking-map'))).toBeVisible();
    });

    it('affiche le statut "En préparation"', async () => {
      await waitFor(element(by.text('En préparation')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('affiche les étapes de la commande', async () => {
      await expect(element(by.id('tracking-steps'))).toBeVisible();
      await expect(element(by.id('step-accepted'))).toBeVisible();
      await expect(element(by.id('step-preparing'))).toBeVisible();
    });

    it('met à jour le statut quand le livreur est assigné', async () => {
      // Simuler l'assignation via Socket.IO (en mode test)
      await waitFor(element(by.text('Livreur en route')))
        .toBeVisible()
        .withTimeout(30000);
    });

    it('affiche la position du livreur sur la carte', async () => {
      await waitFor(element(by.id('deliverer-marker')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('affiche l\'ETA de livraison', async () => {
      await expect(element(by.id('delivery-eta'))).toBeVisible();
    });
  });

  // ─── Phase 6 : Réception et notation ───────────────────────────────────────

  describe('Phase 6: Réception et notation', () => {
    it('affiche la notification de livraison', async () => {
      // Simuler la livraison complète
      await waitFor(element(by.text('Commande livrée')))
        .toBeVisible()
        .withTimeout(60000);
    });

    it('affiche l\'écran de notation', async () => {
      await waitFor(element(by.id('rating-screen')))
        .toBeVisible()
        .withTimeout(10000);
    });

    it('note le restaurant (5 étoiles)', async () => {
      await element(by.id('merchant-star-5')).tap();
      await expect(element(by.id('merchant-rating-value'))).toHaveText('5');
    });

    it('note le livreur (4 étoiles)', async () => {
      await element(by.id('deliverer-star-4')).tap();
      await expect(element(by.id('deliverer-rating-value'))).toHaveText('4');
    });

    it('ajoute un commentaire', async () => {
      await element(by.id('rating-comment-input')).typeText('Excellent service, merci !');
    });

    it('soumet la notation', async () => {
      await element(by.id('submit-rating-button')).tap();

      await waitFor(element(by.text('Merci pour votre avis !')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('retourne à l\'écran principal', async () => {
      await element(by.id('back-to-home-button')).tap();
      await waitFor(element(by.id('home-screen')))
        .toBeVisible()
        .withTimeout(5000);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests de la carte temps réel
// ─────────────────────────────────────────────────────────────────────────────

describe('E2E Mobile: Carte temps réel', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: false });
  });

  it('navigue vers la carte temps réel', async () => {
    await element(by.id('tab-map')).tap();
    await waitFor(element(by.id('realtime-map-screen')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('affiche la carte avec la position de l\'utilisateur', async () => {
    await expect(element(by.id('map-view'))).toBeVisible();
    await expect(element(by.id('user-location-marker'))).toBeVisible();
  });

  it('affiche le statut de connexion', async () => {
    await expect(element(by.id('connection-status'))).toBeVisible();
  });

  it('affiche les livreurs disponibles', async () => {
    await waitFor(element(by.id('deliverer-marker-0')))
      .toBeVisible()
      .withTimeout(10000);
  });

  it('centre la carte sur l\'utilisateur au tap du bouton', async () => {
    // D'abord déplacer la carte
    await element(by.id('map-view')).swipe('left', 'fast');
    // Puis recentrer
    await element(by.id('center-button')).tap();
    // La carte devrait revenir à la position initiale
  });

  it('affiche les clusters quand le zoom est bas', async () => {
    // Zoom out
    await element(by.id('map-view')).pinch(0.5);
    await waitFor(element(by.id('cluster-marker-0')))
      .toBeVisible()
      .withTimeout(5000);
  });

  it('affiche les livreurs individuels quand le zoom est élevé', async () => {
    // Zoom in
    await element(by.id('map-view')).pinch(2);
    await waitFor(element(by.id('deliverer-marker-0')))
      .toBeVisible()
      .withTimeout(5000);
  });
});
