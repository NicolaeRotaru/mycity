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
import { registraAccessoNelRegistro } from './registro-accessi';

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
/**
 * 30/8/2026 (R168) — «SCONOSCIUTO» ERA IL VALORE DI RIPIEGO, E BASTAVA
 * DIMENTICARSI UN ARGOMENTO.
 *
 * `metodo` era facoltativo, con ripiego a 'sconosciuto'. Il percorso Google lo
 * passava; il modulo email e password no — `trackSignedIn(data.user.id)`, senza
 * secondo argomento. Risultato: uno dei due canali d'ingresso era etichettato
 * «sconosciuto», e il confronto fra le due porte — che è tutto lo scopo della
 * proprietà — non si poteva fare. Ce ne si accorge sei mesi dopo, guardando i
 * numeri, quando i dati sono già stati raccolti così.
 *
 * Adesso `metodo` è OBBLIGATORIO: chi lo dimentica lo scopre in compilazione,
 * non nei dati. `npm run typecheck` è il freno.
 */
/**
 * 3/9/2026 — E QUI DENTRO PASSA ANCHE IL REGISTRO DEGLI ACCESSI.
 *
 * Il registro difeso come sicurezza — quello che si guarda quando a qualcuno
 * rubano l'account — lo riempiva solo il tracker del browser, che vede la
 * sessione nascere DENTRO la pagina. Con Google la sessione la crea il server,
 * la pagina riparte con la persona già dentro, e la riga non si scriveva mai.
 *
 * «Questa persona è appena entrata» è un fatto solo, e da qui passano tutte e
 * due le strade: il modulo email e password e il ritorno da `/auth/callback`.
 * Quindi è qui che il fatto si racconta a tutti quelli che devono saperlo —
 * PostHog per il funnel, e il nostro registro per la sicurezza.
 * Vedi lib/analytics/registro-accessi.ts.
 */
export const trackSignupCompleted = (
  userId: string,
  role: 'buyer' | 'seller' | 'rider' | 'admin',
  metodo: string,
) => {
  registraAccessoNelRegistro(metodo);
  return track('signup_completed', { user_id: userId, role, metodo, $insert_id: `signup:${userId}` });
};

export const trackSignedIn = (userId: string, metodo: string) => {
  registraAccessoNelRegistro(metodo);
  return track('signed_in', { user_id: userId, metodo });
};

export const trackSignedOut = () =>
  track('signed_out');

// Discovery funnel
/**
 * 22/8/2026 — NEL CATALOGO EVENTI I PREZZI VIAGGIAVANO META' IN EURO E META'
 * IN CENTESIMI.
 *
 * «Prodotto visto» mandava `price`, un numero in euro con la virgola. Gli altri
 * tre eventi che portano un prezzo — carrello, cassa, ordine — mandano interi
 * in centesimi. Tre su quattro seguivano la regola.
 *
 * Il nome della proprieta' cambiava, quindi nessuno sommava mele con pere per
 * sbaglio. Ma chi scrive una domanda sui dati deve ricordarsi che per un evento
 * su quattro l'unita' e' diversa, e prima o poi non se lo ricorda.
 *
 * Adesso anche questo manda centesimi. In euro resta solo il numero che va a
 * Google Analytics, che li vuole cosi'.
 */
export const trackProductViewed = (
  productId: string,
  props?: { priceCents?: number; category?: string; seller_id?: string },
) => {
  track('product_viewed', {
    product_id: productId,
    price_cents: props?.priceCents,
    category: props?.category,
    seller_id: props?.seller_id,
  });
  ga('view_item', {
    currency: 'EUR',
    value: props?.priceCents != null ? eur(props.priceCents) : undefined,
    items: [{ item_id: productId, item_category: props?.category, item_brand: props?.seller_id }],
  });
};

export const trackStoreViewed = (sellerId: string) =>
  track('store_viewed', { seller_id: sellerId });

/**
 * 22/8/2026 — QUELLO CHE LE PERSONE SCRIVONO NELLA RICERCA PARTIVA COSI' COM'E'.
 *
 * Nella casella di ricerca la gente non scrive solo «pane». Scrive il proprio
 * indirizzo email, il numero d'ordine, il telefono, il nome di un'altra
 * persona. Quel testo andava dritto nel sistema di analisi, che sta negli Stati
 * Uniti e non e' dichiarato per contenere dati personali.
 *
 * La pulizia esisteva gia' in questo stesso file, scritta per gli errori. Alla
 * ricerca non era mai stata applicata.
 *
 * Il numero di risultati — la parte utile, quella che dice cosa manca in
 * catalogo — non ne risente: passa intero.
 */
export const trackSearchPerformed = (query: string, resultCount: number) => {
  const pulita = messaggioSenzaDatiPersonali(query);
  track('search_performed', { query: pulita, result_count: resultCount });
  ga('search', { search_term: pulita, result_count: resultCount });
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

/**
 * 30/8/2026 (R163) — L'AVVIO DEL CHECKOUT PORTA LA SUA CHIAVE.
 *
 * Partiva senza nessun identificativo, mentre `order_placed` porta
 * `checkout_id` ed esce una volta per ORDINE (un carrello da due negozi fa due
 * ordini). Un avvio, due acquisti, niente in comune: la conversione «arriva
 * alla cassa → paga» poteva superare il 100% e non si poteva ricucire.
 *
 * La chiave nasce in `lib/analytics/chiave-checkout.ts` quando si entra in
 * cassa, e la stessa arriva al server con l'ordine.
 */
export const trackCheckoutStarted = (totalCents: number, itemCount: number, checkoutId?: string | null) => {
  track('checkout_started', {
    total_cents: totalCents,
    item_count: itemCount,
    ...(checkoutId ? { checkout_id: checkoutId } : {}),
  });
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
  const checkoutId = extra?.checkoutId ?? orderId;
  // 21/8/2026 — `order_placed` NON PARTE PIÙ DA QUI, E OGNI ACQUISTO TORNA A
  // CONTARSI UNA VOLTA SOLA.
  //
  // Da quando l'evento parte anche dal server (#208), lo stesso acquisto veniva
  // mandato due volte: una dal browser, una dal server. Il commento che stava
  // qui diceva che `$insert_id` toglieva i doppioni — non è vero fra i due:
  // PostHog li toglie a parità di istante, e browser e server mandano in due
  // momenti diversi. Fatturato e numero di acquisti risultavano DOPPI, e ogni
  // tasso di conversione e ritorno di campagna poggiava su quel numero.
  //
  // Fra i due si tiene il server, perché lì il fatto è certo: chi chiude la
  // scheda dopo aver pagato ha comunque un ordine, e il browser quel caso lo
  // perdeva. Il server rispetta anche il consenso, che è la seconda ragione.
  //
  // Resta il `purchase` di GA4 qui sotto: è un altro raccoglitore, con un altro
  // percorso, e da lì non parte niente dal server.
  void checkoutId;
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
