/**
 * Catalogo eventi — Single source of truth + façade PostHog ⇄ GA4.
 *
 * Esperti consultati:
 * - Data Analyst: "Schema events centralizzato evita drift. Naming snake_case
 *   convenzionale PostHog. Properties tipizzate."
 * - Senior PM: "Funnel buyer = signup → view_product → add_to_cart →
 *   begin_checkout → checkout_step → purchase. Misura ogni step."
 *
 * Convention:
 * - Eventi PostHog in past tense: 'product_viewed', non 'view_product'
 * - Properties con prefisso entità: 'product_id', 'order_total_cents'
 * - Gli eventi e-commerce fanno fan-out anche a GA4 (gtag) con i nomi
 *   standard GA4 (view_item, add_to_cart, begin_checkout, purchase, ...).
 *
 * Consenso: PostHog è gated in posthog.tsx (readConsent().analytics). Per GA4
 * il cancello è dentro `ga()` qui sotto, e legge lo stesso consenso.
 *
 * #223 — Prima qui c'era scritto che il cancello di GA4 era «gtag non è
 * presente». Non era vero: components/GoogleAnalytics.tsx definisce
 * window.gtag anche senza consenso (serve per poter mandare il segnale di
 * consenso stesso), quindi `ga()` sparava. Un commento che descrive un
 * comportamento inesistente è esso stesso un difetto: chi legge smette di
 * controllare.
 */

import { track } from './posthog';
import { readConsent } from '@/lib/consent';

/**
 * Sink GA4: fan-out parallelo a PostHog per gli eventi e-commerce.
 * No-op se gtag non è caricato (= nessun consenso analytics).
 */
function ga(name: string, params: Record<string, unknown> = {}) {
  if (typeof window === 'undefined' || !window.gtag) return;
  // #223 — Il cancello vero: lo stesso consenso che governa PostHog.
  if (!readConsent()?.analytics) return;
  try {
    window.gtag('event', name, params);
  } catch { /* noop */ }
}

/** centesimi → euro con 2 decimali (per il campo `value` di GA4). */
const eur = (cents: number) => Number((cents / 100).toFixed(2));

// Auth funnel
/**
 * #214 — Due cose, in una firma sola.
 *
 * ① `$insert_id` rende l'evento idempotente: chi si registrava con email
 *    veniva contato due volte, una alla compilazione del modulo e una al
 *    ritorno dal link di conferma. Con la stessa chiave PostHog ne conta uno.
 * ② `metodo` dice da quale porta e' entrata la persona (email, Google...).
 *    Prima non si vedeva, quindi non si poteva sapere quale porta funziona.
 */
export const trackSignupCompleted = (
  userId: string,
  role: 'buyer' | 'seller' | 'rider' | 'admin',
  metodo?: string,
) =>
  track('signup_completed', { user_id: userId, role, metodo: metodo ?? 'sconosciuto', $insert_id: `signup:${userId}` });

export const trackSignedIn = (userId: string, metodo?: string) =>
  track('signed_in', { user_id: userId, metodo: metodo ?? 'sconosciuto' });

export const trackSignedOut = () =>
  track('signed_out');

// Discovery funnel
export const trackProductViewed = (productId: string, props?: { price?: number; category?: string; seller_id?: string }) => {
  track('product_viewed', { product_id: productId, ...props });
  ga('view_item', {
    currency: 'EUR',
    value: props?.price,
    items: [{ item_id: productId, item_category: props?.category, item_brand: props?.seller_id }],
  });
};

export const trackStoreViewed = (sellerId: string) =>
  track('store_viewed', { seller_id: sellerId });

export const trackSearchPerformed = (query: string, resultCount: number) => {
  track('search_performed', { query, result_count: resultCount });
  ga('search', { search_term: query, result_count: resultCount });
};

export const trackCategoryViewed = (slug: string) =>
  track('category_viewed', { category_slug: slug });

// Cart + checkout funnel
export const trackAddToCart = (
  productId: string,
  quantity: number,
  priceCents: number,
  meta?: { name?: string; storeName?: string },
) => {
  track('add_to_cart', { product_id: productId, quantity, price_cents: priceCents });
  ga('add_to_cart', {
    currency: 'EUR',
    value: eur(priceCents * quantity),
    items: [{ item_id: productId, item_name: meta?.name, price: eur(priceCents), quantity, item_brand: meta?.storeName }],
  });
};

/**
 * #226 — Prima partiva senza quantita' e senza valore: su GA4 la rimozione
 * arrivava a zero euro, quindi il valore netto del carrello non tornava mai.
 * Ora porta gli stessi campi dell'aggiunta, che e' la convenzione GA4: i
 * report funzionano senza altro lavoro.
 */
export const trackRemoveFromCart = (
  productId: string,
  quantity = 1,
  priceCents = 0,
  meta?: { name?: string; storeName?: string },
) => {
  track('remove_from_cart', { product_id: productId, quantity, price_cents: priceCents });
  ga('remove_from_cart', {
    currency: 'EUR',
    value: eur(priceCents * quantity),
    items: [{ item_id: productId, item_name: meta?.name, price: eur(priceCents), quantity, item_brand: meta?.storeName }],
  });
};

export const trackCheckoutStarted = (totalCents: number, itemCount: number) => {
  track('checkout_started', { total_cents: totalCents, item_count: itemCount });
  ga('begin_checkout', { currency: 'EUR', value: eur(totalCents) });
};

