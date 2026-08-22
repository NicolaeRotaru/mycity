import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { createMultiSellerCheckoutSession, isStripeConfigured } from '@/lib/stripe/client';
import { ripartisciCentesimi, riduciAlTetto } from '@/lib/stripe/ripartizione';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withAuthRateLimit, assertCanPurchase } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { validateCoupon } from '@/lib/coupons';
import { PICKUP_DISCOUNT_PERCENT, PLATFORM_DELIVERY_FEE_CENTS, RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { shippingCentsFor, compensoRiderCents } from '@/lib/shipping';
import { coordinateDaIndirizziSalvati } from '@/lib/shipping-coordinate';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { isStoreClosedForOrder } from '@/lib/store-hours';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

// 009 / 190 — Queste risposte uscivano come `{ error: '…' }` grezzo, mentre
// tutto il resto del progetto risponde `{ ok:false, error:{ code, message } }`
// — la forma che il codice del browser si aspetta e che il file delle
// risposte dichiara «mai inconsistente». Sulle due rotte dei soldi il
// cliente vedeva «Qualcosa non ha funzionato» al posto di «il negozio e'
// chiuso»: il messaggio giusto c'era, e si perdeva nella forma sbagliata.

export const runtime = 'nodejs';

const ItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
  variantId: z.string().uuid().nullable().optional(),
});

const GroupSchema = z.object({
  sellerId: z.string().uuid(),
  items: z.array(ItemSchema).min(1).max(50),
  shippingCents: z.number().int().nonnegative().default(0),
});

