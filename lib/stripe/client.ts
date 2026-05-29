import Stripe from 'stripe';
import { env } from '@/lib/env';

let _stripe: Stripe | null = null;

/**
 * Lazy-init di Stripe. Lancia se chiamata senza chiave configurata.
 * Da usare SOLO server-side (API routes, server actions). Non
 * importare mai questo modulo dal client.
 */
export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = env.stripeSecretKey();
  if (!key) throw new Error('Stripe non configurato (STRIPE_SECRET_KEY mancante).');
  _stripe = new Stripe(key, {
    apiVersion: '2024-06-20',
    typescript: true,
    appInfo: { name: 'MyCity', version: '1.0.0' },
  });
  return _stripe;
}

/** Verifica se Stripe e' attivabile (chiave presente). */
export function isStripeConfigured(): boolean {
  return !!env.stripeSecretKey();
}

/**
 * Tipi di payload per la creazione di una Checkout Session multi-seller.
 *
 * Pattern (Separate Charges and Transfers — SCT):
 *  - Il buyer paga il totale a MyCity (account piattaforma).
 *  - Al webhook checkout.session.completed vengono creati N ordini DB
 *    (uno per ciascun seller) con payout_status=HELD.
 *  - I transfer ai seller partono da /api/stripe/payout DOPO DELIVERED
 *    (idealmente +7gg per coprire recesso 14gg, via cron).
 *  - Ogni transfer usa source_transaction=charge_id per legare la
 *    liquidità a quella specifica charge (vedi /api/stripe/payout).
 *
 * https://stripe.com/docs/connect/separate-charges-and-transfers
 */
export type CheckoutLineItem = {
  productId: string;
  name: string;
  quantity: number;
  unitAmountCents: number;
  imageUrl?: string;
};

export type CheckoutGroup = {
  sellerId: string;
  storeName: string;
  items: CheckoutLineItem[];
};

export type CreateCheckoutInput = {
  pendingCheckoutId: string;
  groups: CheckoutGroup[];
  /** Spedizione per ciascun gruppo, in centesimi. Stesso ordine di `groups`. */
  shippingPerGroupCents: number[];
  /** Sconto totale (coupon + ritiro in negozio) da applicare in Checkout, in centesimi. */
  totalDiscountCents: number;
  buyerEmail: string;
  buyerUserId: string;
  successUrl: string;
  cancelUrl: string;
};

/**
 * Crea una Stripe Checkout Session che supporta nativamente più seller.
 *
 * Implementazione:
 *  - line_items: 1 per ogni prodotto + 1 "Spedizione" per ogni gruppo con
 *    spesa > 0 (mostra al buyer come si compone il totale).
 *  - discounts: se totalDiscountCents > 0, crea uno Stripe Coupon ad-hoc
 *    `amount_off` e lo passa alla session. Stripe gestisce il display.
 *  - client_reference_id + metadata.pending_checkout_id: ancora il webhook
 *    al record-of-intent salvato su public.pending_checkouts.
 *  - payment_intent_data.transfer_group: condiviso da tutti gli ordini
 *    derivati = riconciliazione SCT semplice.
 *
 * NOTA: payment_method_types include 'card' che su Stripe Checkout abilita
 * automaticamente Apple Pay e Google Pay (Payment Request API). Per
 * aggiungere SEPA / Klarna / PayPal serve estendere qui ED abilitarli sul
 * Dashboard Stripe.
 */
