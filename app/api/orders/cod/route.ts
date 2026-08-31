import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';
import { withAuthRateLimit, assertCanPurchase } from '@/lib/api/middleware';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { validateCoupon } from '@/lib/coupons';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { coordinateDaIndirizziSalvati } from '@/lib/shipping-coordinate';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { isStoreClosedForOrder } from '@/lib/store-hours';
import { computeOrderSplit } from '@/lib/stripe/client';
import { fetchActiveDiscounts, discountedUnitCents } from '@/lib/promotions';
import { sendEmail } from '@/lib/email/client';
import { orderConfirmedBuyerTemplate, newOrderSellerTemplate } from '@/lib/email/templates';
import { contaAcquisto, analyticsConsentita } from '@/lib/analytics/server';
import { clientIdGaDalCookie } from '@/lib/analytics/ga-client-id';
import { marcaCarrelloRecuperato } from '@/lib/carrelli-abbandonati';
import { collegaConsensiAnonimi, identificativiAnonimi } from '@/lib/analytics/riconcilia-consenso';
import { variantiDaiCookie } from '@/lib/analytics/varianti-dai-cookie';
import { chiaveCheckoutValida } from '@/lib/analytics/chiave-checkout';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';
import { CAMPI_124, conRipiegoSchema, senzaCampi } from '@/lib/db/migrazione-124';
import { decisioneSuChiaveOccupata } from '@/lib/ordini/tentativo';
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
  pickupInStore: z.boolean().default(false),
  // Opt-in: usa il credito MyCity (gift card / punti convertiti) per scalare il
  // totale. L'importo applicato è deciso SERVER-SIDE (addebito atomico), mai dal client.
  useCredit: z.boolean().default(false),
  // Fascia di consegna scelta (es. "Oggi · 18:00–20:00"). Etichetta informativa
  // persistita su orders.delivery_slot; null per ritiro o se non scelta. Non
  // influisce su prezzi/spedizione.
  deliverySlot: z.string().max(120).optional().nullable(),
  /**
   * 30/8/2026 (R163) — La chiave del checkout nata nel browser all'ingresso in
   * cassa. Serve SOLO ai conti: e' l'etichetta che lega `checkout_started` agli
   * `order_placed` che ne sono nati. Non decide niente sui soldi e non tocca
   * l'anti-doppione, che resta l'intestazione `idempotency-key`.
   */
  checkoutId: z.string().max(80).optional().nullable(),
});

/**
 * Crea ordini COD (pagamento alla consegna) SERVER-SIDE.
 *
 * SICUREZZA (H1 / COD): in passato il client inseriva direttamente gli ordini
 * via `supabase.from('orders').insert(...)` con `total_price`, `discount_amount`
 * e `payment_status` calcolati nel browser e RLS che controllava solo
 * `auth.uid() = user_id`. Un utente poteva quindi creare ordini con prezzi/sconti
 * arbitrari. Qui ricalcoliamo TUTTO dal DB (prezzi prodotto, spedizione, sconto
 * ritiro, coupon) e inseriamo con il client admin. La policy RLS di INSERT su
 * `orders`/`order_items` per il ruolo `authenticated` viene rimossa nella
 * migration di hardening: gli ordini si creano solo via questo endpoint o via
 * webhook Stripe.
 *
 * Rate limit: 30 ordini / 10 min per utente.
 */
