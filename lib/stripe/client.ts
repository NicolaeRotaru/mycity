import Stripe from 'stripe';
import { env } from '@/lib/env';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';

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
    // #241 — Senza questi due parametri la libreria aspetta ottanta secondi e
    // riprova due volte da sola: quasi tre minuti col cliente fermo sulla
    // rotella, e la nostra istanza occupata. Dieci secondi sono gia' generosi
    // per Stripe, e trasformano un'attesa infinita in un errore rapido che si
    // puo' mostrare («riprova») invece di lasciare la gente appesa.
    timeout: 10_000,
    maxNetworkRetries: 2,
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
 *  - I transfer ai seller partono DOPO DELIVERED via cron automatico
 *    (app/api/cron/release-payouts, consegna +24h). I rimborsi/recessi
 *    tardivi sono recuperati dal venditore via reversal (claw-back).
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
  /** Fee di consegna piattaforma per ciascun gruppo, in centesimi. Stesso ordine di `groups`. */
  deliveryFeePerGroupCents: number[];
  /** Sconto totale (coupon + ritiro in negozio) da applicare in Checkout, in centesimi. */
  totalDiscountCents: number;
  buyerEmail: string;
  buyerUserId: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Quando scade la riserva della merce (millisecondi). La sessione di pagamento
   * scade insieme a lei: vedi il commento in `sessions.create`.
   */
  pendingExpiresAt?: number;
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
  if (input.groups.length !== input.deliveryFeePerGroupCents.length) {
    throw new Error('createMultiSellerCheckoutSession: deliveryFeePerGroupCents non allineato a groups');
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
    const deliveryFeeCents = input.deliveryFeePerGroupCents[i];
    if (deliveryFeeCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: deliveryFeeCents,
          product_data: {
            name: `Costo di consegna — ${g.storeName}`,
            metadata: { seller_id: g.sellerId, kind: 'delivery_fee' },
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

  // La sessione di pagamento scade quando scade la riserva della merce.
  //
  // Il difetto: la riserva dura due ore (`pending_checkouts.expires_at`), e dopo
  // quelle due ore un lavoro periodico rimette la merce in vendita. La sessione
  // Stripe, invece, non aveva scadenza: durava le 24 ore di default. Chi pagava
  // dopo tre ore riusciva a pagare, e il webhook creava l'ordine di merce che
  // nel frattempo era stata rimessa a magazzino — e magari venduta a un altro.
  // Stripe accetta un minimo di 30 minuti e un massimo di 24 ore.
  const scadenzaRiservaSec = Math.floor((input.pendingExpiresAt ?? 0) / 1000);
  const minimoSec = Math.floor(Date.now() / 1000) + 31 * 60;
  const massimoSec = Math.floor(Date.now() / 1000) + 23 * 60 * 60;
  const expiresAt = scadenzaRiservaSec > 0
    ? Math.min(Math.max(scadenzaRiservaSec, minimoSec), massimoSec)
    : undefined;

  return await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: lineItems,
    discounts,
    customer_email: input.buyerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
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
 * Crea un Connect Account "Express" e ritorna l'URL di onboarding (KYC, IBAN,
 * accordo TOS Stripe). La usano sia i negozi sia i fattorini: da chiamare
 * quando la verifica su MyCity e' completa e prima del primo pagamento.
 */
export async function createConnectOnboardingLink(args: {
  sellerEmail: string;
  sellerId: string;
  existingAccount?: string | null;
  returnUrl: string;
  refreshUrl: string;
  /**
   * 30/8/2026 (R048) — CHI E', PERCHE' CAMBIA COSA GLI CHIEDE STRIPE.
   *
   * Prima non c'era: la stessa richiesta partiva identica per il negozio e per
   * il fattorino, e chiedeva a tutti e due anche `card_payments`, cioe' il
   * permesso di incassare carte dai clienti. Il fattorino non incassera' mai
   * niente da nessuno — nel modello scelto (Separate Charges & Transfers)
   * l'incasso lo fa la piattaforma, a lui serve solo poter RICEVERE un
   * bonifico — ma quella capacita' gli fa affrontare una verifica molto piu'
   * pesante: piu' attrito, piu' abbandoni, compenso fermo.
   */
  ruolo: 'venditore' | 'fattorino';
}): Promise<{ accountId: string; url: string }> {
  const stripe = getStripe();

  let accountId = args.existingAccount;
  if (!accountId) {
    // 181 — Senza chiave di idempotenza, ogni errore di rete fra la creazione
    // del conto e il salvataggio dell'id lasciava un conto Connect orfano su
    // Stripe: nessuno lo cancella, e alla verifica antiriciclaggio quei conti
    // fantasma sono un problema di chi li ha creati. Con la chiave, riprovare
    // restituisce SEMPRE lo stesso conto.
    /**
     * 30/8/2026 (R048) — IL TIPO DI ATTIVITA' NON LO DECIDIAMO NOI.
     *
     * Qui c'era `business_type: 'individual'`, fisso, per tutti. Un negozio
     * costituito in societa' — a Piacenza sono tanti: SRL, SNC — nasceva
     * dichiarato come persona fisica, e nella verifica si trovava a dover
     * dichiarare dati che non gli corrispondono. L'onboarding si arena, e
     * finche' non e' completo l'ordine resta in PENDING_SELLER_ONBOARDING:
     * il negozio ha consegnato e non viene pagato.
     *
     * Senza questo campo il tipo lo chiede Stripe durante la verifica, che e'
     * l'unico momento in cui la persona giusta puo' rispondere.
     */
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'IT',
      email: args.sellerEmail,
      capabilities: {
        // Al fattorino serve solo ricevere. Al negozio si tiene anche
        // `card_payments`: cambiare quello a chi ha gia' un conto aperto
        // vorrebbe dire rimettergli in mezzo una verifica, e non e' questo il
        // difetto da riparare.
        ...(args.ruolo === 'venditore' ? { card_payments: { requested: true } } : {}),
        transfers: { requested: true },
      },
      metadata: { seller_id: args.sellerId },
    }, { idempotencyKey: `connect_${args.sellerId}` });
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
 * Aliquota commissione marketplace (10%, IVA esclusa — semplificazione MVP).
 * Funzione PURA: applica solo la percentuale all'importo passato. La BASE
 * imponibile (SOLO il subtotale prodotti, MAI spedizione/consegna) è decisa da
 * computeOrderSplit. La costante è centralizzata in lib/constants (client-safe)
 * e qui ri-esportata per compatibilità.
 */
export { MARKETPLACE_FEE_BPS };

export function computeApplicationFeeCents(amountCents: number): number {
  return Math.round((amountCents * MARKETPLACE_FEE_BPS) / 10000);
}

/**
 * Split del denaro di UN ordine (centesimi interi). Fonte di verità UNICA:
 * webhook (carta), COD e backfill la usano tutte, così non possono divergere.
 *
 * DECISIONE DI REVENUE: la commissione (10%) grava SOLO sul SUBTOTALE prodotti
 * — NON sulla spedizione né sulla fee di consegna. Il venditore incassa quindi
 * un netto pulito pari al 90% di ciò che vende.
 *
 * Il totale pagato dal buyer si scompone in quote che non si sovrappongono:
 *   subtotale prodotti = netto venditore (90%) + commissione piattaforma (10%);
 *   + fee di consegna trattenuta dalla piattaforma;
 *   + spedizione, che resta alla piattaforma.
 * La spedizione NON fa parte del netto venditore.
 *
 * Il compenso del fattorino NON e' una di queste quote: e' una cifra fissa
 * (COMPENSO_RIDER_CENTS) che la piattaforma paga a parte, via
 * releaseRiderPayout. Prima era la spedizione stessa, e li' stava il guasto:
 * sopra i 30 euro la spedizione e' zero, quindi il fattorino non veniva pagato.
 * Adesso il compenso e' coperto dalla fee di consegna, che vale quanto lui.
 *
 * Invariante: sellerPayout + applicationFee + deliveryFee + shipping === total
 */
export function computeOrderSplit(args: {
  totalCents: number;
  deliveryFeeCents: number;
  shippingCents: number;
}): { subtotalCents: number; applicationFeeCents: number; sellerPayoutCents: number } {
  const { totalCents, deliveryFeeCents, shippingCents } = args;
  const subtotalCents = Math.max(0, totalCents - deliveryFeeCents - shippingCents);
  const applicationFeeCents = computeApplicationFeeCents(subtotalCents);
  const sellerPayoutCents = Math.max(0, subtotalCents - applicationFeeCents);
  return { subtotalCents, applicationFeeCents, sellerPayoutCents };
}

/**
 * Netto del venditore per UN ordine. Scorciatoia su computeOrderSplit, mantenuta
 * per compatibilità con i chiamanti/test esistenti.
 */
export function computeSellerPayoutCents(args: {
  totalCents: number;
  deliveryFeeCents: number;
  shippingCents: number;
}): number {
  return computeOrderSplit(args).sellerPayoutCents;
}
