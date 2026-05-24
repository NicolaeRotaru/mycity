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
 * Costruisce un Checkout Session con split payment marketplace.
 * - Il buyer paga il totale a MyCity (account principale).
 * - Al webhook `checkout.session.completed` viene creato l'ordine
 *   in DB con payment_status PAID.
 * - Al webhook `charge.succeeded` (manual capture) o al delivered
 *   viene fatto il transfer al seller (vedi /api/stripe/payout).
 *
 * Si usa intenzionalmente il modello "Separate Charges and Transfers"
 * invece di "Direct charges" perche' permette di trattenere i fondi
 * in escrow finche' l'ordine non e' DELIVERED.
 *
 * https://stripe.com/docs/connect/separate-charges-and-transfers
 */
export type CheckoutItem = {
  name: string;
  quantity: number;
  unitAmountCents: number;
  imageUrl?: string;
};

export type CreateCheckoutInput = {
  items: CheckoutItem[];
  shippingCents: number;
  buyerEmail: string;
  buyerUserId: string;
  sellerId: string;
  sellerStripeAccount?: string | null;
  metadata?: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
};

export async function createCheckoutSession(input: CreateCheckoutInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = input.items.map((it) => ({
    quantity: it.quantity,
    price_data: {
      currency: 'eur',
      unit_amount: it.unitAmountCents,
      product_data: {
        name: it.name,
        images: it.imageUrl ? [it.imageUrl] : undefined,
      },
    },
  }));
  if (input.shippingCents > 0) {
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: input.shippingCents,
        product_data: { name: 'Spedizione' },
      },
    });
  }

  return await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: lineItems,
    customer_email: input.buyerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: {
      buyer_user_id: input.buyerUserId,
      seller_id: input.sellerId,
      ...(input.metadata ?? {}),
    },
    payment_intent_data: {
      // Trattieni fondi su account piattaforma. Il transfer al seller
      // avverra' a delivery confirmata via /api/stripe/payout.
      metadata: {
        buyer_user_id: input.buyerUserId,
        seller_id: input.sellerId,
        ...(input.metadata ?? {}),
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
 * Calcola la commissione marketplace (8% del subtotale, IVA esclusa
 * — semplificazione MVP). Da raffinare quando lo schema commissioni
 * diventa configurabile per seller/categoria.
 */
export const MARKETPLACE_FEE_BPS = 800; // 8.00%

export function computeApplicationFeeCents(amountCents: number): number {
  return Math.round((amountCents * MARKETPLACE_FEE_BPS) / 10000);
}
