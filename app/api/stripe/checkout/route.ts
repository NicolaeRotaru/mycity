import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { CARTA_ACCESA, CODICI_SCONTO_IN_CASSA } from '@/lib/funzioni-al-lancio';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminSupabase, getServerSupabase } from '@/lib/supabase/server';
import { createMultiSellerCheckoutSession, getStripe, isStripeConfigured, RiservaTroppoCorta } from '@/lib/stripe/client';
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { clientIdGaDalCookie } from '@/lib/analytics/ga-client-id';
import { withAuthRateLimit, assertCanPurchase } from '@/lib/api/middleware';
import { vaChiestaSenzaTrattenere } from '@/lib/auth/accettazione-testi';
import { TETTO_PORTIERE_MS } from '@/lib/auth/decisione-portiere';
import { ApiErrors, apiSuccess } from '@/lib/api/responses';
import { RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { coordinateDaIndirizziSalvati } from '@/lib/shipping-coordinate';
import { fuoriZonaDiConsegna, motivoFuoriZona } from '@/lib/ordini/zona-di-consegna';
import { coordinateDiUnIndirizzo } from '@/lib/geocodifica';
import { romeNow } from '@/lib/store-hours';
import { FASCE_AMMESSE, MOTIVO_FASCIA_PIENA, ORDINI_PER_FASCIA, finestraDellaFascia, motivoFasciaRifiutata } from '@/lib/quando-arriva';
import { contaFattoriniOnline, eConsegnaVeloce, veloceSiPuo } from '@/lib/ordini/consegna-veloce';
import { fetchActiveDiscounts, type MappaSconti } from '@/lib/promotions';
import { liberaRiserveAbbandonate } from '@/lib/ordini/riserve-abbandonate';
import type { RiserveLiberate } from '@/lib/ordini/ordine-in-contanti-puo-nascere';
import { rivendicaIlCodiceSconto } from '@/lib/ordini/rivendica-il-codice-sconto';
import { riusoDellaCassaAperta, type EsitoRiuso, type SessioneRiletta } from '@/lib/ordini/riuso-della-cassa-aperta';
import { campoFasciaConsegna } from '@/lib/ordini/fascia-consegna';
import { fasciaAlGiornoDellOrdine, giornoDiPiacenza } from '@/lib/ordini/fascia-leggibile';
import { rispostaPerCarrelloNonVendibile, validaRigaDelCarrello } from '@/lib/ordini/valida-carrello';
import { conColonneDelServizio } from '@/lib/products/servizio';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';
import { collegaConsensiAnonimi, identificativiAnonimi } from '@/lib/analytics/riconcilia-consenso';
import { variantiDaiCookie } from '@/lib/analytics/varianti-dai-cookie';
import { chiaveCheckoutValida } from '@/lib/analytics/chiave-checkout';
import { dopoLaRisposta } from '@/lib/api/dopo-la-risposta';
import { notifyAdmins } from '@/lib/stripe/webhook/comune';

// 009 / 190 — Queste risposte uscivano come `{ error: '…' }` grezzo, mentre
// tutto il resto del progetto risponde `{ ok:false, error:{ code, message } }`
// — la forma che il codice del browser si aspetta e che il file delle
// risposte dichiara «mai inconsistente». Sulle due rotte dei soldi il
// cliente vedeva «Qualcosa non ha funzionato» al posto di «il negozio e'
// chiuso»: il messaggio giusto c'era, e si perdeva nella forma sbagliata.

export const runtime = 'nodejs';

/**
 * 26/11/2026 — QUANTI GIRI HA GIÀ LA FASCIA SCELTA (il tetto è `ORDINI_PER_FASCIA`).
 *
 * Il giorno e la finestra di una fascia si contano dal giorno in cui è stata scelta, come fanno
 * tutti i lettori di `orders.delivery_slot`: «Domani · 16:30–18:00» di un ordine nato ieri è la
 * stessa fascia di «Oggi · 16:30–18:00» scelta adesso. Si contano gli ordini non annullati, a
 * domicilio, per cliente: un carrello con più negozi sono più righe ma un giro solo, e un secondo
 * carrello dello stesso cliente nella stessa fascia va alla stessa porta (`mio`), come per la
 * veloce (migrazione 840). `null` = lettura non riuscita (cosa farne lo dice chi chiama).
 */
type GiornoEFinestra = { giorno: string; da: number; a: number };

/**
 * 27/11/2026 — LA FASCIA DETTA DAL GIORNO IN CUI ARRIVA LA RICHIESTA, ANCHE CON LA CARTA.
 *
 * La stessa regola della rotta dei contanti (app/api/orders/cod/route.ts). Lunedì alle 23:59
 * «Domani · 9:00–11:00» è martedì: arrivata alle 00:01, la rotta la giudicava (e il webhook la
 * contava da `session.created`) per mercoledì. La cassa manda il giorno della fascia
 * (`delivery_date`): se cade un giorno prima di quello che dice l'etichetta letta adesso, la
 * mezzanotte è passata in viaggio e l'etichetta si riporta a oggi (`fasciaAlGiornoDellOrdine`):
 * «Domani» di ieri è «Oggi», una fascia di ieri è passata (`null`). Uno scarto di più giorni è
 * l'orologio del telefono sbagliato: non sposta niente.
 */
function fasciaDelGiornoDellaRichiesta(fascia: string, giornoDellaFascia: string, adesso: Date): string | null {
  const finestra = finestraDellaFascia(fascia);
  const oggi = giornoDiPiacenza(adesso);
  if (!finestra || !oggi || !/^\d{4}-\d{2}-\d{2}$/.test(giornoDellaFascia)) return fascia;
  const giorniDaOggi = Math.round((Date.parse(giornoDellaFascia) - Date.parse(oggi)) / 86_400_000);
  if (giorniDaOggi !== (finestra.giorno === 'domani' ? 0 : -1)) return fascia;
  // Ieri a mezzogiorno (UTC): un istante del giorno in cui la cassa ha proposto la fascia.
  return fasciaAlGiornoDellOrdine(fascia, Date.parse(oggi) - 12 * 3_600_000, adesso);
}

function giornoEFinestra(fascia: string, sceltaIl: string | number | Date): GiornoEFinestra | null {
  const f = finestraDellaFascia(fascia);
  const giornoDellaScelta = giornoDiPiacenza(sceltaIl);
  if (!f || !giornoDellaScelta) return null;
  const giorno = new Date(Date.parse(giornoDellaScelta) + (f.giorno === 'domani' ? 86_400_000 : 0)).toISOString().slice(0, 10);
  return { giorno, da: f.daMinuti, a: f.aMinuti };
}

async function giriNellaFascia(
  admin: ReturnType<typeof getAdminSupabase>,
  fascia: string,
  clienteId: string,
  adesso: Date,
): Promise<{ altri: number; mio: boolean } | null> {
  const cercata = giornoEFinestra(fascia, adesso);
  if (!cercata) return { altri: 0, mio: false };
  const stessaFinestra = FASCE_AMMESSE.filter((e) => {
    const f = finestraDellaFascia(e);
    return f !== null && f.daMinuti === cercata.da && f.aMinuti === cercata.a;
  });
  try {
    const { data, error, count } = await admin
      .from('orders')
      .select('id, user_id, delivery_slot, created_at, pickup_in_store, delivery_status', { count: 'exact' })
      .in('delivery_slot', stessaFinestra)
      // Una fascia di oggi o di domani: gli ordini che la possono avere sono nati da ieri in poi.
      .gte('created_at', new Date(adesso.getTime() - 48 * 3_600_000).toISOString());
    if (error || !Array.isArray(data) || (typeof count === 'number' && count > data.length)) return null;
    const giri = new Set<string>();
    let mio = false;
    for (const o of data as Array<{
      id?: string; user_id?: string | null; delivery_slot?: string | null; created_at?: string | null;
      pickup_in_store?: boolean | null; delivery_status?: string | null;
    }>) {
      if (o.delivery_status === 'CANCELED' || o.pickup_in_store || !o.delivery_slot || !o.created_at) continue;
      const g = giornoEFinestra(o.delivery_slot, o.created_at);
      if (!g || g.giorno !== cercata.giorno || g.da !== cercata.da || g.a !== cercata.a) continue;
      if (o.user_id === clienteId) mio = true;
      else giri.add(o.user_id ? `cliente:${o.user_id}` : `riga:${o.id}`);
    }
    return { altri: giri.size, mio };
  } catch {
    return null;
  }
}

/**
 * 27/11/2026 — I RIFIUTI DELLA FASCIA, UNA REGOLA SOLA PER LA RICHIESTA NUOVA E PER LA PAGINA GIÀ APERTA.
 *
 * La fascia passata (o a meno di un'ora), il negozio chiuso in quella fascia e il tetto dei giri.
 * Il riuso della pagina di Stripe usciva prima di questi controlli: alle 12:30, con «Oggi ·
 * 11:00–13:00», restituiva la pagina vecchia (e il webhook al pagamento rimborsava) mentre una
 * richiesta nuova prendeva 409. Adesso tutte e due le strade chiedono qui, prima della pulizia.
 */
async function rifiutoDellaFascia(
  admin: ReturnType<typeof getAdminSupabase>,
  body: { deliverySlot?: string | null; pickupInStore: boolean },
  negozi: readonly { nome?: string | null; orari?: unknown }[],
  clienteId: string,
): Promise<string | null> {
  if (body.pickupInStore) return null;
  const rifiutata = motivoFasciaRifiutata(body.deliverySlot, negozi);
  if (rifiutata) return rifiutata;
  // 26/11/2026 — Al massimo `ORDINI_PER_FASCIA` giri per fascia (fatto `consegna.capienza`): al sesto
  // 409. La veloce non è una fascia, e il ritiro non chiede un giro. Sta prima della pulizia, come
  // gli altri rifiuti: un tentativo respinto non chiude le altre casse. Un conteggio non riuscito
  // non ferma il pagamento: il tetto è morbido (il negozio accetta ogni ordine e può rifiutare
  // quelli in più), e una lettura caduta non deve spegnere la carta; resta scritto.
  const fascia = body.deliverySlot;
  if (!fascia || eConsegnaVeloce({ fascia, ritiroInNegozio: false })) return null;
  const giri = await giriNellaFascia(admin, fascia, clienteId, new Date());
  if (giri === null) {
    logger.warn('[stripe] giri della fascia non contati: il tetto non è stato controllato', { userId: clienteId });
    return null;
  }
  return !giri.mio && giri.altri + 1 > ORDINI_PER_FASCIA ? MOTIVO_FASCIA_PIENA : null;
}

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
  // La fascia scelta in cassa. Non è più solo un'etichetta: da qui decide se il
  // negozio può servire (vedi `negozioPuoServire`), quindi si accettano solo le
  // sette che la cassa propone davvero — l'elenco è in lib/quando-arriva.ts.
  deliverySlot: campoFasciaConsegna,
  // Il giorno di Roma della fascia, «AAAA-MM-GG», come la cassa l'ha proposta: lo manda già.
  // Serve solo a `fasciaDelGiornoDellaRichiesta`.
  delivery_date: z.string().max(40).optional().nullable(),
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
  // 31/10/2026 — Al lancio la carta è spenta (CARTA_ACCESA, scelta di Nicola): la
  // rotta la rifiuta anche con le chiavi Stripe presenti. Prima la governava solo
  // la presenza della chiave, e chi la metteva su Vercel apriva la carta da sé.
  if (!CARTA_ACCESA) {
    return ApiErrors.unavailable('Al momento si paga solo in contanti alla consegna.');
  }
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

  // 17/11/2026 (R31-003) — Una consegna a domicilio ha sempre un orario: senza fascia l'ordine
  // nasceva con `delivery_slot` vuoto e il negozio non sapeva per quando prepararlo (la cassa
  // del sito ne manda sempre una). Qui, dopo lo spegnimento del ritiro: un ritiro spento è una consegna.
  if (!body.pickupInStore && !body.deliverySlot) return ApiErrors.invalidRequest('Scegli quando vuoi ricevere l’ordine.');

  // 27/11/2026 — «Domani» premuto alle 23:59 e arrivato dopo mezzanotte: la fascia si riporta al
  // giorno della richiesta, una volta sola e prima di ogni uso (impronta, controlli, riga di intento),
  // come nella rotta dei contanti.
  if (!body.pickupInStore && body.deliverySlot && body.delivery_date) {
    const riportata = fasciaDelGiornoDellaRichiesta(body.deliverySlot, body.delivery_date, new Date());
    if (riportata === null) {
      return ApiErrors.conflict('La fascia che hai scelto è già passata. Scegline una ancora disponibile, oppure ordina per domani.');
    }
    body.deliverySlot = riportata;
  }

  const supa = await getServerSupabase();
  const admin = getAdminSupabase();
  // 17/11/2026 (R31-016) — I Termini in vigore anche qui, come nei contanti: stessa regola e stesso dubbio del portiere.
  const termini = await vaChiestaSenzaTrattenere(() => supa, user.id, TETTO_PORTIERE_MS);
  if (termini === 'chiedi') {
    return ApiErrors.forbidden('I Termini di MyCity sono cambiati: ricarica la pagina e accettali prima di ordinare.');
  }
  if (termini !== 'lascia-entrare') logger.warn('[carta] Termini accettati non controllati prima del pagamento', { esito: termini });
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
        // 31/10/2026 — e il giorno in cui la si sceglie: «Domani» detto alle 23:50 e alle 00:05
        // sono due giorni diversi, e il webhook conta la fascia dal momento della pagina.
        giorno: body.pickupInStore || !body.deliverySlot ? null : giornoDiPiacenza(new Date()),
      }),
    )
    .digest('hex');

  /**
   * 8/9/2026 — PRIMA DI CHIEDERE QUALUNQUE COSA, SI RESTITUISCE QUELLO CHE
   * QUESTA STESSA PERSONA TENEVA GIÀ IN OSTAGGIO.
   *
   * Un tentativo abbandonato blocca DUE cose del cliente: la merce e il codice
   * sconto. La pulizia che le ridà entrambe stava più in basso, subito prima di
   * `reserve_stock` — cioè dopo il punto in cui la merce viene contata e dopo
   * quello in cui il codice viene richiesto di nuovo. Chi tornava indietro dalla
   * pagina di Stripe per cambiare la fascia si sentiva rispondere «Stock
   * insufficiente per Torta (0 disponibili)» oppure «Coupon non valido: Codice
   * esaurito»: la sua torta, il suo codice, un ordine che non esiste.
   *
   * Adesso la pulizia è il primo movimento della rotta, come già nella cassa in
   * contanti. Il tentativo IDENTICO non si tocca (`improntaDaTenere`): quello lo
   * gestisce il riuso della sessione, poche righe più sotto. Si toccano solo i
   * tentativi che impegnano i prodotti di QUESTO carrello.
   *
   * Costa un viaggio in più prima delle letture in parallelo. Vale il prezzo:
   * liberare dopo aver letto le disponibilità non serve a niente, il numero in
   * mano sarebbe già quello vecchio.
   *
   * 15/11/2026 (R26-021) — MA NON PRIMA DEI RIFIUTI. La pulizia chiude su Stripe
   * le pagine di pagamento degli altri tentativi: girava prima di ogni
   * convalida, e un tentativo respinto (fascia chiusa, negozio chiuso, fuori
   * zona, prodotto non vendibile) uccideva una cassa ancora buona. Adesso parte
   * solo quando la richiesta ha passato tutti i controlli che non dipendono
   * dalle scorte (`pulisci`, piu' sotto); se ha liberato qualcosa, le scorte si
   * rileggono prima di contarle.
   */
  let pulizia: Promise<RiserveLiberate> | null = null;
  const pulisci = (): Promise<RiserveLiberate> =>
    (pulizia ??= liberaRiserveAbbandonate(admin, {
      buyerId: user.id,
      improntaDaTenere: improntaCarrello,
      soloConProdotti: uniqueProductIds,
    }));

  const [prodottiLetti, discountMap, variantiLette, venditoriLetti, tentativoGiaAperto] = await Promise.all([
    // 27/11/2026 — Col `tipo` (999g) la cassa rifiuta un servizio. Prima della 999g la colonna
    // non c'è: si rilegge senza, e ogni riga vale «prodotto» (lib/products/servizio.ts).
    conColonneDelServizio(
      () => supa.from('products').select('id, name, price, images, seller_id, stock, status, has_variants, tipo').in('id', uniqueProductIds),
      () => supa.from('products').select('id, name, price, images, seller_id, stock, status, has_variants').in('id', uniqueProductIds),
    ),
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
      // 3/9/2026 — Anche `delivery`: al riuso i dati di contatto appena
      // scritti vanno rimessi sulla riga, e per farlo senza cancellare il
      // resto (impronta, coordinate, fascia) bisogna avere quello che c'e'.
      .select('id, stripe_session_id, delivery')
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

  /**
   * 28/11/2026 (R05-008) — I NEGOZI DEL CARRELLO, PRESI ALLO STESSO MODO DALLE DUE STRADE.
   *
   * La vetrina pubblica non restituisce ogni negozio che vende: un negozio approvato senza insegna,
   * o in modalità demo (fuori vetrina, migrazione 709), non c'è. La richiesta nuova lo riprendeva
   * dal profilo col client di servizio; il riuso della pagina già aperta no, e il negozio mancante
   * saltava il «negozio chiuso»: alle 14:00 la pagina per «Oggi · 13:00–16:30» di un forno che
   * riapre alle 16:30 si restituiva, mentre una richiesta nuova prendeva 409. E con la lettura
   * caduta, al riuso si guardava solo l'orologio. Adesso le due strade chiedono qui (una lettura
   * sola, ricordata): o tornano tutti i negozi del carrello, o il rifiuto della richiesta nuova.
   *
   * 28/10/2026 — UNA LETTURA DEI NEGOZI CORTA FERMA IL PAGAMENTO.
   *
   * Stessa porta della rotta dei contanti: l'errore si buttava e nessuno
   * contava i negozi tornati. Con la lista vuota «negozio chiuso» e «fuori
   * zona» non controllavano nessuno e la consegna perdeva le coordinate del
   * negozio. Ogni negozio del carrello deve tornare, o il pagamento non si apre.
   */
  type NegozioDelCarrello = {
    id: string;
    store_name: string | null;
    store_lat: number | null;
    store_lng: number | null;
    store_hours: unknown;
  };
  type NegoziDelCarrello =
    | { negozi: NegozioDelCarrello[]; rifiuto: null }
    | { negozi: null; rifiuto: ReturnType<typeof ApiErrors.unavailable> };
  let negoziRisolti: Promise<NegoziDelCarrello> | null = null;
  const negoziDelCarrello = (): Promise<NegoziDelCarrello> =>
    (negoziRisolti ??= (async (): Promise<NegoziDelCarrello> => {
      if (venditoriLetti.error || !venditoriLetti.data) {
        logger.error('[stripe] lettura dei negozi fallita: pagamento non aperto', {
          userId: user.id,
          negozi: sellerIds.length,
          message: venditoriLetti.error?.message ?? 'nessun dato',
        });
        return {
          negozi: null,
          rifiuto: ApiErrors.unavailable('Non riusciamo a controllare il negozio in questo momento. Riprova fra poco.'),
        };
      }
      const negozi: NegozioDelCarrello[] = venditoriLetti.data.map((s) => ({
        id: s.id,
        store_name: s.store_name ?? null,
        store_lat: s.store_lat ?? null,
        store_lng: s.store_lng ?? null,
        store_hours: (s as { store_hours?: unknown }).store_hours,
      }));
      const negoziLetti = new Set(negozi.map((s) => s.id));
      const negoziMancanti = sellerIds.filter((id) => !negoziLetti.has(id));
      if (negoziMancanti.length === 0) return { negozi, rifiuto: null };
      // Un negozio approvato senza insegna (o fuori vetrina) la vetrina non lo restituisce: i dati
      // per i controlli si prendono dal profilo, col client di servizio. Chi non è un negozio
      // approvato non passa.
      const { data: profiliMancanti, error: errProfili } = await admin
        .from('profiles')
        .select('id, store_name, store_lat, store_lng, store_hours, role, is_approved')
        .in('id', negoziMancanti);
      const recuperati = (profiliMancanti ?? []).filter((p) => p.role === 'seller' && p.is_approved === true);
      if (errProfili || recuperati.length !== negoziMancanti.length) {
        logger.error('[stripe] negozi del carrello non trovati: pagamento non aperto', {
          userId: user.id,
          negoziMancanti,
          trovatiNelProfilo: recuperati.length,
          message: errProfili?.message,
        });
        return {
          negozi: null,
          rifiuto: errProfili
            ? ApiErrors.unavailable('Non riusciamo a controllare il negozio in questo momento. Riprova fra poco.')
            : ApiErrors.conflict('Un negozio del carrello non accetta ordini in questo momento. Toglilo dal carrello e riprova.'),
        };
      }
      for (const p of recuperati) {
        negozi.push({
          id: p.id,
          store_name: p.store_name ?? null,
          store_lat: p.store_lat ?? null,
          store_lng: p.store_lng ?? null,
          store_hours: p.store_hours,
        });
      }
      return { negozi, rifiuto: null };
    })());

  const sessioneGiaAperta =
    (tentativoGiaAperto.data as {
      id: string;
      stripe_session_id: string | null;
      delivery: Record<string, unknown> | null;
    } | null) ?? null;
  if (sessioneGiaAperta?.stripe_session_id) {
    /**
     * 8/9/2026 — RESTITUIRE LA CASSA GIÀ APERTA È UN INCASSO: PASSA ANCHE LEI
     * DAL CANCELLO DEL PAGAMENTO VECCHIO.
     *
     * Questo ramo esce con un `return` suo, duecento righe prima del cancello
     * che ferma tutto quando una pagina di pagamento vecchia è rimasta pagabile
     * (quello dentro `rivendicaIlCodiceSconto`). Finché quel cancello qui non
     * lo guardava nessuno, di qui usciva una SECONDA cassa pagabile sugli
     * stessi articoli: la vecchia che non si era riusciti a chiudere, e questa.
     * È esattamente il doppio addebito che la pulizia in cima serve a impedire.
     *
     * La decisione adesso vive in `riusoDellaCassaAperta`: è pura, la si può
     * eseguire in una prova, e vuole in ingresso il resoconto della pulizia —
     * chi scrive questa rotta non può più restituire una cassa senza averlo
     * guardato, perché senza quel resoconto non gli si compila.
     */
    // 28/11/2026 (R05-008) — I negozi come per la richiesta nuova: anche quelli fuori vetrina, letti
    // col client di servizio. Lettura caduta o negozio che non vende: la pagina vecchia non si
    // restituisce, si risponde col rifiuto della richiesta nuova. Prima della pulizia, come gli altri.
    const negoziAlRiuso = await negoziDelCarrello();
    if (negoziAlRiuso.rifiuto) return negoziAlRiuso.rifiuto;
    const orariAlRiuso = negoziAlRiuso.negozi.map((s) => ({ nome: s.store_name, orari: s.store_hours }));
    // R26-021 — La veloce si controlla PRIMA della pulizia: un rifiuto non chiude le altre casse.
    if (eConsegnaVeloce({ fascia: body.deliverySlot, ritiroInNegozio: body.pickupInStore })) {
      const veloceOra = veloceSiPuo({
        adesso: romeNow(),
        negozi: orariAlRiuso.map((n) => ({ nome: n.nome ?? 'Il negozio', orari: n.orari })),
        fattoriniOnline: await contaFattoriniOnline(admin),
      });
      if (!veloceOra.possibile) return ApiErrors.conflict(veloceOra.perche);
    }
    // 27/11/2026 — Anche la fascia e il tetto, prima della pulizia: la pagina vecchia non scavalca
    // il 409 che prenderebbe una richiesta nuova.
    const fasciaNoAlRiuso = await rifiutoDellaFascia(admin, body, orariAlRiuso, user.id);
    if (fasciaNoAlRiuso) return ApiErrors.conflict(fasciaNoAlRiuso);

    let sessioneRiletta: SessioneRiletta = null;
    try {
      sessioneRiletta = await getStripe().checkout.sessions.retrieve(sessioneGiaAperta.stripe_session_id);
    } catch (e) {
      // Se Stripe non risponde si tira dritto e se ne apre una nuova: meglio un
      // doppione che una persona che non riesce a pagare. Il cancello qui sotto
      // vale lo stesso: «non ho potuto rileggere» non apre nessuna porta.
      logger.warn('[stripe] sessione precedente non rileggibile, ne apro una nuova', { e });
    }

    // 26/11/2026 — La pulizia chiude su Stripe le casse degli altri carrelli: qui gira solo se
    // c'è davvero una pagina da restituire. Se la pagina di prima non è più pagabile (scaduta,
    // Stripe muto) si va avanti senza pulire: la pulizia la fa `pulisci()` più sotto, dopo i
    // rifiuti, e il cancello del pagamento vecchio lo guarda la rivendicazione del codice sconto.
    // Prima un tentativo poi respinto (fascia finita, negozio chiuso) chiudeva una cassa buona.
    const riuso: EsitoRiuso =
      riusoDellaCassaAperta(null, sessioneRiletta).esito === 'riusa'
        ? riusoDellaCassaAperta(await pulisci(), sessioneRiletta)
        : { esito: 'apri_nuova' };
    if (riuso.esito === 'ferma_tutto') {
      logger.error('[stripe] cassa gia aperta NON restituita: un pagamento vecchio e ancora pagabile', {
        userId: user.id,
        pendingCheckoutId: sessioneGiaAperta.id,
        sessioni: riuso.sessioni.length,
      });
      return ApiErrors.conflict(riuso.messaggio);
    }

    if (riuso.esito === 'riusa') {
      /**
       * 5/11/2026 — LA VELOCE SI CONTROLLA ANCHE SULLA PAGINA GIÀ APERTA.
       * Questo ramo esce prima del controllo della veloce (8-21, negozi aperti,
       * fattorino online): alle 21:30 la pagina delle 20:50 si restituiva, con
       * l'euro della veloce, mentre una richiesta nuova prendeva 409. Stessa
       * decisione, stesso messaggio.
       */
      // R26-021 — il controllo della veloce sta sopra, prima della pulizia.
      /**
       * 3/9/2026 — CORREGGERE IL TELEFONO IN CASSA DEVE SERVIRE A QUALCOSA.
       *
       * L'impronta del carrello dice «stesso carrello» guardando solo quello
       * che cambia il prezzo: prodotti, sconto, ritiro, via, fascia. Nome,
       * telefono e note della consegna non entrano nel prezzo e restavano
       * fuori. Ma l'ordine, poi, il webhook lo scrive leggendo QUESTA riga:
       * chi scriveva 333 111 1111, tornava indietro dalla pagina del
       * pagamento, correggeva in 333 999 9999 e ripagava, si ritrovava
       * l'ordine col numero vecchio — e il fattorino chiamava un numero che
       * non risponde. Stessa storia per il nome e per «lasciare al portiere».
       *
       * Non si mette il contatto nell'impronta: farebbe aprire un secondo
       * pagamento, che e' quello che l'impronta serve a evitare (riserva
       * doppia della merce e codice sconto bruciato). Si riscrivono i tre
       * campi sulla riga gia' aperta, tenendo tutto il resto com'e'.
       */
      const vecchio = sessioneGiaAperta.delivery ?? {};
      const contattoNuovo = {
        full_name: body.delivery.fullName,
        phone: body.delivery.phone,
        notes: body.delivery.notes ?? null,
      };
      const cambiato = (Object.keys(contattoNuovo) as Array<keyof typeof contattoNuovo>).some(
        (campo) => (vecchio[campo] ?? null) !== contattoNuovo[campo],
      );
      if (cambiato) {
        const { error: errContatto } = await admin
          .from('pending_checkouts')
          .update({ delivery: { ...vecchio, ...contattoNuovo } })
          .eq('id', sessioneGiaAperta.id);
        if (errContatto) {
          // La sessione si restituisce lo stesso: e' l'unica strada che non
          // riserva la merce una seconda volta, e la vecchia resta comunque
          // pagabile. Ma resta scritto forte, perche' l'ordine nascera' con
          // il contatto di prima e la consegna puo' fallire.
          logger.error('[stripe] contatto corretto NON salvato sul pagamento gia aperto', {
            pendingCheckoutId: sessioneGiaAperta.id,
            message: errContatto.message,
          });
        }
      }
      logger.info('[stripe] stesso carrello, stessa sessione: non ne apro una seconda', {
        pendingCheckoutId: sessioneGiaAperta.id,
        contattoAggiornato: cambiato,
      });
      return apiSuccess({ id: riuso.id, url: riuso.url });
    }
  }

  const { data: products, error: prodErr } = prodottiLetti;
  // 5/11/2026 — Uno sconto non letto non e' «nessuno sconto»: niente prezzo pieno a sorpresa.
  if ((discountMap as MappaSconti).scontiNonLetti === true) {
    return ApiErrors.unavailable('Non riusciamo a leggere le promozioni in questo momento. Riprova fra poco.');
  }

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

  // 28/10/2026 / 28/11/2026 (R05-008) — Ogni negozio del carrello deve tornare, o il pagamento non
  // si apre: la regola sta in `negoziDelCarrello`, la stessa del riuso della pagina già aperta.
  const letturaNegozi = await negoziDelCarrello();
  if (letturaNegozi.rifiuto) return letturaNegozi.rifiuto;
  const sellers = letturaNegozi.negozi;

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
  //
  // 3/9/2026 — LA DECISIONE GUARDA LA FASCIA SCELTA, NON L'OROLOGIO. Dalle 20:00
  // la cassa propone «Domani» da sola, e questo controllo rifiutava lo stesso:
  // ogni ordine serale per il giorno dopo moriva all'ultimo clic. Ora un ordine
  // per domani passa se domani, in quella fascia, il negozio è aperto.
  const consegnaVeloce = eConsegnaVeloce({ fascia: body.deliverySlot, ritiroInNegozio: body.pickupInStore });
  //
  // 30/10/2026 (ondata 22) — Qui mancavano i 60 minuti: alle 17:50 «15:00–18:00» passava con la
  // carta e coi contanti prendeva un 409, e senza orari del negozio passava anche una fascia
  // finita. Adesso è la regola unica di lib/quando-arriva.ts, la stessa dei contanti: stesso 409,
  // stesso messaggio.
  // 26/11/2026 — E il tetto dei giri per fascia: la regola sta in `rifiutoDellaFascia`.
  const fasciaNo = await rifiutoDellaFascia(
    admin,
    body,
    (sellers ?? []).map((s) => ({ nome: s.store_name, orari: (s as { store_hours?: unknown }).store_hours })),
    user.id,
  );
  if (fasciaNo) return ApiErrors.conflict(fasciaNo);

  // 29/10/2026 — LA VELOCE SI VENDE SOLO SE SI PUÒ MANTENERE: 8-21, negozi aperti adesso, un
  // fattorino approvato e online. La stessa decisione della cassa e dei contanti (`veloceSiPuo`).
  if (consegnaVeloce) {
    const veloce = veloceSiPuo({
      adesso: romeNow(),
      negozi: (sellers ?? []).map((s) => ({
        nome: s.store_name ?? 'Il negozio',
        orari: (s as { store_hours?: unknown }).store_hours,
      })),
      fattoriniOnline: await contaFattoriniOnline(admin),
    });
    if (!veloce.possibile) return ApiErrors.conflict(veloce.perche);
  }

  /**
   * 15/11/2026 (R26-021) — TUTTI I RIFIUTI CHE NON DIPENDONO DALLE SCORTE,
   * PRIMA DELLA PULIZIA.
   *
   * Le righe del carrello si guardano una prima volta sui dati gia' letti: un
   * prodotto non vendibile, del negozio sbagliato o con la variante sbagliata
   * si rifiuta qui. Le scorte no: quelle le tiene ancora in ostaggio il
   * tentativo abbandonato, e si contano dopo la pulizia (ciclo qui sotto).
   */
  for (const g of body.groups) {
    for (const it of g.items) {
      const primaOcchiata = validaRigaDelCarrello({
        riga: it,
        sellerId: g.sellerId,
        prodotti: products,
        varianti: variantMap,
        sconti: discountMap,
      });
      if (!primaOcchiata.ok && primaOcchiata.scarto.motivo !== 'SCORTE_INSUFFICIENTI') {
        return rispostaPerCarrelloNonVendibile(primaOcchiata.scarto);
      }
    }
  }

  // 4a. Dove va la consegna: le coordinate servono sia alla zona (qui sotto) sia
  // al prezzo della spedizione, ricalcolato server-side con la STESSA logica
  // distanza-based della UI (lib/shipping.ts), usando le coordinate negozio dal
  // DB e quelle di consegna inviate dal client. Coupon FREE_SHIPPING o soglia
  // raggiunta ⇒ 0. Si ignora qualunque importo di spedizione dal client.
  // Coordinate della consegna prese dal database, non dal browser: il prezzo
  // della consegna dipende dalla distanza, e finora quel numero lo scriveva il
  // client. Se l'indirizzo non è fra quelli salvati dalla persona, si resta
  // senza coordinate (la spedizione oggi vale zero comunque).
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
   * 6/9/2026 — FIN DOVE ARRIVIAMO, DETTO PRIMA DI APRIRE IL PAGAMENTO.
   *
   * Nessun punto del progetto guardava se l'indirizzo fosse dentro la zona che
   * serviamo: una consegna a Milano passava, e sopra i 30 euro passava pure
   * gratis. Qui si ferma prima che il cliente metta la carta — sull'altra strada
   * (contanti) il controllo è lo stesso, e la regola vive in un posto solo
   * (`fuoriZonaDiConsegna`, lib/ordini/zona-di-consegna.ts).
   *
   * Sta PRIMA della rivendicazione del codice sconto: dopo, un rifiuto per zona
   * lascerebbe il buono bruciato senza che nessuno abbia comprato niente.
   *
   * Coordinate mancanti = non si blocca: passa come prima.
   *
   * 20/11/2026 (R04-011) — ...ma non più in silenzio, come i contanti (R31-018,
   * app/api/orders/cod/route.ts): chi non si può misurare si annota qui e, a
   * pagamento aperto, gli amministratori ricevono la campanella per guardare la
   * distanza a mano.
   */
  const nonMisurati = new Map<string, string>();
  if (!body.pickupInStore) {
    for (const s of sellers ?? []) {
      const fuori = fuoriZonaDiConsegna({
        storeLat: s.store_lat ?? null,
        storeLng: s.store_lng ?? null,
        deliveryLat: coordPerLaMappa?.lat ?? null,
        deliveryLng: coordPerLaMappa?.lng ?? null,
      });
      if (fuori) {
        logger.info('[stripe] consegna fuori zona: pagamento non aperto', { sellerId: s.id });
        return ApiErrors.invalidRequest(motivoFuoriZona(s.store_name));
      }
      if (!s.store_lat || !s.store_lng) nonMisurati.set(s.id, 'il negozio non ha la posizione sulla mappa');
      else if (!coordPerLaMappa?.lat || !coordPerLaMappa?.lng) nonMisurati.set(s.id, 'l’indirizzo non si trova sulla mappa');
    }
  }

  // 31/10/2026 — I codici sconto in cassa sono spenti (CODICI_SCONTO_IN_CASSA): un
  // codice di MyCity oggi lo pagherebbe il negozio al 90%. Si rifiuta qui, dove si
  // rifiuta un codice non valido, prima di rivendicarlo.
  if (!CODICI_SCONTO_IN_CASSA && body.couponCode?.trim()) {
    return ApiErrors.invalidRequest('I codici sconto non sono attivi: togli il codice e riprova.');
  }

  // R26-021 — Passati i rifiuti, si libera quello che questa persona teneva in ostaggio.
  const riserveLiberate = await pulisci();
  /**
   * 21/11/2026 (R03-011) — IL BENVENUTO RESTITUITO DAL TENTATIVO ABBANDONATO SI RIUSA SUBITO.
   *
   * La carta rifiutata sulla pagina di Stripe: il cliente torna, cambia qualcosa e ripreme «Paga».
   * La pulizia chiude la pagina vecchia e restituisce il codice (`release_coupon(p_code)`), ma la
   * rivendicazione di quel tentativo (`coupon_redemptions`, migrazione 361) restava aperta: entro due
   * minuti la cassa nuova leggeva «Coupon non disponibile». Ogni tentativo scrive nella sua riga di
   * intento quale rivendicazione è sua; qui si chiudono solo quelle dei tentativi appena liberati,
   * mai il lucchetto di una scheda il cui pagamento non è ancora nato.
   */
  if (riserveLiberate.liberati.length > 0) {
    try {
      const { data: liberate } = await admin
        .from('pending_checkouts')
        .select('id, delivery')
        .in('id', riserveLiberate.liberati);
      const sue = ((liberate ?? []) as Array<{ delivery?: { rivendicazione?: unknown } | null }>)
        .map((p) => p.delivery?.rivendicazione)
        .filter((r): r is string => typeof r === 'string' && r !== '');
      if (sue.length > 0) {
        const { error: errChiusa } = await admin
          .from('coupon_redemptions')
          .update({ released_at: new Date().toISOString() })
          .in('id', sue)
          .is('released_at', null);
        if (errChiusa) logger.warn('[stripe] rivendicazione del tentativo liberato non chiusa', { message: errChiusa.message });
      }
    } catch (e) {
      logger.warn('[stripe] rivendicazione del tentativo liberato non chiusa', { message: e instanceof Error ? e.message : String(e) });
    }
  }
  let prodottiPerIlConto = products;
  if (riserveLiberate.liberati.length > 0) {
    // La merce liberata e' tornata a scaffale DOPO la lettura: le scorte si rileggono.
    const [scorteProdotti, scorteVarianti] = await Promise.all([
      supa.from('products').select('id, stock').in('id', uniqueProductIds),
      allVariantIds.length > 0
        ? supa.from('product_variants').select('id, stock').in('id', allVariantIds)
        : Promise.resolve({ data: [] as Array<{ id: string; stock: number | null }>, error: null }),
    ]);
    if (scorteProdotti.error || scorteVarianti.error) {
      logger.warn('[stripe] scorte non rilette dopo la pulizia: conto su quelle di prima', {
        message: scorteProdotti.error?.message ?? scorteVarianti.error?.message,
      });
    } else {
      const scorte = new Map(
        ((scorteProdotti.data ?? []) as Array<{ id: string; stock: number | null }>).map((r) => [r.id, r.stock]),
      );
      prodottiPerIlConto = products.map((p) => (scorte.has(p.id) ? { ...p, stock: scorte.get(p.id) ?? p.stock } : p));
      for (const r of (scorteVarianti.data ?? []) as Array<{ id: string; stock: number | null }>) {
        const v = variantMap.get(r.id);
        if (v) variantMap.set(r.id, { ...v, stock: r.stock ?? 0 });
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
      /**
       * 6/9/2026 — LA STESSA REGOLA DEI CONTANTI, NON UNA SUA COPIA.
       *
       * Prodotto esistente, del negozio giusto, disponibile, variante valida e
       * sua, scorte, prezzo scontato: erano trenta righe identiche a quelle di
       * app/api/orders/cod/route.ts. Adesso decidono insieme, in
       * lib/ordini/valida-carrello.ts — messaggi e codici di risposta invariati.
       */
      const esito = validaRigaDelCarrello({
        riga: it,
        sellerId: g.sellerId,
        prodotti: prodottiPerIlConto,
        varianti: variantMap,
        sconti: discountMap,
      });
      if (!esito.ok) return rispostaPerCarrelloNonVendibile(esito.scarto);

      const p = esito.prodotto;
      const cover = Array.isArray(p.images) ? p.images[0] : null;
      stripeItems.push({
        productId: esito.riga.productId,
        name: esito.riga.variantLabel ? `${p.name} (${esito.riga.variantLabel})` : p.name,
        quantity: esito.riga.quantity,
        unitAmountCents: esito.riga.unitCents,
        imageUrl: typeof cover === 'string' ? cover : undefined,
        variantId: esito.riga.variantId,
        variantLabel: esito.riga.variantLabel,
      });
      groupSubtotalCents += esito.riga.unitCents * esito.riga.quantity;
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

  /**
   * 4b. Coupon: ri-validato e ri-calcolato dal coupon reale (mai dal client),
   * e rivendicato in modo atomico.
   *
   * 8/9/2026 — LA RIVENDICAZIONE PRETENDE LA PULIZIA, NON LA SPERA.
   *
   * Prima queste righe stavano qui da sole e la pulizia dei tentativi
   * abbandonati girava 130 righe più in basso: su un codice a uso unico il
   * secondo tentativo dello stesso cliente moriva qui, con «Codice esaurito»,
   * e non arrivava mai alla riga che glielo avrebbe restituito. Adesso la
   * decisione vive in `lib/ordini/rivendica-il-codice-sconto.ts` e vuole in
   * ingresso il resoconto della pulizia: chiedere il codice prima di aver
   * liberato non si compila più.
   */
  // R26-021 — il rifiuto dei codici spenti sta sopra, prima della pulizia.
  const codiceSconto = await rivendicaIlCodiceSconto(
    riserveLiberate,
    { admin, lettura: supa },
    { codice: body.couponCode, subtotaleCents: grandSubtotalCents, userId: user.id, ritiroInNegozio: body.pickupInStore },
  );
  if (!codiceSconto.ok) {
    if (codiceSconto.motivo === 'pagamento_ancora_aperto') {
      logger.error('[stripe] seconda cassa non aperta: il pagamento vecchio e ancora pagabile', {
        userId: user.id,
        sessioni: codiceSconto.sessioni.length,
      });
      return ApiErrors.conflict(codiceSconto.messaggio);
    }
    return ApiErrors.invalidRequest(codiceSconto.messaggio);
  }
  const couponDiscountCents = codiceSconto.scontoCents;
  const couponFreeShipping = codiceSconto.spedizioneGratis;
  const validatedCouponCode = codiceSconto.codice;
  // 21/11/2026 (R03-010) — La riga della rivendicazione di QUESTO tentativo (`coupon_redemptions`,
  // migrazione 361), letta subito: è l'ultima aperta del cliente su quel codice, perché finché è
  // aperta e recente un'altra non può nascere. Serve a `rilasciaCoupon` per chiudere solo lei. Se la
  // lettura non riesce la riga resta aperta, come prima: il lucchetto si spegne da solo in due minuti.
  let rivendicazioneDelTentativo: string | null = null;
  if (validatedCouponCode) {
    try {
      const { data: buono } = await admin.from('coupons').select('id').eq('code', validatedCouponCode).maybeSingle();
      if (buono) {
        const { data: riga } = await admin
          .from('coupon_redemptions')
          .select('id')
          .eq('coupon_id', (buono as { id: string }).id)
          .eq('user_id', user.id)
          .is('released_at', null)
          .order('claimed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        rivendicazioneDelTentativo = (riga as { id?: string } | null)?.id ?? null;
      }
    } catch (e) {
      logger.warn('[stripe] rivendicazione del codice non riletta', { code: validatedCouponCode, message: e instanceof Error ? e.message : String(e) });
    }
  }

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
    consegnaVeloce,
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
    if (relErr) {
      logger.warn('[stripe] codice sconto non restituito', { code: validatedCouponCode, message: relErr.message });
      return;
    }
    // 21/11/2026 (R03-010) — `release_coupon(p_code)` rimette l'uso nel contatore ma lascia aperta la
    // rivendicazione del cliente: se la cassa cadeva, il benvenuto restava bloccato fino a due minuti.
    // Dopo un rilascio riuscito si chiude anche lei, solo quella di questo tentativo.
    if (!rivendicazioneDelTentativo) return;
    const { error: errChiusa } = await admin
      .from('coupon_redemptions')
      .update({ released_at: new Date().toISOString() })
      .eq('id', rivendicazioneDelTentativo)
      .is('released_at', null);
    if (errChiusa) logger.warn('[stripe] rivendicazione del codice non chiusa', { code: validatedCouponCode, message: errChiusa.message });
  };

  /**
   * 3/9/2026 — PRIMA DI RISERVARE, SI LIBERA QUELLO CHE QUESTA STESSA PERSONA
   * AVEVA GIÀ IMPEGNATO. La chiamata a `liberaRiserveAbbandonate` NON è più
   * qui: è salita in cima alla rotta, prima delle letture del catalogo e prima
   * della rivendicazione del codice sconto.
   *
   * Perché è salita: qui liberava la merce troppo tardi per due passi che erano
   * già andati male. Le disponibilità erano già state lette (quindi il cliente
   * leggeva «0 disponibili» sul pezzo che aveva riservato lui) e il codice
   * sconto era già stato richiesto di nuovo (quindi su un codice a uso unico la
   * richiesta moriva prima di arrivare fin qui). Chi la rimette in questo punto
   * riapre tutti e due i buchi.
   */
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
        // salvate (o senza coordinate).
        lat: coordPerLaMappa?.lat ?? null,
        lng: coordPerLaMappa?.lng ?? null,
        // Fascia di consegna scelta dal buyer: il webhook la legge da qui e la
        // scrive su orders.delivery_slot. null per ritiro / non scelta.
        slot: body.pickupInStore ? null : (body.deliverySlot ?? null),
        // R049/R125/R136 — L'impronta di QUESTO carrello: è quella che, al
        // secondo invio, fa ritrovare il pagamento già aperto invece di
        // aprirne un altro e riservare la merce due volte.
        impronta_carrello: improntaCarrello,
        // 21/11/2026 (R03-011) — La rivendicazione del benvenuto di questo tentativo: se il tentativo
        // viene liberato, la pulizia del tentativo dopo chiude proprio lei.
        rivendicazione: rivendicazioneDelTentativo,
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
    // 5/11/2026 — Senza quell'id il riuso della cassa aperta e la pulizia delle
    // riserve non la riconoscono: un secondo «Paga» riservava la merce di nuovo
    // e apriva una seconda pagina pagabile. Se la scrittura cade, la pagina
    // appena nata si chiude su Stripe e si passa dalla pulizia qui sotto.
    const { error: errSessione } = await admin
      .from('pending_checkouts')
      .update({ stripe_session_id: session.id })
      .eq('id', pending.id);
    if (errSessione) {
      logger.error('[stripe] id della pagina di pagamento non salvato: la si chiude', {
        pendingCheckoutId: pending.id, message: errSessione.message,
      });
      let chiusa = false;
      try {
        await getStripe().checkout.sessions.expire(session.id);
        chiusa = true;
      } catch (errChiusura) {
        // Non chiusa: e' ancora pagabile, quindi la riserva NON si toglie (si
        // venderebbe merce gia' pagata). Resta com'era ieri, col guasto nel log.
        logger.error('[stripe] pagina di pagamento senza id non chiusa su Stripe', { sessionId: session.id, errChiusura });
      }
      if (chiusa) {
        // La pulizia la fa chi prende il turno sul carrello: anche il webhook
        // checkout.session.expired la fa, solo se il carrello e' ancora PENDING.
        const { data: preso } = await admin
          .from('pending_checkouts')
          .update({ status: 'CANCELED' })
          .eq('id', pending.id)
          .eq('status', 'PENDING')
          .select('id');
        if (preso && preso.length > 0) {
          await admin.rpc('restore_stock', { p_items: stockItems });
          await rilasciaCoupon();
        }
        return ApiErrors.internal('Errore nella creazione del pagamento.');
      }
    }

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

    // R04-011 — Il segno del pagamento aperto senza la misura del confine (vedi il controllo della
    // zona): la stessa campanella dei contanti (R31-018). L'ordine nasce dal webhook a pagamento
    // fatto, quindi il segno porta il carrello, non ancora il numero dell'ordine.
    if (nonMisurati.size > 0) {
      dopoLaRisposta(async () => {
        for (const [sellerId, perche] of nonMisurati) {
          try {
            await notifyAdmins(
              'Pagamento con carta con la distanza non misurata',
              `Il pagamento con carta ${pending.id.slice(0, 8)} (${sellerNameMap.get(sellerId) ?? 'Negozio'}) è stato aperto senza il controllo della distanza dal negozio: ${perche}. Se viene pagato, guarda a mano se l'indirizzo è dentro il confine.`,
              '/admin/orders',
            );
          } catch (e) {
            logger.error('[stripe] allarme agli amministratori non partito', { sellerId, message: e instanceof Error ? e.message : String(e) });
          }
        }
      }, 'campanella della distanza non misurata');
    }

    // 22/8/2026 — al contratto del progetto, `{ ok: true, data: { … } }`. Qui
    // rispondeva un oggetto nudo, come la rotta dei contanti prima di ieri.
    return apiSuccess({ id: session.id, url: session.url });
  } catch (e) {
    /**
     * 6/9/2026 — LA RISERVA TROPPO CORTA NON È UN GUASTO NOSTRO.
     *
     * Se alla merce riservata resta meno di mezz'ora, Stripe non può tenere
     * aperta una cassa che scada insieme a lei: prima si alzava la scadenza al
     * minimo e si apriva lo stesso, e la pagina di pagamento sopravviveva alla
     * merce. Adesso non si parte: la pulizia qui sotto è la stessa (merce
     * rimessa in vendita, codice sconto restituito, riga di intento annullata),
     * cambia solo cosa legge il cliente — «rifai l'ordine», non «errore».
     */
    const carrelloScaduto = e instanceof RiservaTroppoCorta;
    if (carrelloScaduto) logger.warn('[stripe] riserva troppo corta per aprire la cassa', { message: (e as Error).message });
    else logger.error('[stripe] checkout creation failed', e);
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
    if (carrelloScaduto) {
      return ApiErrors.conflict('Il carrello è scaduto. Rimetti i prodotti nel carrello e riprova.');
    }
    return ApiErrors.internal('Errore nella creazione del pagamento.');
  }
});
