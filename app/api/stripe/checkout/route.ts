import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { createMultiSellerCheckoutSession, getStripe, isStripeConfigured } from '@/lib/stripe/client';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { clientIdGaDalCookie } from '@/lib/analytics/ga-client-id';
import { withAuthRateLimit, assertCanPurchase } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { validateCoupon } from '@/lib/coupons';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { coordinateDaIndirizziSalvati } from '@/lib/shipping-coordinate';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { isStoreClosedForOrder } from '@/lib/store-hours';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { collegaConsensiAnonimi, identificativiAnonimi } from '@/lib/analytics/riconcilia-consenso';
import { variantiDaiCookie } from '@/lib/analytics/varianti-dai-cookie';
import { chiaveCheckoutValida } from '@/lib/analytics/chiave-checkout';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';

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
  /**
   * 30/8/2026 (R163) — La chiave del checkout nata nel browser all'ingresso in
   * cassa. Serve solo ai conti: viaggia dentro la riga di intento fino al
   * webhook, che e' il posto dove nasce `order_placed` per la carta.
   */
  checkoutId: z.string().max(80).optional().nullable(),
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
  const variantiDelBrowser = variantiDaiCookie(req.headers.get('cookie'));
  // R163 — ripulita: e' un dato che arriva da fuori e finisce come etichetta
  // in un evento dei conti.
  const chiaveDeiConti = chiaveCheckoutValida(body.checkoutId);

  /**
   * 27/8/2026 (R085) — QUATTRO VIAGGI IN FILA DOVE NE BASTA UNO SOLO.
   *
   * Prodotti, sconti attivi, varianti e negozi si leggevano uno dopo l'altro,
   * ognuno aspettando il precedente. Ma gli identificativi delle ultime tre
   * letture arrivano tutti dal corpo della richiesta, non dal risultato della
   * prima: non c'era niente da aspettare. Erano due-tre giri di rete regalati
   * nel momento esatto in cui la persona ha la carta in mano e guarda la
   * rotellina — e sul checkout ogni frazione di secondo si legge nel tasso di
   * abbandono.
   *
   * Partono insieme. L'ORDINE DEI CONTROLLI sotto resta identico: prima i
   * prodotti, poi le varianti, poi il negozio chiuso.
   */
  const allProductIds = body.groups.flatMap((g) => g.items.map((i) => i.productId));
  const uniqueProductIds = [...new Set(allProductIds)];
  const allVariantIds = body.groups.flatMap((g) =>
    g.items.map((i) => i.variantId).filter(Boolean) as string[],
  );
  const sellerIds = Array.from(new Set(body.groups.map((g) => g.sellerId)));

  type RigaVariante = { id: string; product_id: string; label: string; stock: number };

  /**
   * 27/8/2026 (R049 / R125 / R136) — DUE INVII, DUE RISERVE, DUE CODICI BRUCIATI.
   *
   * Il percorso dei contanti ha una chiave per tentativo e la rivendica prima
   * di toccare qualunque cosa. Questo no: ogni chiamata consumava di nuovo il
   * codice sconto (`claim_coupon`), riservava di nuovo la merce
   * (`reserve_stock`) e apriva una seconda sessione di pagamento. Chi torna
   * indietro dalla pagina di Stripe e riprova si sentiva dire «Coupon non
   * disponibile: potrebbe essere esaurito nel frattempo» — il suo, consumato
   * dal suo tentativo di un minuto prima — e nel frattempo la stessa merce
   * risultava impegnata due volte per DUE ORE (`pending_checkouts.expires_at`):
   * un altro cliente legge «non disponibile» su un prodotto che c'è.
   *
   * Qui la difesa non è una chiave mandata dal browser ma L'IMPRONTA DEL
   * CARRELLO: stesso cliente, stesso carrello, tentativo ancora aperto e non
   * scaduto ⇒ si restituisce la sessione di pagamento già aperta invece di
   * farne una seconda. Copre più casi della chiave (che vive in una scheda
   * sola): il ritentativo della rete, il rinvio del modulo, la seconda scheda.
   *
   * Onesto sul limite: senza un vincolo unico sul database — cioè una
   * migrazione — due richieste DAVVERO simultanee possono passare tutte e due.
   * Quel caso lo ferma già il browser (`checkoutChiuso`, che chiude il pulsante
   * su ogni invio); questo chiude tutti gli altri, che sono quelli veri.
   */
  const improntaCarrello = createHash('sha256')
    .update(
      JSON.stringify({
        gruppi: body.groups.map((g) => ({
          negozio: g.sellerId,
          righe: g.items.map((it) => [it.productId, it.variantId ?? null, it.quantity]),
        })),
        coupon: body.couponCode?.trim().toUpperCase() ?? null,
        ritiro: body.pickupInStore,
        indirizzo: [body.delivery.address, body.delivery.city, body.delivery.zip].join('|'),
        // Anche la fascia di consegna: chi torna indietro solo per cambiarla
        // non deve ritrovarsi il pagamento di prima, con l'orario di prima.
        fascia: body.pickupInStore ? null : (body.deliverySlot ?? null),
      }),
    )
    .digest('hex');

  const [prodottiLetti, discountMap, variantiLette, venditoriLetti, tentativoGiaAperto] = await Promise.all([
    supa
      .from('products')
      .select('id, name, price, images, seller_id, stock, status, has_variants')
      .in('id', uniqueProductIds),
    // Sconti promo attivi (per prodotto): il cliente deve pagare il prezzo scontato
    // mostrato dal badge "In promo -X%", non il prezzo pieno. Fonte autorevole DB.
    fetchActiveDiscounts(supa, allProductIds),
    // Varianti richieste: stock/label/owner per la validazione e lo snapshot.
    allVariantIds.length > 0
      ? supa.from('product_variants').select('id, product_id, label, stock').in('id', allVariantIds)
      : Promise.resolve({ data: [] as RigaVariante[], error: null }),
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
    supa
      .from('seller_public_profiles')
      .select('id, store_name, store_lat, store_lng, store_hours')
      .in('id', sellerIds),
    // Lo stesso carrello di questa persona ha gia' un pagamento aperto?
    admin
      .from('pending_checkouts')
      .select('id, stripe_session_id')
      .eq('buyer_id', user.id)
      .eq('status', 'PENDING')
      .gt('expires_at', new Date().toISOString())
      .filter('delivery->>impronta_carrello', 'eq', improntaCarrello)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (tentativoGiaAperto.error) {
    // Non si ferma il pagamento per questo: si va avanti come prima, ma resta
    // scritto — senza questa lettura la difesa dal doppio invio non c'e' piu'.
    logger.warn('[stripe] tentativo gia aperto non cercato', { message: tentativoGiaAperto.error.message });
  }
  const sessioneGiaAperta = (tentativoGiaAperto.data as { id: string; stripe_session_id: string | null } | null) ?? null;
  if (sessioneGiaAperta?.stripe_session_id) {
    try {
      const sessione = await getStripe().checkout.sessions.retrieve(sessioneGiaAperta.stripe_session_id);
      if (sessione.status === 'open' && sessione.url) {
        logger.info('[stripe] stesso carrello, stessa sessione: non ne apro una seconda', {
          pendingCheckoutId: sessioneGiaAperta.id,
        });
        return apiSuccess({ id: sessione.id, url: sessione.url });
      }
    } catch (e) {
      // Se Stripe non risponde si tira dritto e se ne apre una nuova: meglio un
      // doppione che una persona che non riesce a pagare.
      logger.warn('[stripe] sessione precedente non rileggibile, ne apro una nuova', { e });
    }
  }

  const { data: products, error: prodErr } = prodottiLetti;

  if (prodErr || !products || products.length === 0) {
    return ApiErrors.notFound('Prodotti non trovati.');
  }
  if (products.length !== uniqueProductIds.length) {
    return ApiErrors.invalidRequest('Alcuni prodotti del carrello non sono più disponibili.');
  }

  const variantMap = new Map<string, RigaVariante>();
  for (const v of (variantiLette.data ?? []) as RigaVariante[]) {
    variantMap.set(v.id as string, {
      id: v.id as string,
      product_id: v.product_id as string,
      label: (v.label as string) ?? '',
      stock: (v.stock as number) ?? 0,
    });
  }

  const sellers = venditoriLetti.data;

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

  // 4c. Fee di consegna piattaforma: PLATFORM_DELIVERY_FEE_CENTS per ogni
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
      //
      // 27/8/2026 (R008) — E si legge dal conto condiviso: prima ogni rotta se
      // lo ricalcolava per conto suo, mentre il campo del conto condiviso non
      // lo leggeva nessuno.
      riderFeeCents: prezzi.gruppi[i].riderFeeCents,
      /**
       * 27/8/2026 (R165) — IL GRUPPO DELL'ESPERIMENTO, IN VIAGGIO VERSO IL
       * WEBHOOK.
       *
       * L'acquisto con carta lo conta il webhook di Stripe, che non riceve
       * cookie: la variante del test A/B — che vive in `mc_exp_<esperimento>` —
       * lì non arriva. Senza, l'unico evento che dice se una variante fa
       * vendere di più non porta il gruppo, e il test non si analizza.
       *
       * Onesto su dov'è: la casa giusta sarebbe una colonna di
       * `pending_checkouts`, cioè una migrazione. Questa riga di intento è già
       * un jsonb che viaggia intatto dal checkout al webhook, e il tipo
       * `PendingGroup` lo dichiara: nessuno la trova per caso.
       */
      esperimenti: variantiDelBrowser,
      /**
       * 30/8/2026 (R163) — LA CHIAVE CHE RICUCE IL FUNNEL, IN VIAGGIO.
       *
       * `checkout_started` parte dal browser una volta per carrello;
       * `order_placed` lo scrive il webhook, una volta per ordine. Senza una
       * chiave in comune la conversione «arriva alla cassa → paga» poteva
       * superare il 100% e non era ricomponibile. Come per `esperimenti`, la
       * casa giusta sarebbe una colonna di `pending_checkouts`: questa riga di
       * intento e' gia' un jsonb che viaggia intatto fino al webhook, e il tipo
       * `PendingGroup` lo dichiara.
       */
      chiaveCheckout: chiaveDeiConti,
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
        // R049/R125/R136 — L'impronta di QUESTO carrello: è quella che, al
        // secondo invio, fa ritrovare il pagamento già aperto invece di
        // aprirne un altro e riservare la merce due volte.
        impronta_carrello: improntaCarrello,
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
      // 30/8/2026 (R166) — I cookie passano di qui, nel webhook no: l'id del
      // browser per Google viaggia con la sessione e torna indietro di la'.
      gaClientId: clientIdGaDalCookie(req.headers.get('cookie')),
    });

    // Salva l'id session su pending_checkout per lookup nel webhook
    await admin
      .from('pending_checkouts')
      .update({ stripe_session_id: session.id })
      .eq('id', pending.id);

    /**
     * 27/8/2026 (R159) — QUI PASSANO I COOKIE, NEL WEBHOOK NO.
     *
     * L'acquisto con carta lo conta il webhook di Stripe, che di cookie non ne
     * riceve: puo' solo cercare il consenso per persona. Ma chi accetta il
     * banner prima di registrarsi — il percorso normale — nel registro sta con
     * il solo identificativo del browser, e nessuno collegava i due: l'ordine
     * finiva nel database e non nei conti.
     *
     * Questa richiesta i cookie ce li ha. Si ricuce adesso, fuori dalla
     * risposta, cosi' quando il webhook arriva — secondi o minuti dopo — il
     * consenso e' gia' intestato alla persona.
     */
    dopoLaRisposta(
      () => collegaConsensiAnonimi(admin, user.id, identificativiAnonimi(req.headers.get('cookie'))),
      'consensi anonimi da collegare alla persona',
    );

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