export const POST = withAuthRateLimit(
  { name: 'orders-cod', max: 30, windowMs: 10 * 60_000 },
  async ({ user, profile, req }): Promise<NextResponse> => {
    const purchaseBlock = assertCanPurchase(profile);
    if (purchaseBlock) return purchaseBlock;
    if (!user.email) return ApiErrors.unauthorized();
    if (!user.email_confirmed_at) {
      return ApiErrors.forbidden('Conferma la tua email prima di ordinare.');
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

    /**
     * #172 — Doppio clic, un ordine solo.
     *
     * Il percorso in contanti non aveva nessuna protezione contro il doppio
     * invio. Un secondo tocco sul pulsante — la cosa piu' naturale del mondo
     * quando per due secondi non succede niente — creava DUE ordini, riservava
     * la merce due volte e addebitava il credito MyCity due volte. Il negozio
     * preparava due spese e il fattorino ne consegnava una: la differenza la
     * rimettevamo noi.
     *
     * Il browser manda una chiave per tentativo (intestazione
     * `Idempotency-Key`). Se quella chiave e' gia' passata di qui, si
     * restituiscono gli ordini di allora invece di crearne altri.
     */
    const chiaveTentativo = (req.headers.get('idempotency-key') ?? '').trim().slice(0, 100);
    /**
     * Cosa tiene insieme gli ordini nati dallo stesso carrello, nei conti.
     * Se il browser manda la sua chiave si usa quella; altrimenti se ne fa una
     * qui — l'importante e' che sia UNA per invio, non una per ordine.
     */
    const chiaveCarrello = chiaveTentativo || `cod-${crypto.randomUUID()}`;
    if (chiaveTentativo) {
      /**
       * 21/8/2026 — LA CHIAVE SI RIVENDICA PRIMA, NON DOPO.
       *
       * Qui si LEGGEVA soltanto, e la riga veniva scritta in fondo alla rotta,
       * dopo aver creato gli ordini. Fra la lettura e la scrittura ci sono
       * centinaia di righe: due invii partiti nello stesso istante — il doppio
       * clic vero, quello che parte prima che il pulsante si spenga — leggevano
       * entrambi «nessuna chiave» e creavano entrambi gli ordini. La difesa
       * copriva il secondo clic lento, non quello veloce, che e' il caso comune.
       *
       * Adesso la chiave si prende all'inizio, con una INSERT: la chiave e'
       * chiave primaria, quindi il secondo invio prende un errore di duplicato
       * (23505) e non arriva mai a creare niente. Gli ordini veri si scrivono
       * dentro la stessa riga alla fine.
       */
      const { error: errRivendica } = await admin
        .from('cod_checkout_attempts')
        .insert({ chiave: chiaveTentativo, user_id: user.id, order_ids: [] });

      if (errRivendica) {
        if ((errRivendica as { code?: string }).code !== '23505') {
          logger.error('[cod] rivendicazione del tentativo fallita', {
            chiave: chiaveTentativo, message: errRivendica.message,
          });
          return NextResponse.json({ error: 'Impossibile registrare l ordine, riprova.' }, { status: 503 });
        }

        // Chiave gia' presa: o e' lo stesso invio ripetuto, o e' il gemello
        // partito un istante fa. In entrambi i casi qui NON si creano ordini.
        const { data: gia } = await admin
          .from('cod_checkout_attempts')
          .select('order_ids, created_at')
          .eq('chiave', chiaveTentativo)
          .eq('user_id', user.id)
          .maybeSingle();
        const ordiniGia = (gia?.order_ids as Array<{ id: string; sellerId: string; totalCents: number }> | null) ?? null;
        if (ordiniGia && ordiniGia.length > 0) {
          logger.info('[cod] tentativo ripetuto: restituisco gli ordini gia creati', { chiave: chiaveTentativo });
          return NextResponse.json(
            { orderIds: ordiniGia.map((o) => o.id), ordini: ordiniGia, ripetuto: true },
            { status: 200 },
          );
        }

        /**
         * Rivendicata ma senza ordini. Due casi diversi, e vanno distinti o la
         * cura diventa peggiore del male.
         *
         * Se la riga e' di POCHI SECONDI fa, il gemello sta ancora lavorando:
         * si dice «sto arrivando», e il doppione non nasce.
         *
         * Se invece e' VECCHIA, quell'invio e' morto per strada — la rotta e'
         * caduta, il server e' stato riavviato — e la chiave e' rimasta a
         * occupare il posto. Senza questa via d'uscita il cliente resterebbe
         * bloccato per sempre su quel carrello: ogni nuovo tentativo
         * riproverebbe la stessa chiave e prenderebbe lo stesso 409. La riga
         * abbandonata si toglie e si riprova.
         */
        const nataDa = gia?.created_at ? Date.now() - new Date(gia.created_at as string).getTime() : 0;
        const decisione = decisioneSuChiaveOccupata({ ordiniGia: null, natoDaMs: nataDa });
        if (decisione === 'chiave-abbandonata') {
          logger.warn('[cod] tentativo abbandonato: libero la chiave e riprovo', {
            chiave: chiaveTentativo, secondi: Math.round(nataDa / 1000),
          });
          await admin.from('cod_checkout_attempts').delete().eq('chiave', chiaveTentativo).eq('user_id', user.id);
          const { error: errRiprova } = await admin
            .from('cod_checkout_attempts')
            .insert({ chiave: chiaveTentativo, user_id: user.id, order_ids: [] });
          if (errRiprova) {
            return NextResponse.json({ error: 'Ordine gia in corso, attendi qualche secondo.', inCorso: true }, { status: 409 });
          }
        } else {
          logger.warn('[cod] invio gemello ancora in corso sulla stessa chiave', { chiave: chiaveTentativo });
          return NextResponse.json(
            { error: 'Ordine gia in corso, attendi qualche secondo.', inCorso: true },
            { status: 409 },
          );
        }
      }
    }

    // Gli ordini nati da questo invio. Sta qui in cima, e non piu' avanti,
    // perche' `esciERilascia` deve poter dire «non e' nato niente».
    const createdOrderIds: string[] = [];

    /**
     * 27/8/2026 (R133) — LA CHIAVE SI LIBERA SE L'ORDINE NON NASCE.
     *
     * La chiave si rivendica come prima cosa, ed e' giusto: e' quello che ferma
     * il doppio clic vero. Ma nessuna delle uscite di errore la restituiva, e il
     * browser la butta solo quando l'ordine riesce. Bastava un «negozio chiuso»
     * o un «articolo esaurito» — errori normalissimi, di cui la persona non ha
     * colpa — e il tentativo successivo si sentiva rispondere «Ordine gia in
     * corso, attendi qualche secondo»: una frase falsa, davanti a chi sta
     * comprando, che nessuna attesa sbloccava prima di un minuto pieno.
     *
     * Ogni uscita che non lascia in piedi nemmeno un ordine passa di qui.
     */
    const esciERilascia = async (risposta: NextResponse): Promise<NextResponse> => {
      if (chiaveTentativo && createdOrderIds.length === 0) {
        const { error: errLibera } = await admin
          .from('cod_checkout_attempts')
          .delete()
          .eq('chiave', chiaveTentativo)
          .eq('user_id', user.id);
        if (errLibera) {
          logger.warn('[cod] chiave del tentativo non liberata dopo un errore', {
            chiave: chiaveTentativo, message: errLibera.message,
          });
        }
      }
      return risposta;
    };

    /**
     * 27/8/2026 (R085) — QUATTRO VIAGGI IN FILA DOVE NE BASTA UNO SOLO.
     *
     * Prodotti, sconti attivi, varianti e negozi si leggevano uno dopo l'altro.
     * Ma gli identificativi delle ultime tre arrivano dal corpo della
     * richiesta, non dal risultato della prima: non c'era niente da aspettare.
     * Due-tre giri di rete regalati mentre la persona guarda la rotellina.
     *
     * Partono insieme. L'ORDINE DEI CONTROLLI sotto resta identico.
     */
    const allProductIds = body.groups.flatMap((g) => g.items.map((i) => i.productId));
    const uniqueProductIds = [...new Set(allProductIds)];
    const allVariantIds = body.groups.flatMap((g) =>
      g.items.map((i) => i.variantId).filter(Boolean) as string[],
    );
    const sellerIds = Array.from(new Set(body.groups.map((g) => g.sellerId)));

    type RigaVariante = { id: string; product_id: string; label: string; stock: number };

    const [prodottiLetti, discountMap, variantiLette, venditoriLetti] = await Promise.all([
      supa
        .from('products')
        .select('id, name, price, seller_id, stock, status, has_variants')
        .in('id', uniqueProductIds),
      // Sconti promo attivi (per prodotto): il cliente paga il prezzo scontato che
      // vede, non il prezzo pieno. Stessa fonte del badge "In promo -X%".
      fetchActiveDiscounts(supa, allProductIds),
      // Le varianti richieste (stock/label/owner) per validarle.
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
    ]);

    const { data: products, error: prodErr } = prodottiLetti;

    if (prodErr || !products || products.length === 0) {
      return esciERilascia(ApiErrors.notFound('Prodotti non trovati.'));
    }
    if (products.length !== uniqueProductIds.length) {
      return esciERilascia(ApiErrors.invalidRequest('Alcuni prodotti del carrello non sono più disponibili.'));
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
    const sellerCoordMap = new Map<string, { lat: number | null; lng: number | null }>();
    for (const s of sellers ?? []) {
      sellerCoordMap.set(s.id, { lat: s.store_lat ?? null, lng: s.store_lng ?? null });
    }

    // --- 2b. Orari negozio: niente consegna a domicilio verso un negozio CHIUSO
    // adesso (il rider andrebbe a vuoto — lo scenario "ordine alle 3 di notte").
    // Solo se il venditore ha orari configurati (NULL-safe). Il ritiro in negozio
    // è esente: il cliente passa durante gli orari di apertura.
    if (!body.pickupInStore) {
      for (const s of sellers ?? []) {
        if (isStoreClosedForOrder(s.store_hours)) {
          return esciERilascia(ApiErrors.conflict(`${s.store_name ?? 'Il negozio'} è chiuso in questo momento. Riprova durante gli orari di apertura indicati sulla pagina del negozio.`));
        }
      }
    }

    // --- 3. Valida ogni gruppo + calcola subtotale per gruppo dal DB.
    const subtotalPerGroupCents: number[] = [];
    type CodItem = { productId: string; quantity: number; unitCents: number; variantId: string | null; variantLabel: string | null };
    const itemsPerGroupCents: Array<Array<CodItem>> = [];

    for (const g of body.groups) {
      let groupSubtotalCents = 0;
      const items: Array<CodItem> = [];
      for (const it of g.items) {
        const p = products.find((x) => x.id === it.productId);
        if (!p) return esciERilascia(ApiErrors.notFound(`Prodotto ${it.productId} non trovato`));
        if (p.seller_id !== g.sellerId) {
          return esciERilascia(ApiErrors.invalidRequest(`Prodotto ${p.name} non appartiene al venditore indicato.`));
        }
        if (p.status !== 'available') {
          return esciERilascia(ApiErrors.invalidRequest(`Prodotto ${p.name} non disponibile.`));
        }
        // Varianti: prodotto con varianti richiede una variante valida; lo stock
        // controllato è quello della variante.
        const hasVariants = Boolean((p as { has_variants?: boolean }).has_variants);
        let variantId: string | null = null;
        let variantLabel: string | null = null;
        if (hasVariants) {
          if (!it.variantId) {
            return esciERilascia(ApiErrors.invalidRequest(`Scegli un'opzione (es. taglia/colore) per ${p.name}.`));
          }
          const v = variantMap.get(it.variantId);
          if (!v || v.product_id !== p.id) {
            return esciERilascia(ApiErrors.invalidRequest(`Variante non valida per ${p.name}.`));
          }
          if (v.stock < it.quantity) {
            return esciERilascia(ApiErrors.conflict(`Disponibilità insufficiente per ${p.name} (${v.label}): ${v.stock} disponibili.`));
          }
          variantId = v.id;
          variantLabel = v.label;
        } else if (typeof p.stock === 'number' && p.stock < it.quantity) {
          return esciERilascia(ApiErrors.conflict(`Stock insufficiente per ${p.name} (${p.stock} disponibili).`));
        }
        const unitCents = discountedUnitCents(p.price, discountMap.get(p.id) ?? 0);
        items.push({ productId: p.id, quantity: it.quantity, unitCents, variantId, variantLabel });
        groupSubtotalCents += unitCents * it.quantity;
      }
      subtotalPerGroupCents.push(groupSubtotalCents);
      itemsPerGroupCents.push(items);
    }

    const grandSubtotalCents = subtotalPerGroupCents.reduce((s, x) => s + x, 0);
    if (grandSubtotalCents <= 0) return esciERilascia(ApiErrors.invalidRequest('Importo non valido.'));

    // --- 4. Coupon / spedizione / ritiro: ricalcolati server-side.
    let couponDiscountCents = 0;
    let couponFreeShipping = false;
    let validatedCouponCode: string | null = null;
    if (body.couponCode && body.couponCode.trim()) {
      const couponRes = await validateCoupon(body.couponCode, grandSubtotalCents / 100, user.id, supa);
      if (!couponRes.ok) return esciERilascia(ApiErrors.invalidRequest(`Coupon non valido: ${couponRes.reason}`));
      couponDiscountCents = Math.max(0, Math.round(couponRes.discount * 100));
      couponFreeShipping = couponRes.freeShipping;
      validatedCouponCode = couponRes.coupon.code;
      // Claim atomico: check + increment in un'unica operazione — previene la race condition (fix #36).
      // Se due richieste parallele arrivano con lo stesso coupon, solo una ottiene il claim.
      const { data: claimed, error: claimErr } = await admin.rpc('claim_coupon', { p_code: validatedCouponCode });
      if (claimErr || !claimed) {
        return esciERilascia(ApiErrors.invalidRequest('Coupon non disponibile: potrebbe essere esaurito nel frattempo.'));
      }
    }

    // Coordinate della consegna prese dal database, non dal browser: il prezzo
    // della consegna dipende dalla distanza, e finora quel numero lo scriveva il
    // client. Se l'indirizzo non è fra quelli salvati dalla persona, si resta
    // senza coordinate e vale la tariffa fissa.
    const coordConsegna = await coordinateDaIndirizziSalvati(admin, user.id, {
      address: body.delivery.address,
      city: body.delivery.city,
      zip: body.delivery.zip,
    });

    /**
     * 22/8/2026 — L'ORDINE NASCEVA SENZA DESTINAZIONE.
     *
     * Se l'indirizzo non e' fra quelli salvati dalla persona — cioe' la prima
     * volta che qualcuno ordina, che e' il caso piu' importante — qui non
     * c'erano coordinate, e l'ordine finiva nel database con
     * `delivery_lat/lng` a vuoto. Effetto: la mappa della consegna senza
     * destinazione, nessuna stima di quanto manca, e il fattorino che va a
     * naso su un indirizzo che il sistema conosce solo come testo.
     *
     * Il browser le calcolava e le mandava, ma il server le buttava — ed era
     * giusto: il prezzo dipende dalla distanza, e un numero che arriva dal
     * browser si puo' cambiare. Adesso se le calcola lui.
     *
     * ATTENZIONE, e' il punto: queste coordinate NON entrano nel prezzo. La
     * spedizione resta calcolata come oggi, sulle coordinate degli indirizzi
     * salvati o sulla tariffa fissa. Servono a far vedere dove va la spesa.
     */
    const coordPerLaMappa =
      coordConsegna ?? (await coordinateDiUnIndirizzo({
        address: body.delivery.address,
        city: body.delivery.city,
        zip: body.delivery.zip,
      }));

    /**
     * 22/8/2026 — IL CONTO LO FA UNA FUNZIONE SOLA, LA STESSA DELLA CARTA.
     *
     * Qui sotto c'erano duecento righe di aritmetica identiche a quelle della
     * rotta con carta: spedizione per negozio, sconto del ritiro, fee di
     * consegna, tetto sugli sconti, ripartizione col resto piu' grande. La
     * storia scritta nei commenti dice che almeno tre volte una riparazione e'
     * stata fatta da una parte sola — e ogni volta il cliente pagava un
     * importo diverso a seconda di come sceglieva di pagare.
     */
    const prezzi = prezziDelCarrello({
      gruppi: body.groups.map((g, i) => ({
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

    // 058 / 165 — LA STESSA MATEMATICA DELLA CARTA, NON UNA SUA IMITAZIONE.
    //
    // Qui lo sconto veniva spalmato sui negozi con `Math.round(sconto * quota)`
    // fatto una volta per gruppo, e senza nessun tetto complessivo. Due guai:
    //  · gli arrotondamenti indipendenti non tornano — un buono da 10,01 € su
    //    tre negozi diventava 10,00 o 10,02, e i totali per negozio non
    //    quadravano con quello che il cliente paga in contanti al fattorino;
    //  · senza tetto, uno sconto piu' grande del carrello produceva un ordine
    //    con totale negativo, cioe' un negozio che paga il cliente.
    // La rotta della carta ha gia' risolto tutte e due le cose con due funzioni
    // scritte e provate. Non serviva una seconda versione: serviva usarle.
    const quoteCoupon = prezzi.gruppi.map((g) => g.couponPortionCents);
    const quoteRitiro = prezzi.gruppi.map((g) => g.pickupPortionCents);

    // --- 5. Inserisci N ordini (uno per gruppo) con il client admin.
    // #210 e #213 — Il browser non deve piu' indovinare quanto e' stato
    // ordinato. Qui c'e' l'importo che il cliente pagherà davvero, per ogni
    // ordine, col negozio vero: sono i numeri che tornano indietro e finiscono
    // nella misura. Prima ne partiva uno solo, con la stima del browser e la
    // parola «multi» al posto del negozio.
    const ordiniCreati: Array<{ id: string; sellerId: string; totalCents: number }> = [];
    const reservedStockPerGroup: Array<Array<{ product_id: string; variant_id: string | null; qty: number }>> = [];
    const walletAppliedPerGroup: number[] = [];
    // #159 — Gli avvisi da mandare a fine giro, non uno per volta dentro il
    // ciclo: se un negozio successivo fallisce non deve restare in giro la
    // posta di un ordine che poi viene cancellato.
    const comunicazioni: Array<{ orderId: string; sellerId: string; totalCents: number; itemsCount: number }> = [];

    const rollbackCreatedCodOrders = async () => {
      for (let j = createdOrderIds.length - 1; j >= 0; j--) {
        const oid = createdOrderIds[j];
        await admin.from('order_items').delete().eq('order_id', oid);
        await admin.from('orders').delete().eq('id', oid);
        await admin.rpc('restore_stock', { p_items: reservedStockPerGroup[j] });
        if (walletAppliedPerGroup[j] > 0) {
          await admin.rpc('wallet_credit', {
            p_user: user.id,
            p_cents: walletAppliedPerGroup[j],
            p_reason: 'order_cod_refund',
            p_ref: oid,
          });
        }
      }
      // #171 — Anche il codice sconto torna disponibile. Era «consumato» col
      // claim atomico prima di creare gli ordini: se gli ordini vengono
      // annullati e il codice resta usato, il cliente lo ha in mano e il
      // sistema lo considera bruciato, senza che nessuno abbia comprato niente.
      if (validatedCouponCode) {
        const { error: relErr } = await admin.rpc('release_coupon', { p_code: validatedCouponCode });
        if (relErr) logger.warn('[cod] codice sconto non restituito', { code: validatedCouponCode, message: relErr.message });
      }
      createdOrderIds.length = 0;
      ordiniCreati.length = 0;
      comunicazioni.length = 0;
      reservedStockPerGroup.length = 0;
      walletAppliedPerGroup.length = 0;
    };

    for (let i = 0; i < body.groups.length; i++) {
      const g = body.groups[i];
      const shipping = shippingPerGroupCents[i];
      const couponPortionCents = quoteCoupon[i];
      const pickupPortionCents = quoteRitiro[i];
      const discountCents = couponPortionCents + pickupPortionCents;
      // Fee di consegna piattaforma (€3): solo per consegna a domicilio, mai per
      // ritiro in negozio. Il cliente la paga in contanti insieme all'ordine.
      const deliveryFeeCents = prezzi.gruppi[i].deliveryFeeCents;
      const grossTotalCents = prezzi.gruppi[i].totalCents;

      // RISERVA ATOMICA DELLO STOCK del gruppo PRIMA di creare l'ordine (P0-4).
      // Con variante, la riserva scala lo stock della variante.
      const groupStockItems = itemsPerGroupCents[i].map((it) => ({
        product_id: it.productId,
        variant_id: it.variantId,
        qty: it.quantity,
      }));
      const { error: resErr } = await admin.rpc('reserve_stock', { p_items: groupStockItems });
      if (resErr) {
        logger.warn('[cod] reserve_stock fallita', { sellerId: g.sellerId, message: resErr.message });
        // Annulla anche gli ordini dei negozi PRECEDENTI di questo carrello.
        //
        // Il difetto: qui si usciva con un 409 senza toccarli. Con la spesa da
        // due negozi e l'ultimo articolo finito nel secondo, il cliente vedeva
        // «non piu' disponibile» e credeva di non aver ordinato niente — mentre
        // al primo negozio l'ordine era stato creato davvero, con la merce
        // scalata. Le altre due uscite di errore, poche righe sotto, lo
        // facevano: mancava solo questa.
        await rollbackCreatedCodOrders();
        return esciERilascia(ApiErrors.conflict('Alcuni articoli non sono più disponibili nelle quantità richieste.'));
      }

      // Credito MyCity (opt-in): addebito atomico fino a coprire il totale del
      // gruppo. Speso greedy gruppo-per-gruppo; se l'ordine fallisce, si storna.
      let walletAppliedCents = 0;
      if (body.useCredit && grossTotalCents > 0) {
        const { data: applied, error: wErr } = await admin.rpc('wallet_debit', {
          p_user: user.id,
          p_max_cents: grossTotalCents,
          p_reason: 'order_cod',
          p_ref: null,
        });
        if (wErr) {
          logger.warn('[cod] wallet_debit fallita', { sellerId: g.sellerId, message: wErr.message });
        } else {
          walletAppliedCents = typeof applied === 'number' ? applied : 0;
        }
      }
      const totalCents = Math.max(0, grossTotalCents - walletAppliedCents);

      // 🔴-1 settlement COD: registra commissione (10% del SUBTOTALE prodotti del
      // valore di vendita lordo, prima del wallet) e netto venditore (90% del
      // subtotale), come per gli ordini carta. La commissione NON grava su fee di
      // consegna né spedizione. Il pagamento al venditore — gated sulla rimessa
      // contanti del rider — avverrà a parte: qui si registrano solo gli importi.
      const { applicationFeeCents: codFeeCents, sellerPayoutCents: codSellerPayoutCents } = computeOrderSplit({
        totalCents: grossTotalCents,
        deliveryFeeCents,
        shippingCents: shipping,
      });

      // La riga dell'ordine, con dentro i campi che nascono con la migrazione
      // 124. Se quella non è ancora applicata al database, l'inserimento si
      // ripete senza — vedi lib/db/migrazione-124.ts: PostgreSQL non ignora
      // una colonna che non conosce, fa fallire l'istruzione intera, e senza
      // ripiego non nascerebbe nessun ordine fino alla firma sul database.
      const rigaOrdine = {
        user_id: user.id,
        seller_id: g.sellerId,
        total_price: totalCents / 100,
        // 055 — Il lordo di vendita, scritto accanto al netto.
        // `total_price` e' la cassa che il fattorino deve riportare: il
        // totale DOPO lo scomputo del credito MyCity. Ma la quota del
        // negozio (`seller_payout_cents`) nasce sul LORDO. Il rimborso
        // usava il primo come denominatore e la seconda come numeratore:
        // su un ordine da 50 euro pagato con 20 di credito recuperava dal
        // negozio il 67% in piu' del dovuto. Ora il lordo resta scritto.
        gross_total_cents: grossTotalCents,
        shipping_cost: shipping / 100,
        delivery_fee_cents: deliveryFeeCents,
        // Il compenso del fattorino, scritto alla creazione dell'ordine e
        // scollegato da quanto ha pagato il cliente. Prima questa colonna non
        // veniva popolata da nessuna parte, quindi al momento del pagamento si
        // ricadeva sul prezzo di spedizione — che sopra i 30 euro e' zero:
        // il fattorino consegnava gratis. Ora e' una cifra fissa e la distanza
        // non c'entra piu': la fee di consegna la copre da sola.
        // 27/8/2026 (R008) — Si legge dal conto condiviso, non si rifa qui.
        // Il campo c'era gia' (`prezzi.gruppi[i].riderFeeCents`) e non lo
        // leggeva nessuna delle due rotte: un valore calcolato e mai usato fa
        // credere che la regola sia governata in un posto solo mentre in
        // realta' vive in tre.
        rider_fee_cents: prezzi.gruppi[i].riderFeeCents,
        application_fee_cents: codFeeCents,
        seller_payout_cents: codSellerPayoutCents,
        // In attesa della rimessa contanti del rider (un admin la conferma →
        // confirm_cod_remittance → 'HELD' → payout venditore in slice 3).
        payout_status: 'AWAITING_REMITTANCE',
        discount_amount: discountCents / 100,
        wallet_applied_cents: walletAppliedCents,
        coupon_code: validatedCouponCode,
        pickup_in_store: body.pickupInStore,
        // Fascia di consegna scelta dal buyer (null per ritiro / non scelta).
        delivery_slot: body.pickupInStore ? null : (body.deliverySlot ?? null),
        payment_method: 'cod',
        payment_status: 'PENDING',
        delivery_status: 'NEW',
        delivery_full_name: body.delivery.fullName,
        delivery_phone: body.delivery.phone,
        delivery_address: body.delivery.address,
        delivery_city: body.delivery.city,
        delivery_zip: body.delivery.zip,
        delivery_notes: body.delivery.notes ?? null,
        // #162 — Mai le coordinate mandate dal browser come ripiego. Erano
        // quelle di un indirizzo salvato, che pero' la persona puo' aver
        // corretto a mano un attimo prima: il testo dice una via e il punto
        // sulla mappa ne indica un'altra, e il fattorino va dove dice il
        // punto. Meglio nessuna coordinata — si geocodifica dopo — che una
        // coordinata che contraddice l'indirizzo scritto.
        delivery_lat: coordPerLaMappa?.lat ?? null,
        delivery_lng: coordPerLaMappa?.lng ?? null,
      };

      const { data: order, error: orderErr } = await conRipiegoSchema(
        'orders.insert (cod)',
        () => admin.from('orders').insert(rigaOrdine).select('id').single(),
        () => admin.from('orders').insert(senzaCampi(rigaOrdine, CAMPI_124)).select('id').single(),
      );

      if (orderErr || !order) {
        await rollbackCreatedCodOrders();
        await admin.rpc('restore_stock', { p_items: groupStockItems });
        if (walletAppliedCents > 0) {
          await admin.rpc('wallet_credit', {
            p_user: user.id,
            p_cents: walletAppliedCents,
            p_reason: 'order_cod_refund',
            p_ref: null,
          });
        }
        logger.error(orderErr ?? new Error('cod-order-insert-null'), { context: 'cod-order-insert', sellerId: g.sellerId });
        return esciERilascia(ApiErrors.internal('Errore nella creazione ordine.'));
      }

      reservedStockPerGroup.push(groupStockItems);
      walletAppliedPerGroup.push(walletAppliedCents);

      const itemsRows = itemsPerGroupCents[i].map((it) => ({
        order_id: order.id,
        product_id: it.productId,
        quantity: it.quantity,
        unit_price: it.unitCents / 100,
        variant_id: it.variantId,
        variant_label: it.variantLabel,
      }));
      const { error: itemsErr } = await admin.from('order_items').insert(itemsRows);
      if (itemsErr) {
        logger.error(itemsErr, { context: 'cod-order-items-insert', orderId: order.id });
        await admin.from('orders').delete().eq('id', order.id);
        await admin.rpc('restore_stock', { p_items: groupStockItems });
        if (walletAppliedCents > 0) {
          await admin.rpc('wallet_credit', {
            p_user: user.id,
            p_cents: walletAppliedCents,
            p_reason: 'order_cod_refund',
            p_ref: order.id,
          });
        }
        reservedStockPerGroup.pop();
        walletAppliedPerGroup.pop();
        await rollbackCreatedCodOrders();
        return esciERilascia(ApiErrors.internal('Errore nella creazione ordine.'));
      }

      // 159 — GLI AVVISI PARTONO SOLO QUANDO L'ORDINE C'E' DAVVERO, TUTTO.
      //
      // Qui, dentro il ciclo, per ogni negozio partivano subito campanella ed
      // email al venditore e al cliente. Poi bastava che il negozio successivo
      // non avesse piu' la merce: `rollbackCreatedCodOrders` cancellava gli
      // ordini gia' nati, ma le email erano gia' uscite e le campanelle
      // restavano scritte. Il cliente leggeva «Alcuni articoli non sono piu'
      // disponibili» e credeva di non aver ordinato, ma aveva in casella
      // «Ordine ricevuto»; il negozio A aveva «Nuovo ordine» con un link a una
      // pagina che non esiste piu', e cominciava a preparare pane e fiori per
      // un ordine che non c'e'.
      //
      // La strada della carta lo faceva gia' bene: invia solo dopo aver
      // controllato che tutti i gruppi abbiano il loro ordine. Adesso si
      // accumula e si manda alla fine.
      comunicazioni.push({
        orderId: order.id,
        sellerId: g.sellerId,
        totalCents,
        itemsCount: g.items.reduce((sum, it) => sum + it.quantity, 0),
      });

      createdOrderIds.push(order.id);
      ordiniCreati.push({ id: order.id, sellerId: g.sellerId, totalCents });
    }

    // --- 6. Adesso che TUTTI gli ordini esistono, si avvisa. (#159)
    /**
     * 22/8/2026 — IL CLIENTE ASPETTAVA CHE PARTISSE TUTTA LA POSTA.
     *
     * Questo blocco stava DENTRO la risposta: per ogni negozio del carrello due
     * campanelle, due letture e due email, tutte in fila e tutte attese. Con
     * due negozi sono una decina di viaggi verso il servizio di posta prima che
     * la persona veda «Ordine effettuato» — su una rete lenta, secondi di
     * schermata ferma dopo che l'ordine c'e' gia'.
     *
     * La strada della carta lo fa gia' bene: prepara e lascia andare. Qui si
     * copia quello schema. Le campanelle diventano una scrittura sola per
     * tutte, e le email partono senza essere aspettate: se una fallisce si
     * annota, non blocca nessuno.
     *
     * NOTA onesta sull'ambiente: questo funziona perche' il processo resta vivo
     * dopo la risposta. In un ambiente che spegne il processo appena risponde
     * servirebbe una coda — la stessa che gia' esiste per le email di ciclo di
     * vita.
     */
    const campanelle = comunicazioni.flatMap((c) => [
      {
        category: 'order',
        user_id: c.sellerId,
        title: '🎉 Nuovo ordine!',
        body: `Ordine #${c.orderId.slice(0, 6).toUpperCase()} · €${(c.totalCents / 100).toFixed(2)} · pagamento alla consegna`,
        link: `/seller/orders/${c.orderId}`,
      },
      {
        category: 'order',
        user_id: user.id,
        title: '✅ Ordine ricevuto',
        body: `Il tuo ordine #${c.orderId.slice(0, 6).toUpperCase()} è stato inviato al negozio. Ti avviseremo quando viene accettato.`,
        link: `/orders/${c.orderId}`,
      },
    ]);
    if (campanelle.length > 0) {
      const { error: errCampanelle } = await admin.from('notifications').insert(campanelle);
      if (errCampanelle) {
        logger.warn('[cod] campanelle non scritte', { message: errCampanelle.message });
      }
    }

    // 30/8/2026 (R164) — Il carrello di questa persona e' tornato: e' diventato
    // un ordine. Lo marca anche il browser, ma il browser puo' chiudersi. Qui il
    // fatto e' certo, e senza questa riga la colonna `recovered` resta a zero
    // per sempre: la campagna di recupero carrelli non si puo' misurare.
    if (comunicazioni.length > 0) await marcaCarrelloRecuperato(admin, user.id);

    // Le email: preparate qui, spedite senza far aspettare chi ha ordinato.
    // L'indirizzo si prende ADESSO: dentro la funzione che parte per conto suo
    // TypeScript non sa piu' che era stato controllato.
    const emailCliente = user.email;
    // 28/8/2026 — Radiografia del 27/8, terzo bloccante: qui il lavoro partiva
    // «per conto suo» e su Vercel poteva non arrivare mai in fondo, perche' la
    // funzione si spegne appena ha risposto. `dopoLaRisposta` risponde subito e
    // tiene viva l'esecuzione finche' le email non sono partite.
    /**
     * 27/8/2026 (R086) — LA POSTA PARTIVA UNA ALLA VOLTA, IN FILA.
     *
     * Per ogni negozio del carrello: una lettura del suo utente, un'email al
     * negozio, una lettura del suo profilo, un'email al cliente — tutte in
     * sequenza. Con quattro negozi sono quattro letture piu' otto invii uno
     * dietro l'altro, e la funzione resta viva per tutto quel tempo.
     *
     * Adesso i nomi dei negozi si leggono in UNA volta sola per tutti (era un
     * viaggio per ordine, sempre sulla stessa tabella), e i giri partono
     * insieme con `allSettled`: se la posta verso un negozio fallisce, quella
     * agli altri parte lo stesso — che e' esattamente il comportamento che
     * serve quando il servizio di posta fa i capricci su un indirizzo.
     */
    dopoLaRisposta(async () => {
      const negoziCoinvolti = Array.from(new Set(comunicazioni.map((c) => c.sellerId)));
      const nomiNegozio = new Map<string, string>();
      try {
        const { data: profiliNegozi } = await admin
          .from('profiles')
          .select('id, store_name')
          .in('id', negoziCoinvolti);
        for (const p of profiliNegozi ?? []) {
          nomiNegozio.set(p.id as string, (p.store_name as string) ?? 'il negozio');
        }
      } catch (e) {
        logger.warn('[cod] nomi dei negozi non letti per la posta', { e });
      }

      await Promise.allSettled(comunicazioni.map(async (c) => {
        // Email al venditore (oltre alla notifica) — per la carta parte dal webhook,
        // per il COD va inviata qui. Best-effort.
        const alVenditore = (async () => {
          try {
            const { data: sellerAuth } = await admin.auth.admin.getUserById(c.sellerId);
            const sellerEmail = sellerAuth?.user?.email;
            if (!sellerEmail) return;
            const t = newOrderSellerTemplate({
              sellerName: null,
              orderId: c.orderId,
              total: c.totalCents / 100,
              itemsCount: c.itemsCount,
            });
            await sendEmail({ to: sellerEmail, subject: t.subject, html: t.html, text: t.text });
          } catch (e) {
            logger.warn('[cod] email nuovo ordine al venditore fallita', { orderId: c.orderId, e });
          }
        })();

        // Conferma al cliente. Per gli ordini con carta parte dal webhook Stripe;
        // per il contrassegno va inviata qui.
        const alCliente = (async () => {
          try {
            if (!emailCliente) return;
            const t = orderConfirmedBuyerTemplate({
              name: body.delivery.fullName,
              orderId: c.orderId,
              total: c.totalCents / 100,
              storeName: nomiNegozio.get(c.sellerId) ?? 'il negozio',
            });
            await sendEmail({ to: emailCliente, subject: t.subject, html: t.html, text: t.text });
          } catch (e) {
            logger.warn('[cod] email conferma ordine al buyer fallita', { orderId: c.orderId, e });
          }
        })();

        await Promise.all([alVenditore, alCliente]);
      }));
    }, 'email del nuovo ordine in contanti');

    // #208 — L'acquisto si conta qui, dove il fatto è certo. Prima partiva
    // solo dal browser: chi chiudeva la scheda spariva dai conti, e il
    // fatturato in PostHog non riconciliava con la tabella degli ordini.
    //
    // 27/8/2026 (R159) — IL «SÌ» AI COOKIE DATO DA ANONIMO SI PERDEVA.
    //
    // Il consenso si cerca per persona, ma chi accetta il banner prima di
    // registrarsi — cioe' quasi tutti — finisce nel registro con il solo
    // identificativo del browser. Nessuno collegava i due, quindi l'acquisto
    // non partiva quasi mai. I cookie di questo browser ci sono ADESSO, nella
    // richiesta: si leggono qui e si ricuce prima di chiedere il consenso.
    // (Il webhook della carta i cookie non li ha: quella strada la ricuce la
    // rotta /api/stripe/checkout, che invece li riceve.)
    const anonimiDelBrowser = identificativiAnonimi(req.headers.get('cookie'));
    // 30/8/2026 (R166) — Anche Google vuole il SUO identificativo di browser, e
    // sta nello stesso posto: il cookie di questa richiesta. Prima gli si
    // mandava l'UUID della persona, e lui apriva un utente nuovo a ogni
    // acquisto mettendolo sotto «diretto».
    const clientIdGoogle = clientIdGaDalCookie(req.headers.get('cookie'));
    const variantiDelBrowser = variantiDaiCookie(req.headers.get('cookie'));
    // R163 — la chiave del checkout arrivata dal browser, ripulita: e' un dato
    // che viene da fuori e finisce come etichetta in un evento.
    const chiaveDeiConti = chiaveCheckoutValida(body.checkoutId);
    // Fuori dalla risposta: la persona non deve aspettare una misura.
    const misure = (async () => {
      await collegaConsensiAnonimi(admin, user.id, anonimiDelBrowser);
      // Il consenso si legge UNA volta, non una per ordine: e' la stessa persona.
      const consensoAnalytics = await analyticsConsentita(admin, user.id);
      await Promise.all(
        comunicazioni.map((c) =>
          contaAcquisto({
            consensoAnalytics,
            orderId: c.orderId,
            buyerId: user.id,
            totalCents: c.totalCents,
            paymentMethod: 'cod',
            sellerId: c.sellerId,
            gaClientId: clientIdGoogle,
          // 22/8/2026 — LO STESSO CARRELLO PRENDEVA IDENTIFICATIVI DIVERSI.
          //
          // Senza la chiave del tentativo qui si ripiegava sull'id DELL'ORDINE:
          // un carrello da due negozi genera due ordini, quindi due
          // identificativi diversi per la stessa spesa. Nei conti quella
          // diventava due persone che comprano una volta invece di una persona
          // che compra da due negozi — e lo scontrino medio ne usciva
          // dimezzato.
          //
          // `chiaveCarrello` e' una sola per richiesta: o quella mandata dal
          // browser, o una generata qui. Tutti gli ordini nati da questo invio
          // portano quella.
          //
          // 30/8/2026 (R163) — Se il browser manda la chiave del checkout, e'
          // quella che vince: e' la stessa che ha viaggiato con
          // `checkout_started`, e senza di lei i due capi del funnel non si
          // ricuciono. `chiaveCarrello` resta il ripiego (client vecchi).
            checkoutId: chiaveDeiConti ?? chiaveCarrello,
            // 27/8/2026 (R165) — Il gruppo dell'esperimento viaggia con
            // l'acquisto. Prima viveva solo nel browser (super-property di
            // PostHog) e l'evento che conta parte da qui: per sapere se la
            // variante B vendeva di piu' bisognava ricucire le persone a mano.
            varianti: variantiDelBrowser,
          }),
        ),
      );
    });
    dopoLaRisposta(misure, 'misura acquisto in contanti');

    // NB: il coupon è già stato claimato atomicamente sopra (claim_coupon, fix #36).
    // Non chiamiamo più increment_coupon_usage qui.

    // #172 — Si registra il tentativo: se la stessa chiave torna (doppio clic,
    // rete che ritenta), la prossima volta si esce subito con questi ordini.
    if (chiaveTentativo && createdOrderIds.length > 0) {
      // La riga esiste gia' dall'inizio (rivendicata): qui si riempie con gli
      // ordini veri, cosi' un invio ripetuto li ritrova invece di ricrearli.
      const { error: errChiave } = await admin
        .from('cod_checkout_attempts')
        .update({ order_ids: ordiniCreati })
        .eq('chiave', chiaveTentativo)
        .eq('user_id', user.id);
      if (errChiave) logger.warn('[cod] tentativo non completato', { message: errChiave.message });
    }

    // 22/8/2026 — al contratto: `{ ok: true, data: { … } }`, come ogni altra
    // rotta. Qui rispondeva un oggetto nudo, senza `ok` e senza `data`.
    return apiSuccess({ orderIds: createdOrderIds, ordini: ordiniCreati });
  },
);