const DeliverySchema = z.object({
  fullName: z.string().min(1).max(200),
  address: z.string().min(1).max(300),
  city: z.string().min(1).max(120),
  zip: z.string().min(1).max(20),
  phone: z.string().min(1).max(40),
  notes: z.string().max(500).optional().nullable(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
}).refine((d) => !(d.lat === 0 && d.lng === 0), { message: 'Coordinate di consegna non valide' });

const Body = z.object({
  groups: z.array(GroupSchema).min(1).max(10),
  delivery: DeliverySchema,
  couponCode: z.string().max(40).optional().nullable(),
  /**
   * NOTA SICUREZZA: questi importi sono accettati per retro-compatibilità del
   * client ma IGNORATI lato server. Spedizione, sconto ritiro e sconto coupon
   * sono ricalcolati dalla fonte autorevole (DB) più sotto. Non fidarsi mai di
   * valori monetari provenienti dal client.
   */
  couponDiscountCents: z.number().int().nonnegative().default(0),
  pickupDiscountCents: z.number().int().nonnegative().default(0),
  pickupInStore: z.boolean().default(false),
  // Fascia di consegna scelta (es. "Oggi · 18:00–20:00"). Etichetta informativa
  // persistita nel pending_checkout (delivery.slot) e poi su orders.delivery_slot
  // dal webhook; null per ritiro o se non scelta. Non influisce su prezzi.
  deliverySlot: z.string().max(120).optional().nullable(),
});

/**
 * Crea una Stripe Checkout Session per carrelli single-seller o multi-seller.
 *
 * Pattern (vedi lib/stripe/client.ts):
 *  1. Validiamo prodotti, prezzi e stock leggendo dal DB (mai trust client).
 *  2. Inseriamo una riga in pending_checkouts (record-of-intent).
 *  3. Creiamo la Stripe Session linkata al pending_checkout via
 *     client_reference_id + metadata.pending_checkout_id.
 *  4. Aggiorniamo pending_checkout con stripe_session_id.
 *  5. Il webhook checkout.session.completed legge il pending_checkout
 *     e crea N ordini (uno per seller) con payout_status=HELD.
 *
 * Rate limit: 30 checkout / 10 min per utente.
 */
export const POST = withAuthRateLimit({ name: 'stripe-checkout', max: 30, windowMs: 10 * 60_000 }, async ({ user, profile, req }): Promise<NextResponse> => {
  const purchaseBlock = assertCanPurchase(profile);
  if (purchaseBlock) return purchaseBlock;
  if (!isStripeConfigured()) {
    return ApiErrors.unavailable('Pagamenti elettronici non disponibili. Usa pagamento alla consegna.');
  }
  if (!user.email) return ApiErrors.unauthorized();
  if (!user.email_confirmed_at) {
    return ApiErrors.forbidden('Conferma la tua email prima di pagare.');
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await jsonRichiesta(req, TETTO_JSON));
  } catch (e) {
    return ApiErrors.invalidRequest('Dati ordine non validi', e instanceof Error ? e.message : undefined);
  }

  // Il ritiro in negozio e' messo da parte (RITIRO_IN_NEGOZIO_ATTIVO). Il
  // browser potrebbe chiederlo lo stesso — una richiesta costruita a mano,
  // o una scheda aperta da prima del rilascio. Qui si spegne, una volta
  // sola, subito dopo la convalida: cosi' ogni uso piu' sotto lo vede gia'
  // falso e non c'e' un punto che possa sfuggire.
  body.pickupInStore = RITIRO_IN_NEGOZIO_ATTIVO && body.pickupInStore;

  const supa = await getServerSupabase();
  const admin = getAdminSupabase();

  // --- 1. Carica tutti i prodotti dal DB in un'unica query.
  const allProductIds = body.groups.flatMap((g) => g.items.map((i) => i.productId));
  const uniqueProductIds = [...new Set(allProductIds)];
  const { data: products, error: prodErr } = await supa
    .from('products')
    .select('id, name, price, images, seller_id, stock, status, has_variants')
    .in('id', uniqueProductIds);

  if (prodErr || !products || products.length === 0) {
    return ApiErrors.notFound('Prodotti non trovati.');
  }
  if (products.length !== uniqueProductIds.length) {
    return ApiErrors.invalidRequest('Alcuni prodotti del carrello non sono più disponibili.');
  }

  // Sconti promo attivi (per prodotto): il cliente deve pagare il prezzo scontato
  // mostrato dal badge "In promo -X%", non il prezzo pieno. Fonte autorevole DB.
  const discountMap = await fetchActiveDiscounts(supa, allProductIds);

  // Varianti richieste: stock/label/owner per la validazione e lo snapshot.
  const allVariantIds = body.groups.flatMap((g) =>
    g.items.map((i) => i.variantId).filter(Boolean) as string[],
  );
  const variantMap = new Map<string, { id: string; product_id: string; label: string; stock: number }>();
  if (allVariantIds.length > 0) {
    const { data: vrows } = await supa
      .from('product_variants')
      .select('id, product_id, label, stock')
      .in('id', allVariantIds);
    for (const v of vrows ?? []) {
      variantMap.set(v.id as string, {
        id: v.id as string,
        product_id: v.product_id as string,
        label: (v.label as string) ?? '',
        stock: (v.stock as number) ?? 0,
      });
    }
  }

  // --- 2. Carica i seller (per storeName nei line_items Stripe).
  const sellerIds = Array.from(new Set(body.groups.map((g) => g.sellerId)));
  // #16 — Si legge dalla VETRINA PUBBLICA, non dalla tabella dei profili.
  //
  // Da quando la 110 ha tolto la regola «chiunque puo' vedere i negozi
  // approvati», questa lettura fatta con la sessione del cliente tornava
  // VUOTA — senza errore, semplicemente zero righe. Due conseguenze silenziose:
  // il controllo «il negozio e' chiuso adesso» non scattava mai (si poteva
  // ordinare alle tre di notte, e il fattorino andava a vuoto), e le coordinate
  // del negozio mancavano, quindi la consegna veniva prezzata sempre a tariffa
  // fissa invece che sulla distanza. `seller_public_profiles` espone
  // esattamente queste colonne, ed e' leggibile da chi ha un account.
  const { data: sellers } = await supa
    .from('seller_public_profiles')
    .select('id, store_name, store_lat, store_lng, store_hours')
    .in('id', sellerIds);

  const sellerNameMap = new Map<string, string>();
  const sellerCoordMap = new Map<string, { lat: number | null; lng: number | null }>();
  for (const s of sellers ?? []) {
    sellerNameMap.set(s.id, s.store_name ?? 'Negozio');
    sellerCoordMap.set(s.id, { lat: s.store_lat ?? null, lng: s.store_lng ?? null });
  }

  // Negozio chiuso: niente consegna a domicilio adesso, il fattorino andrebbe a
  // vuoto. Il percorso in contanti questo controllo lo faceva già; quello con la
  // carta no, quindi alle tre di notte si poteva pagare un ordine che nessuno
  // avrebbe preparato. Il ritiro in negozio è esente: il cliente passa quando è
  // aperto.
  if (!body.pickupInStore) {
    for (const s of sellers ?? []) {
      if (isStoreClosedForOrder((s as { store_hours?: unknown }).store_hours)) {
        return ApiErrors.conflict(`${s.store_name ?? 'Il negozio'} è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.`);
      }
    }
  }

  // --- 3. Validazioni per ogni gruppo + costruzione line items per Stripe.
  type StripeItem = {
    productId: string;
    name: string;
    quantity: number;
    unitAmountCents: number;
    imageUrl?: string;
    variantId?: string | null;
    variantLabel?: string | null;
  };
  const stripeGroups: Array<{ sellerId: string; storeName: string; items: Array<StripeItem> }> = [];
  const subtotalPerGroupCents: number[] = [];

  for (const g of body.groups) {
    const stripeItems: Array<StripeItem> = [];
    let groupSubtotalCents = 0;

    for (const it of g.items) {
      const p = products.find((x) => x.id === it.productId);
      if (!p) {
        return ApiErrors.notFound(`Prodotto ${it.productId} non trovato`);
      }
      if (p.seller_id !== g.sellerId) {
        return ApiErrors.invalidRequest(`Prodotto ${p.name} non appartiene al venditore indicato.`);
      }
      // Nota: l'approvazione del venditore è già garantita dall'RLS
      // (migration 023: solo prodotti `available` di venditori approvati sono
      // leggibili) — un prodotto non leggibile cade sul `if (!p)` qui sopra.
      // `products` NON ha una colonna is_approved: si controlla solo lo status.
      if (p.status !== 'available') {
        return ApiErrors.invalidRequest(`Prodotto ${p.name} non disponibile.`);
      }

      const hasVariants = Boolean((p as { has_variants?: boolean }).has_variants);
      let variantId: string | null = null;
      let variantLabel: string | null = null;
      if (hasVariants) {
        if (!it.variantId) {
          return ApiErrors.invalidRequest(`Scegli un'opzione (es. taglia/colore) per ${p.name}.`);
        }
        const v = variantMap.get(it.variantId);
        if (!v || v.product_id !== p.id) {
          return ApiErrors.invalidRequest(`Variante non valida per ${p.name}.`);
        }
        if (v.stock < it.quantity) {
          return ApiErrors.conflict(`Disponibilità insufficiente per ${p.name} (${v.label}): ${v.stock} disponibili.`);
        }
        variantId = v.id;
        variantLabel = v.label;
      } else if (typeof p.stock === 'number' && p.stock < it.quantity) {
        return ApiErrors.conflict(`Stock insufficiente per ${p.name} (${p.stock} disponibili).`);
      }

      const unitCents = discountedUnitCents(p.price, discountMap.get(p.id) ?? 0);
      const cover = Array.isArray(p.images) ? p.images[0] : null;
      stripeItems.push({
        productId: p.id,
        name: variantLabel ? `${p.name} (${variantLabel})` : p.name,
        quantity: it.quantity,
        unitAmountCents: unitCents,
        imageUrl: typeof cover === 'string' ? cover : undefined,
        variantId,
        variantLabel,
      });
      groupSubtotalCents += unitCents * it.quantity;
    }

    stripeGroups.push({
      sellerId: g.sellerId,
      storeName: sellerNameMap.get(g.sellerId) ?? 'Negozio',
      items: stripeItems,
    });
    subtotalPerGroupCents.push(groupSubtotalCents);
  }

  // --- 4. RICALCOLO SERVER-SIDE di spedizione, sconto ritiro e coupon.
  // SICUREZZA (H1): i prezzi unitari sono già stati ricalcolati dal DB (step 3).
  // Qui ricalcoliamo dalla fonte autorevole anche spedizione, sconto ritiro e
  // sconto coupon, IGNORANDO body.couponDiscountCents / pickupDiscountCents /
  // groups[].shippingCents. Senza questo, un client poteva inviare uno sconto
  // pari al totale e pagare ~€0,01 qualunque ordine.
  const grandSubtotalCents = subtotalPerGroupCents.reduce((s, x) => s + x, 0);
  if (grandSubtotalCents <= 0) {
    return ApiErrors.invalidRequest('Importo non valido.');
  }

  // 4a. Coupon: ri-validato e ri-calcolato dal coupon reale (mai dal client).
  let couponDiscountCents = 0;
  let couponFreeShipping = false;
  let validatedCouponCode: string | null = null;
  if (body.couponCode && body.couponCode.trim()) {
    const couponRes = await validateCoupon(body.couponCode, grandSubtotalCents / 100, user.id, supa);
    if (!couponRes.ok) {
      return ApiErrors.invalidRequest(`Coupon non valido: ${couponRes.reason}`);
    }
    couponDiscountCents = Math.max(0, Math.round(couponRes.discount * 100));
    couponFreeShipping = couponRes.freeShipping;
    validatedCouponCode = couponRes.coupon.code;
    // Claim atomico prima di procedere con Stripe (fix #36 — race condition coupon).
    const { data: claimed, error: claimErr } = await admin.rpc('claim_coupon', { p_code: validatedCouponCode });
    if (claimErr || !claimed) {
      return ApiErrors.invalidRequest('Coupon non disponibile: potrebbe essere esaurito nel frattempo.');
    }
  }

  // 4b. Spedizione per gruppo: ricalcolata server-side con la STESSA logica
  // distanza-based della UI (lib/shipping.ts), usando le coordinate negozio dal
  // DB e quelle di consegna inviate dal client. Coupon FREE_SHIPPING o soglia
  // raggiunta ⇒ 0. Si ignora qualunque importo di spedizione dal client.
  // Coordinate della consegna prese dal database, non dal browser: il prezzo
  // della consegna dipende dalla distanza, e finora quel numero lo scriveva il
  // client. Se l'indirizzo non è fra quelli salvati dalla persona, si resta
  // senza coordinate e vale la tariffa fissa.
  const coordConsegna = await coordinateDaIndirizziSalvati(admin, user.id, {
    address: body.delivery.address,
    city: body.delivery.city,
    zip: body.delivery.zip,
  });

  const coordPerLaMappa =
    coordConsegna ?? (await coordinateDiUnIndirizzo({
      address: body.delivery.address,
      city: body.delivery.city,
      zip: body.delivery.zip,
    }));

  /**
   * 22/8/2026 — IL CONTO LO FA UNA FUNZIONE SOLA, LA STESSA DEI CONTANTI.
   *
   * Queste duecento righe di aritmetica esistevano anche nell'altra rotta,
   * uguali. Ogni riparazione andava fatta due volte, e almeno tre volte e'
   * stata fatta una volta sola: il cliente pagava un importo diverso a seconda
   * di come sceglieva di pagare.
   */
  const prezzi = prezziDelCarrello({
    gruppi: stripeGroups.map((g, i) => ({
      sellerId: g.sellerId,
      subtotalCents: subtotalPerGroupCents[i],
    })),
    coordinateNegozio: (sellerId) => sellerCoordMap.get(sellerId) ?? { lat: null, lng: null },
    consegnaLat: coordConsegna?.lat ?? null,
    consegnaLng: coordConsegna?.lng ?? null,
    pickupInStore: body.pickupInStore,
    couponSpedizioneGratis: couponFreeShipping,
    couponScontoCents: couponDiscountCents,
  });
  const shippingPerGroupCents = prezzi.gruppi.map((g) => g.shippingCents);
  const grandShippingCents = prezzi.grandShippingCents;

  // 4c. Sconto ritiro in negozio: PICKUP_DISCOUNT_PERCENT sul subtotale carrello.
  const pickupDiscountCents = prezzi.pickupDiscountCents;

  // 4c-bis. Fee di consegna piattaforma: PLATFORM_DELIVERY_FEE_CENTS per ogni
  // gruppo (= una consegna fisica per venditore). Zero per il ritiro in negozio.
  // La incassa MyCity: viene scalata dal payout del venditore nel webhook.
  const deliveryFeePerGroupCents = prezzi.gruppi.map((g) => g.deliveryFeeCents);

  // Clamp difensivo finale: lo sconto totale non può superare (subtotale+spedizione-1c).
  const totalDiscountCents = prezzi.scontoApplicatoCents;

  // Le quote per negozio si calcolano dallo sconto GIÀ limitato, non da quello
  // richiesto: è lo sconto limitato che finisce sulla carta del cliente. E si
  // ripartiscono col metodo del resto più grande, così la somma delle quote
  // torna al centesimo con l'importo addebitato. Prima si usavano i valori non
  // limitati, arrotondati uno per uno: i totali per negozio e l'addebito
  // divergevano.
  const quoteCoupon = prezzi.gruppi.map((g) => g.couponPortionCents);
  const quoteRitiro = prezzi.gruppi.map((g) => g.pickupPortionCents);

  const groupPersisted = stripeGroups.map((g, i) => {
    const subtotal = subtotalPerGroupCents[i];
    const shipping = shippingPerGroupCents[i];
    const deliveryFeeCents = deliveryFeePerGroupCents[i];
    const couponPortionCents = quoteCoupon[i];
    const pickupPortionCents = quoteRitiro[i];
    const totalCents = prezzi.gruppi[i].totalCents;
    const coord = sellerCoordMap.get(g.sellerId) ?? { lat: null, lng: null };
    return {
      sellerId: g.sellerId,
      storeName: g.storeName,
      items: g.items,
      subtotalCents: subtotal,
      shippingCents: shipping,
      deliveryFeeCents,
      couponPortionCents,
      pickupPortionCents,
      totalCents,
      // Il compenso del fattorino viaggia col gruppo fino alla creazione
      // dell'ordine. E' una cifra fissa: non dipende ne' dalla distanza ne' da
      // quanto paga il cliente.
      riderFeeCents: compensoRiderCents({ pickupInStore: body.pickupInStore }),
    };
  });

  // L'importo che Stripe addebiterà = somma totalCents pro-rata.
  // Ricostruito per fugare drift da arrotondamento pro-rata.
  const expectedChargeCents = groupPersisted.reduce((s, g) => s + g.totalCents, 0);

  // --- 4d. RISERVA ATOMICA DELLO STOCK (P0-4 anti-overselling).
  // Decrementiamo PRIMA di prendere i soldi: se l'ultimo pezzo è già stato riservato
  // da un altro buyer, qui falliamo con 409 e il cliente non paga merce inesistente.
  // Lo stock viene ripristinato su scadenza checkout / sessione fallita / annullo / rimborso.
  const stockItems = stripeGroups.flatMap((g) =>
    g.items.map((it) => ({ product_id: it.productId, variant_id: it.variantId ?? null, qty: it.quantity })),
  );
  /**
   * #171 — Il codice sconto si restituisce a OGNI uscita, non solo all'ultima.
   *
   * Il claim avviene prima di parlare con Stripe. Da li' in poi ci sono cinque
   * modi di uscire senza ordine: merce finita, riga di intento non scritta,
   * Stripe che rifiuta... e su quattro di questi il codice restava «usato».
   * Per un codice a uso unico vuol dire perso per sempre: il cliente lo ha in
   * mano, il sistema lo dichiara consumato, e nessuno ha comprato niente.
   */
  const rilasciaCoupon = async () => {
    if (!validatedCouponCode) return;
    const { error: relErr } = await admin.rpc('release_coupon', { p_code: validatedCouponCode });
    if (relErr) logger.warn('[stripe] codice sconto non restituito', { code: validatedCouponCode, message: relErr.message });
  };

  const { error: reserveErr } = await admin.rpc('reserve_stock', { p_items: stockItems });
  if (reserveErr) {
    logger.warn('[stripe] reserve_stock fallita', { message: reserveErr.message });
    await rilasciaCoupon();
    return ApiErrors.conflict('Alcuni articoli non sono più disponibili nelle quantità richieste.');
  }

  // --- 5. Inserisci pending_checkout (record-of-intent) PRIMA della session Stripe.
  const { data: pending, error: pendErr } = await admin
    .from('pending_checkouts')
    .insert({
      buyer_id: user.id,
      total_cents: expectedChargeCents,
      currency: 'eur',
      groups: groupPersisted,
      coupon_code: validatedCouponCode,
      delivery: {
        full_name: body.delivery.fullName,
        address: body.delivery.address,
        city: body.delivery.city,
        zip: body.delivery.zip,
        phone: body.delivery.phone,
        notes: body.delivery.notes ?? null,
        // #162 — Mai le coordinate mandate dal browser come ripiego. Erano
        // quelle di un indirizzo salvato, che pero' la persona puo' aver
        // corretto a mano un attimo prima: il testo dice una via e il punto
        // sulla mappa ne indica un'altra, e il fattorino va dove dice il
        // punto. Meglio nessuna coordinata — si geocodifica dopo — che una
        // coordinata che contraddice l'indirizzo scritto.
        //
        // 22/8/2026 — «SI GEOCODIFICA DOPO» NON SUCCEDEVA. Quel «dopo» non
        // esisteva da nessuna parte: l'ordine con carta nasceva senza
        // destinazione esattamente come quello in contanti, e la mappa della
        // consegna restava vuota. Adesso, quando l'indirizzo non e' fra quelli
        // salvati, la destinazione se la calcola il server. NON entra nel
        // prezzo: quello e' gia' stato deciso qui sopra, sulle coordinate
        // salvate o sulla tariffa fissa.
        lat: coordPerLaMappa?.lat ?? null,
        lng: coordPerLaMappa?.lng ?? null,
        // Fascia di consegna scelta dal buyer: il webhook la legge da qui e la
        // scrive su orders.delivery_slot. null per ritiro / non scelta.
        slot: body.pickupInStore ? null : (body.deliverySlot ?? null),
      },
      pickup_in_store: body.pickupInStore,
      status: 'PENDING',
    })
    .select('id, expires_at')
    .single();

  if (pendErr || !pending) {
    logger.error('[stripe] pending_checkout insert failed', pendErr);
    await admin.rpc('restore_stock', { p_items: stockItems }); // rilascia la riserva
    await rilasciaCoupon(); // #171 — e anche il codice sconto
    return ApiErrors.internal('Errore nella preparazione del pagamento.');
  }

  // --- 6. Crea la Stripe Checkout Session.
  const successUrl = `${env.appUrl()}/orders?stripe=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${env.appUrl()}/cart?stripe=canceled`;

  try {
    const session = await createMultiSellerCheckoutSession({
      pendingCheckoutId: pending.id,
      groups: stripeGroups,
      shippingPerGroupCents,
      deliveryFeePerGroupCents,
      totalDiscountCents,
      buyerEmail: user.email,
      buyerUserId: user.id,
      successUrl,
      cancelUrl,
      // La sessione scade con la riserva della merce, non 24 ore dopo.
      pendingExpiresAt: pending.expires_at ? new Date(pending.expires_at).getTime() : undefined,
    });

    // Salva l'id session su pending_checkout per lookup nel webhook
    await admin
      .from('pending_checkouts')
      .update({ stripe_session_id: session.id })
      .eq('id', pending.id);

    // 22/8/2026 — al contratto del progetto, `{ ok: true, data: { … } }`. Qui
    // rispondeva un oggetto nudo, come la rotta dei contanti prima di ieri.
    return apiSuccess({ id: session.id, url: session.url });
  } catch (e) {
    logger.error('[stripe] checkout creation failed', e);
    // Rilascia la riserva di stock e marca il pending come CANCELED (no orphan).
    await admin.rpc('restore_stock', { p_items: stockItems });
    // Il codice sconto era già stato «consumato» prima di creare la sessione:
    // se il pagamento non nasce va restituito, altrimenti quell'uso è perso per
    // sempre.
    await rilasciaCoupon();
    await admin
      .from('pending_checkouts')
      .update({ status: 'CANCELED' })
      .eq('id', pending.id);
    return ApiErrors.internal('Errore nella creazione del pagamento.');
  }
});