/** Step intermedi del checkout (indirizzo compilato, metodo scelto). */
export const trackCheckoutStep = (
  step: 'address' | 'payment_method',
  props?: Record<string, unknown>,
) => {
  track('checkout_step', { step, ...props });
  if (step === 'address') ga('add_shipping_info', { currency: 'EUR', ...props });
  if (step === 'payment_method') ga('add_payment_info', { currency: 'EUR', ...props });
};

export const trackCouponApplied = (code: string, discountCents: number) =>
  track('coupon_applied', { code, discount_cents: discountCents });

export type GaItem = { id: string; name?: string; priceCents?: number; quantity?: number; storeName?: string };

export const trackOrderPlaced = (
  orderId: string,
  totalCents: number,
  paymentMethod: string,
  sellerId: string,
  extra?: { coupon?: string; items?: GaItem[]; checkoutId?: string | null },
) => {
  // #213 — `checkout_id` tiene insieme gli ordini nati dallo stesso carrello:
  // due negozi fanno due ordini e due eventi, ma restano un acquisto solo.
  // `$insert_id` rende l'evento idempotente: se parte due volte (un rientro
  // sulla pagina, un tentativo ripetuto) PostHog ne conta comunque uno.
  track('order_placed', {
    order_id: orderId,
    total_cents: totalCents,
    payment_method: paymentMethod,
    seller_id: sellerId,
    checkout_id: extra?.checkoutId ?? orderId,
    $insert_id: `order_placed:${orderId}`,
  });
  // Fix #16: items inclusi nel purchase per abilitare i report prodotto GA4.
  ga('purchase', {
    transaction_id: orderId,
    currency: 'EUR',
    value: eur(totalCents),
    payment_type: paymentMethod,
    coupon: extra?.coupon,
    items: extra?.items?.map(it => ({
      item_id: it.id,
      item_name: it.name,
      price: it.priceCents ? eur(it.priceCents) : undefined,
      quantity: it.quantity,
      item_brand: it.storeName,
    })),
  });
};

export const trackOrderCanceled = (orderId: string, reason?: string) =>
  track('order_canceled', { order_id: orderId, reason });

// Home page: misura quale CTA/sezione della home porta avanti il funnel.
export const trackHomeCtaClicked = (
  ctaId: string,
  props?: { location?: string; href?: string; variant?: string },
) => track('home_cta_clicked', { cta_id: ctaId, ...props });

// A/B testing: esposizione a una variante (la conversione si lega via gli
// eventi di funnel già esistenti + le property `home_hero_variant` su PostHog).
export const trackExperimentExposed = (experiment: string, variant: string) =>
  track('experiment_exposed', { experiment, variant, [`${experiment}_variant`]: variant });

// Engagement
export const trackFavoriteAdded = (productId: string) =>
  track('favorite_added', { product_id: productId });

export const trackReviewSubmitted = (productId: string, rating: number, hasPhoto: boolean) =>
  track('review_submitted', { product_id: productId, rating, has_photo: hasPhoto });

export const trackReferralSent = (channel: 'whatsapp' | 'email' | 'copy_link') =>
  track('referral_sent', { channel });

export const trackShareCart = (channel: 'whatsapp' | 'email' | 'copy_link') =>
  track('cart_shared', { channel });

// Seller funnel
export const trackSellerOnboardingStarted = () =>
  track('seller_onboarding_started');

export const trackSellerOnboardingCompleted = () =>
  track('seller_onboarding_completed');

export const trackProductPublished = (productId: string, sellerId: string) =>
  track('product_published', { product_id: productId, seller_id: sellerId });

export const trackSellerOrderAccepted = (orderId: string) =>
  track('seller_order_accepted', { order_id: orderId });

// Rider funnel
export const trackRiderOrderAccepted = (orderId: string) =>
  track('rider_order_accepted', { order_id: orderId });

export const trackRiderDeliveryCompleted = (orderId: string, durationMinutes: number) =>
  track('rider_delivery_completed', { order_id: orderId, duration_minutes: durationMinutes });

// Errors (user-visible)
/**
 * #216 — Il messaggio grezzo del database non deve uscire da qui.
 *
 * Un errore di chiave duplicata di Postgres suona cosi': «duplicate key value
 * violates unique constraint "profiles_email_key" Key (email)=(mario@rossi.it)
 * already exists». Finiva dentro PostHog tale e quale, cioe' l'indirizzo di una
 * persona in un sistema di analisi che di norma sta negli Stati Uniti e non e'
 * dichiarato per contenere dati personali.
 *
 * Il codice basta per raggruppare gli errori. Il messaggio integrale serve al
 * debug, ed e' il mestiere di Sentry: li' lo scrubbing e la conservazione
 * limitata ci sono gia'.
 */
export function messaggioSenzaDatiPersonali(message: string): string {
  return (message || '')
    .replace(/Key\s*\([^)]*\)\s*=\s*\([^)]*\)/gi, 'Key (…)=(…)')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{6,}\b/g, '<numero>')
    .trim()
    .slice(0, 40);
}

export const trackErrorShown = (code: string, message: string, page?: string) =>
  track('error_shown', { code, message: messaggioSenzaDatiPersonali(message), page });