export async function createMultiSellerCheckoutSession(
  input: CreateCheckoutInput,
): Promise<Stripe.Checkout.Session> {
  if (input.groups.length === 0) {
    throw new Error('createMultiSellerCheckoutSession: groups vuoto');
  }
  if (input.groups.length !== input.shippingPerGroupCents.length) {
    throw new Error('createMultiSellerCheckoutSession: shippingPerGroupCents non allineato a groups');
  }

  const stripe = getStripe();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (let i = 0; i < input.groups.length; i++) {
    const g = input.groups[i];
    for (const it of g.items) {
      lineItems.push({
        quantity: it.quantity,
        price_data: {
          currency: 'eur',
          unit_amount: it.unitAmountCents,
          product_data: {
            name: it.name,
            images: it.imageUrl ? [it.imageUrl] : undefined,
            metadata: { seller_id: g.sellerId, product_id: it.productId },
          },
        },
      });
    }
    const shippingCents = input.shippingPerGroupCents[i];
    if (shippingCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: shippingCents,
          product_data: {
            name: `Spedizione — ${g.storeName}`,
            metadata: { seller_id: g.sellerId, kind: 'shipping' },
          },
        },
      });
    }
  }

  // Sconto come Stripe Coupon ad-hoc.
  // max_redemptions=1 + duration=once = non riusabile dopo il primo check-out.
  let discounts: Stripe.Checkout.SessionCreateParams.Discount[] | undefined;
  if (input.totalDiscountCents > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: input.totalDiscountCents,
      currency: 'eur',
      duration: 'once',
      name: 'Sconto MyCity',
      max_redemptions: 1,
      metadata: { pending_checkout_id: input.pendingCheckoutId },
    });
    discounts = [{ coupon: coupon.id }];
  }

  return await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: lineItems,
    discounts,
    customer_email: input.buyerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.pendingCheckoutId,
    metadata: {
      buyer_user_id: input.buyerUserId,
      pending_checkout_id: input.pendingCheckoutId,
      seller_count: String(input.groups.length),
    },
    payment_intent_data: {
      transfer_group: `mc_${input.pendingCheckoutId}`,
      metadata: {
        buyer_user_id: input.buyerUserId,
        pending_checkout_id: input.pendingCheckoutId,
        seller_count: String(input.groups.length),
      },
    },
    automatic_tax: { enabled: false },
    billing_address_collection: 'required',
    locale: 'it',
  });
}

/**
 * Crea un Connect Account "Express" per un seller e ritorna l'URL
 * di onboarding (KYC, IBAN, accordo TOS Stripe). Da chiamare quando
 * il seller completa il KYC su MyCity e prima del primo payout.
 */
export async function createConnectOnboardingLink(args: {
  sellerEmail: string;
  sellerId: string;
  existingAccount?: string | null;
  returnUrl: string;
  refreshUrl: string;
}): Promise<{ accountId: string; url: string }> {
  const stripe = getStripe();

  let accountId = args.existingAccount;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'IT',
      email: args.sellerEmail,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      metadata: { seller_id: args.sellerId },
    });
    accountId = account.id;
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: args.refreshUrl,
    return_url: args.returnUrl,
    type: 'account_onboarding',
  });

  return { accountId, url: link.url };
}

/**
 * Genera un login link monouso verso la Dashboard Express ospitata da
 * Stripe per un Connect account già onboarded. Il seller la usa per
 * gestire saldo, payout reali, IBAN, documenti d'identità (KYC) e dati
 * fiscali — tutto mantenuto da Stripe.
 *
 * Il link è single-use e a breve scadenza: va generato on-demand a ogni
 * click, mai persistito.
 *
 * Lancia se l'account non ha completato l'onboarding (nessuna dashboard
 * da aprire): il chiamante dovrebbe esporre il bottone solo quando
 * charges/payouts sono abilitati.
 *
 * https://stripe.com/docs/connect/express-dashboard
 */
export async function createConnectLoginLink(accountId: string): Promise<{ url: string }> {
  const stripe = getStripe();
  const link = await stripe.accounts.createLoginLink(accountId);
  return { url: link.url };
}

/**
 * Calcola la commissione marketplace (8% del totale, IVA esclusa
 * — semplificazione MVP). Da raffinare quando lo schema commissioni
 * diventa configurabile per seller/categoria.
 */
export const MARKETPLACE_FEE_BPS = 800; // 8.00%

export function computeApplicationFeeCents(amountCents: number): number {
  return Math.round((amountCents * MARKETPLACE_FEE_BPS) / 10000);
}
