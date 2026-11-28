import { randomUUID } from 'node:crypto';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { diagnosiJavascript } from './_pagina-senza-javascript';

/**
 * 3/9/2026 — LA PROVA CHE MANCAVA: QUALCUNO CHE ATTRAVERSA LA CASSA.
 *
 * Nel progetto c'erano undici file di prove nel browser e nessuno arrivava
 * all'ordine. Il file del checkout lo diceva in cima: «no checkout completo,
 * serve auth+DB». In tutte le prove non esisteva una sola sessione con un
 * cliente dentro: niente accesso, nessuno stato salvato, e l'unico accenno
 * all'autenticazione era il controllo che le rotte protette rispondano 401.
 * Nessuna prova metteva qualcosa nel carrello, sceglieva un indirizzo e
 * arrivava a un ordine — ne' in contrassegno ne' con carta.
 *
 * Il punto dove entrano i soldi era l'unico senza nessuno che ci passasse.
 *
 * QUESTA PROVA PERCORRE LA CASSA IN TRE TRATTI, e ogni tratto dichiara cosa
 * serve per essere percorso:
 *
 *   ① IL MURO DEI SOLDI — non serve niente, gira sempre.
 *      Le due rotte che creano un ordine (contrassegno e carta) devono
 *      rifiutare chi non ha fatto l'accesso, anche se la richiesta arriva
 *      confezionata bene, con prodotti e indirizzo. E' il tratto piu'
 *      importante: la pagina si puo' aggirare, il server no. Se un giorno una
 *      di queste due rotte creasse un ordine a un anonimo, chiunque potrebbe
 *      far preparare merce a un negozio senza essere nessuno.
 *
 *   ② IL PERCORSO NEL BROWSER — serve una pagina che si animi.
 *      Carrello pieno → la cassa mostra la merce, il totale e come si paga →
 *      chi non ha fatto l'accesso viene mandato all'accesso e non perde il
 *      carrello. Il carrello si semina nel browser (vive in `localStorage`),
 *      quindi NON serve nessun database. Oggi questo tratto NON puo' girare:
 *      /cart e /checkout arrivano al browser senza JavaScript per il difetto
 *      del nonce descritto in `_pagina-senza-javascript.ts`. Il salto e'
 *      appeso a quel difetto e si scioglie da solo il giorno che viene
 *      riparato — vedi il file, non e' un interruttore.
 *
 *   ③ IL PAGAMENTO VERO — servono un database di prova e, per la carta, le
 *      chiavi di Stripe in modalita' prova. Ogni prova si semina da sola il
 *      negozio approvato, il prodotto e il cliente, passa dalle rotte vere e
 *      poi guarda l'ordine nel database. Gira solo con E2E_DATI_DI_PROVA
 *      acceso e l'ambiente pronto (R29-001); senza, e' saltata DICENDO cosa
 *      manca. Il lavoro della CI che la fa girare e' «e2e-cassa-vera».
 */

/** Un carrello finto, con la forma vera di `lib/cart.ts`. Nessun database. */
const CARRELLO_DI_PROVA = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Pane comune di Piacenza',
    price: 3.5,
    quantity: 2,
    sellerId: '22222222-2222-4222-8222-222222222222',
    storeName: 'Forno di prova',
  },
];

const TOTALE_MERCE = CARRELLO_DI_PROVA.reduce((s, r) => s + r.price * r.quantity, 0); // 7,00 €

/** Semina il carrello prima che gli script della pagina partano. */
async function seminaIlCarrello(page: Page) {
  await page.addInitScript((righe) => {
    window.localStorage.setItem('cart', JSON.stringify(righe));
  }, CARRELLO_DI_PROVA);
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * ① IL MURO DEI SOLDI — gira sempre, senza chiavi e senza browser animato.
 * ────────────────────────────────────────────────────────────────────────────
 */
test.describe('la cassa non lascia passare chi non ha fatto l\'accesso', () => {
  /** Una richiesta d'ordine fatta bene: prodotti veri nella forma, indirizzo completo. */
  const ORDINE_BEN_CONFEZIONATO = {
    items: CARRELLO_DI_PROVA.map((r) => ({
      id: r.id,
      productId: r.id,
      quantity: r.quantity,
      price: r.price,
      sellerId: r.sellerId,
    })),
    address: 'Via Roma 1',
    city: 'Piacenza',
    zip: '29121',
    phone: '3330000000',
    paymentMethod: 'cod',
  };

  test('in contrassegno un anonimo non crea nessun ordine', async ({ request }) => {
    const r = await request.post('/api/orders/cod', { data: ORDINE_BEN_CONFEZIONATO });
    expect(
      r.status(),
      'un anonimo ha creato un ordine in contrassegno: un negozio prepara merce per nessuno',
    ).toBe(401);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: false, error: { code: expect.any(String) } });
    // Il rifiuto non deve regalare un numero d'ordine ne' un identificativo.
    expect(JSON.stringify(corpo)).not.toMatch(/orderId|order_id/i);
  });

  test('con carta un anonimo non apre nessun pagamento', async ({ request }) => {
    const r = await request.post('/api/stripe/checkout', { data: ORDINE_BEN_CONFEZIONATO });
    expect(
      r.status(),
      'un anonimo ha aperto una sessione di pagamento: si incassano soldi senza sapere di chi',
    ).toBe(401);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: false });
    // Nessun indirizzo di pagamento deve tornare indietro a chi non e' nessuno.
    expect(JSON.stringify(corpo)).not.toMatch(/checkout\.stripe\.com|sessionId|client_secret/i);
  });

  test('il muro vale per tutti e due i modi di pagare, non per uno solo', async ({ request }) => {
    // Le due rotte sono due porte sulla stessa stanza. Una prova per ciascuna
    // puo' passare mentre l'altra marcisce: qui si chiede che siano d'accordo.
    const esiti = await Promise.all(
      ['/api/orders/cod', '/api/stripe/checkout'].map(async (rotta) => ({
        rotta,
        stato: (await request.post(rotta, { data: ORDINE_BEN_CONFEZIONATO })).status(),
      })),
    );
    expect(
      esiti.filter((e) => e.stato === 401).length,
      `le due porte della cassa non si comportano allo stesso modo: ${JSON.stringify(esiti)}`,
    ).toBe(2);
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────────
 * ② IL PERCORSO NEL BROWSER — dal carrello pieno fino alla richiesta di
 *    accedere. Non serve nessun database: la merce la semina il browser.
 * ────────────────────────────────────────────────────────────────────────────
 */
test.describe('dal carrello alla cassa, con la merce dentro', () => {
  test('il carrello mostra la merce, il suo totale e la strada per la cassa', async ({
    page,
    request,
  }) => {
    const diagnosi = await diagnosiJavascript(request, '/cart');
    test.skip(diagnosi.senzaJavascript, diagnosi.motivo);

    await seminaIlCarrello(page);
    await page.goto('/cart');

    // La merce c'e', col suo nome e col nome del negozio che la vende.
    await expect(page.getByText(CARRELLO_DI_PROVA[0].name)).toBeVisible();
    await expect(page.getByText(CARRELLO_DI_PROVA[0].storeName)).toBeVisible();

    // E il conto torna: due pezzi da 3,50 fanno 7,00. Un carrello che mostra
    // un numero diverso da quello che ha dentro e' il modo piu' rapido di
    // perdere chi stava per pagare.
    const importo = TOTALE_MERCE.toFixed(2).replace('.', '[.,]');
    await expect(page.getByText(new RegExp(`${importo}`)).first()).toBeVisible();

    // 3/9/2026 — NOTA SUL TRATTO CHE MANCA. Da qui in avanti la cassa NON si
    // puo' percorrere senza database: /checkout rilegge dal database ogni riga
    // del carrello (prezzo di adesso, scorte, venditore approvato) prima di
    // disegnare il modulo, e senza risposta resta sullo scheletro. La merce nel
    // browser non basta: e' una scelta giusta — il prezzo che si paga deve
    // essere quello del server — ed e' anche il motivo per cui il tratto ③ qui
    // sotto ha bisogno di dati veri e non di un trucco.
  });
});

/*
 * ────────────────────────────────────────────────────────────────────────────
 * ③ IL PAGAMENTO VERO — gira col database di prova; senza, saltato e detto a voce alta.
 * ────────────────────────────────────────────────────────────────────────────
 */
test.describe('l\'ordine che nasce davvero', () => {
  /*
   * Questi quattro tratti sono quelli che il fix proposto dalla radiografia
   * chiede, e sono gli unici che possono dire «i soldi arrivano dove devono».
   * Girano solo con un database di PROVA e, per la carta, con le chiavi di
   * Stripe in modalita' prova.
   *
   * Senza, si saltano con la ragione scritta accanto, perche' la lista di cio'
   * che NON e' provato dev'essere leggibile in CI e non un ricordo di qualcuno.
   *
   * 26/10/2026 — Le ultime tre avevano per corpo `expect(SENZA_AMBIENTE_DI_PROVA).toBe(false)`,
   * cioe' controllavano l'interruttore e non la cassa; dall'1/11 erano gusci vuoti saltati alla
   * nascita. 16/11/2026 (R29-001) — Adesso hanno il corpo vero: seminano i dati, chiamano le
   * rotte vere (contrassegno, carta con l'avviso di Stripe firmato, rifiuto del negozio, giro dei
   * bonifici) e guardano l'ordine nel database di prova. Nessuna asserzione guarda la variabile:
   * la variabile decide solo se girare. tests/unit/le-prove-della-cassa-non-passano-senza-aver-guardato.test.ts
   * le fa girare con un ambiente finto e irraggiungibile e pretende che cadano provando a
   * raggiungerlo: una prova che non guarda passerebbe, o si salterebbe.
   *
   * NON usare test.fixme: il riepilogo del lavoro «Prove nel browser (senza
   * chiavi)» legge solo le annotazioni di tipo 'skip', e una fixme
   * risulterebbe «saltata senza dire perche'».
   */

  /*
   * 16/11/2026 (R29-001) — UN SOLO SALTO, QUESTO, E COPRE ANCHE LE TRE PROVE DELL'ACQUISTO VERO.
   * «Ambiente di prova pronto» vuol dire: l'interruttore E2E_DATI_DI_PROVA acceso, il database
   * LOCALE di prova e Stripe in modalita' prova pronto. Se manca anche una cosa sola si saltano
   * tutte, e il motivo dice quale: mai verdi a vuoto, e il lavoro della CI non diventa rosso
   * perche' manca un segreto. Le prove, dentro, non si spengono piu' una per una.
   *
   * Cosa serve:
   *  - il database: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY
   *    di un database LOCALE di prova (tests/supabase-locale/avvia.sh): verso un altro indirizzo
   *    queste prove non scrivono;
   *  - la carta: STRIPE_SECRET_KEY che comincia con sk_test_ e STRIPE_WEBHOOK_SECRET, gli stessi
   *    che ha il sito acceso;
   *  - il bonifico: E2E_STRIPE_CONTO_NEGOZIO (un conto collegato acct_… di PROVA, capace di
   *    ricevere trasferimenti) e CRON_SECRET, lo stesso del sito acceso.
   */
  const AMBIENTE = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    // Il processo delle prove non è il sito: lib/env.ts è del sito, e qui la chiave serve solo a
    // seminare il database locale di prova.
    // eslint-disable-next-line no-restricted-syntax
    servizio: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    stripe: process.env.STRIPE_SECRET_KEY ?? '',
    firmaWebhook: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    contoNegozio: process.env.E2E_STRIPE_CONTO_NEGOZIO ?? '',
    cron: process.env.CRON_SECRET ?? '',
  };

  /** Il database di prova è solo quello locale: un indirizzo vero non si semina mai. */
  function eUnDatabaseLocale(url: string): boolean {
    try {
      return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  /** null = l'ambiente c'è tutto; altrimenti il motivo del salto, in italiano. */
  function cosaManca(serve: ReadonlyArray<'database' | 'carta' | 'bonifico'>): string | null {
    const mancano: string[] = [];
    if (serve.includes('database')) {
      if (!AMBIENTE.url || !AMBIENTE.anon || !AMBIENTE.servizio) {
        mancano.push('il database di prova (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)');
      } else if (!eUnDatabaseLocale(AMBIENTE.url)) {
        mancano.push('un database LOCALE di prova (tests/supabase-locale/avvia.sh): verso un altro indirizzo queste prove non scrivono');
      }
    }
    if (serve.includes('carta')) {
      if (!AMBIENTE.stripe.startsWith('sk_test_')) mancano.push('la chiave Stripe di prova (STRIPE_SECRET_KEY sk_test_…)');
      if (!AMBIENTE.firmaWebhook) mancano.push('il segreto del webhook che ha il sito acceso (STRIPE_WEBHOOK_SECRET)');
    }
    if (serve.includes('bonifico')) {
      if (!AMBIENTE.contoNegozio.startsWith('acct_')) mancano.push('il conto collegato di prova del negozio (E2E_STRIPE_CONTO_NEGOZIO acct_…)');
      if (!AMBIENTE.cron) mancano.push('il segreto dei lavori a orario del sito acceso (CRON_SECRET)');
    }
    return mancano.length > 0 ? `manca ${mancano.join('; ')}` : null;
  }

  const ACCESO = Boolean(process.env.E2E_DATI_DI_PROVA);
  const COSA_MANCA = ACCESO ? cosaManca(['database', 'carta', 'bonifico']) : null;
  const SENZA_AMBIENTE_DI_PROVA = !ACCESO || COSA_MANCA !== null;
  const PERCHE = !ACCESO
    ? 'serve un database di prova con dentro un negozio approvato, un prodotto e un cliente, ' +
      'piu\' le chiavi Stripe in modalita\' prova (variabile E2E_DATI_DI_PROVA). ' +
      'Finche\' manca, in questo giro nessun ordine nasce davvero.'
    : `E2E_DATI_DI_PROVA e' accesa ma l'ambiente di prova non e' pronto: ${COSA_MANCA}. ` +
      'Finche\' manca, in questo giro nessun ordine nasce davvero.';

  /*
   * 28/11/2026 (R11-004, onda 2) — LA CASSA DISEGNATA HA BISOGNO DEL SOLO DATABASE.
   * Stava sotto il salto dell'acquisto vero: anche col lavoro «La cassa vera» acceso si saltava senza
   * le chiavi di Stripe, che a lei non servono (e il filtro `-g` di quel lavoro non la sceglieva).
   * Il suo salto guarda solo il database LOCALE di prova; le tre prove dei soldi restano sotto il
   * salto unico, che guarda tutto.
   */
  const LA_CASSA_DISEGNATA = 'la cassa disegna il modulo con la merce riletta dal database';
  const COSA_MANCA_AL_DATABASE = ACCESO ? cosaManca(['database']) : null;
  const SENZA_DATABASE_DI_PROVA = !ACCESO || COSA_MANCA_AL_DATABASE !== null;
  const PERCHE_SENZA_DATABASE = !ACCESO
    ? 'serve un database di prova LOCALE (tests/supabase-locale/avvia.sh) e la variabile E2E_DATI_DI_PROVA: ' +
      'la cassa rilegge dal database ogni riga del carrello prima di disegnare il modulo.'
    : `E2E_DATI_DI_PROVA e' accesa ma il database di prova non e' pronto: ${COSA_MANCA_AL_DATABASE}.`;

  // Playwright vuole il primo argomento destrutturato: `{}` sono le fixture, che qui non servono.
  test.beforeEach(({}, prova) => {
    if (prova.title === LA_CASSA_DISEGNATA) test.skip(SENZA_DATABASE_DI_PROVA, PERCHE_SENZA_DATABASE);
    else test.skip(SENZA_AMBIENTE_DI_PROVA, PERCHE);
  });

  test('la cassa disegna il modulo con la merce riletta dal database', async ({ page }) => {
    // R11-004 — Nel carrello va il prodotto seminato in questo giro, non gli id inventati di
    // CARRELLO_DI_PROVA: la cassa rilegge ogni riga dal database (prezzo, scorte, negozio approvato)
    // e toglie dal carrello quelle che non conosce («non più disponibili»). Col carrello svuotato il
    // modulo non si disegnava, e la prova sarebbe caduta il primo giorno in cui girava.
    const b = await preparaLaBottega();
    const riga = { ...CARRELLO_DI_PROVA[0], id: b.prodottoId, sellerId: b.negozio.id };
    await page.addInitScript((righe) => {
      window.localStorage.setItem('cart', JSON.stringify(righe));
    }, [riga]);
    await page.goto('/checkout');
    await expect(page.getByText(riga.name).first()).toBeVisible();
    await expect(page.getByText(/Indirizzo di consegna/i).first()).toBeVisible();
    await expect(page.getByText(/contrassegno|alla consegna/i).first()).toBeVisible();
    await expect(page.getByText(/Totale/i).first()).toBeVisible();
    // La riga è rimasta: il database l'ha riconosciuta, non l'ha tolta come «non più disponibile».
    await expect(page.getByText(/non (?:è|sono) più disponibil/i)).toHaveCount(0);
  });

  /*
   * 16/11/2026 (R29-001) — LE TRE PROVE DELL'ACQUISTO VERO, CON IL CORPO.
   *
   * Erano tre gusci `async () => {}` dichiarati saltati: passavano in tre millesimi senza aprire
   * niente. Ognuna ora:
   *  ① si semina da sola, con la chiave di servizio del database di prova, un negozio approvato
   *    con un prodotto e un cliente con l'email confermata e l'indirizzo salvato (dati finti,
   *    indirizzi @prova-e2e.mycity.test);
   *  ② entra dalle rotte vere del sito acceso (E2E_BASE_URL), col gettone della persona, come il
   *    browser: /api/orders/cod, /api/stripe/checkout, /api/stripe/webhook,
   *    /api/seller/orders/<id>/reject, /api/cron/release-payouts;
   *  ③ guarda l'ordine nel database di prova e, per la carta, l'oggetto su Stripe in modalita'
   *    prova (pagamento, rimborso, trasferimento).
   *
   * Dentro non hanno salti propri: l'ambiente lo guarda il salto unico qui sopra, e se manca
   * qualcosa si saltano tutte e tre prima di cominciare, dicendo cosa.
   */

  function databaseDiProva(): SupabaseClient {
    return createClient(AMBIENTE.url, AMBIENTE.servizio, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  function stripeDiProva(): Stripe {
    return new Stripe(AMBIENTE.stripe);
  }

  type Persona = { id: string; email: string; gettone: string };
  type Bottega = { db: SupabaseClient; negozio: Persona; cliente: Persona; prodottoId: string };

  const INDIRIZZO = { address: 'Via Roma 1', city: 'Piacenza', zip: '29121' };

  /** Una persona vera nel database di prova, con l'email confermata, e il suo gettone d'accesso. */
  async function nuovaPersona(db: SupabaseClient, ruolo: 'seller' | 'buyer', nome: string): Promise<Persona> {
    const email = `${ruolo}-${randomUUID()}@prova-e2e.mycity.test`;
    const password = `Prova-${randomUUID()}`;
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: ruolo, full_name: nome },
    });
    expect(error, `la persona di prova (${ruolo}) non nasce: ${error?.message}`).toBeNull();
    const accesso = createClient(AMBIENTE.url, AMBIENTE.anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sessione, error: errAccesso } = await accesso.auth.signInWithPassword({ email, password });
    expect(errAccesso, `la persona di prova (${ruolo}) non entra: ${errAccesso?.message}`).toBeNull();
    return { id: data.user!.id, email, gettone: sessione.session!.access_token };
  }

  /**
   * Il negozio approvato (a Piacenza, senza orari: aperto), il suo prodotto con le scorte, e il
   * cliente con l'indirizzo salvato a due passi dal negozio: dentro la zona di consegna.
   */
  async function preparaLaBottega(conto?: string): Promise<Bottega> {
    const db = databaseDiProva();
    const negozio = await nuovaPersona(db, 'seller', 'Negozio di prova');
    const { error: errNegozio } = await db
      .from('profiles')
      .update({
        is_approved: true,
        approval_status: 'approved',
        store_name: CARRELLO_DI_PROVA[0].storeName,
        store_lat: 45.0526,
        store_lng: 9.693,
        ...(conto ? { stripe_account_id: conto, stripe_charges_enabled: true, stripe_payouts_enabled: true } : {}),
      })
      .eq('id', negozio.id);
    expect(errNegozio, `il negozio di prova non si approva: ${errNegozio?.message}`).toBeNull();

    const { data: prodotto, error: errProdotto } = await db
      .from('products')
      .insert({
        name: CARRELLO_DI_PROVA[0].name,
        price: CARRELLO_DI_PROVA[0].price,
        seller_id: negozio.id,
        status: 'available',
        stock: 50,
      })
      .select('id')
      .single();
    expect(errProdotto, `il prodotto di prova non nasce: ${errProdotto?.message}`).toBeNull();

    const cliente = await nuovaPersona(db, 'buyer', 'Cliente di prova');
    const { error: errIndirizzo } = await db.from('user_addresses').insert({
      user_id: cliente.id,
      label: 'Casa',
      full_name: 'Cliente di prova',
      phone: '3330000000',
      ...INDIRIZZO,
      lat: 45.053,
      lng: 9.6935,
      is_default: true,
    });
    expect(errIndirizzo, `l'indirizzo di prova non si salva: ${errIndirizzo?.message}`).toBeNull();

    return { db, negozio, cliente, prodottoId: (prodotto as { id: string }).id };
  }

  /** La richiesta d'ordine come la fa il browser: dal carrello seminato, coi prodotti di questo giro. */
  function ordineDalCarrello(b: Bottega) {
    return {
      groups: [
        {
          sellerId: b.negozio.id,
          items: CARRELLO_DI_PROVA.map((r) => ({ productId: b.prodottoId, quantity: r.quantity })),
        },
      ],
      delivery: { fullName: 'Cliente di prova', phone: '3330000000', ...INDIRIZZO },
    };
  }

  const conGettone = (p: Persona) => ({ authorization: `Bearer ${p.gettone}` });
  const centesimi = (euro: unknown) => Math.round(Number(euro) * 100);

  type OrdineLetto = {
    id: string;
    user_id: string;
    seller_id: string;
    total_price: number | string;
    shipping_cost: number | string | null;
    discount_amount: number | string | null;
    payment_method: string;
    payment_status: string;
    delivery_status: string;
    payout_status: string | null;
    seller_payout_cents: number | null;
    stripe_payment_intent: string | null;
    stripe_charge_id: string | null;
    stripe_refund_id: string | null;
    stripe_transfer_id: string | null;
    refunded_amount_cents: number | null;
  };
  const COLONNE =
    'id, user_id, seller_id, total_price, shipping_cost, discount_amount, payment_method, payment_status, ' +
    'delivery_status, payout_status, seller_payout_cents, stripe_payment_intent, stripe_charge_id, ' +
    'stripe_refund_id, stripe_transfer_id, refunded_amount_cents';

  async function leggiOrdine(db: SupabaseClient, colonna: 'id' | 'stripe_session_id', valore: string): Promise<OrdineLetto> {
    const { data, error } = await db.from('orders').select(COLONNE).eq(colonna, valore).single();
    expect(error, `l'ordine non si legge dal database di prova: ${error?.message}`).toBeNull();
    return data as unknown as OrdineLetto;
  }

  /**
   * Un ordine pagato DAVVERO con la carta, in modalità prova: la cassa apre la sessione di
   * pagamento, Stripe incassa (carta di prova pm_card_visa), e l'avviso firmato
   * «checkout.session.completed» arriva al webhook del sito, che crea l'ordine PAID.
   */
  async function ordinePagatoConLaCarta(request: APIRequestContext, b: Bottega, stripe: Stripe) {
    const cassa = await request.post('/api/stripe/checkout', { data: ordineDalCarrello(b), headers: conGettone(b.cliente) });
    expect(cassa.status(), `la cassa con la carta non apre il pagamento: ${await cassa.text()}`).toBe(200);
    const sessioneId = ((await cassa.json()) as { data?: { id?: string } }).data?.id ?? '';
    expect(sessioneId).toMatch(/^cs_test_/);

    const sessione = await stripe.checkout.sessions.retrieve(sessioneId);
    const carrello = sessione.client_reference_id ?? '';
    expect(carrello, 'la sessione di pagamento non porta il carrello in attesa').not.toBe('');
    const totaleCents = sessione.amount_total ?? 0;
    expect(totaleCents, 'la sessione di pagamento non ha un totale').toBeGreaterThan(centesimi(TOTALE_MERCE) - 1);

    const pagamento = await stripe.paymentIntents.create({
      amount: totaleCents,
      currency: sessione.currency ?? 'eur',
      payment_method: 'pm_card_visa',
      payment_method_types: ['card'],
      confirm: true,
      transfer_group: `mc_${carrello}`,
      metadata: { pending_checkout_id: carrello, prova: 'e2e-cassa' },
    });
    expect(pagamento.status, 'la carta di prova non è stata addebitata').toBe('succeeded');

    const evento = {
      id: `evt_prova_${randomUUID().replace(/-/g, '')}`,
      object: 'event',
      api_version: '2024-06-20',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'checkout.session.completed',
      data: {
        object: {
          ...sessione,
          status: 'complete',
          payment_status: 'paid',
          payment_intent: pagamento.id,
          customer_details: { email: b.cliente.email, name: 'Cliente di prova' },
        },
      },
    };
    const corpo = JSON.stringify(evento);
    const firma = stripe.webhooks.generateTestHeaderString({ payload: corpo, secret: AMBIENTE.firmaWebhook });
    const avviso = await request.post('/api/stripe/webhook', {
      data: corpo,
      headers: { 'stripe-signature': firma, 'content-type': 'application/json' },
    });
    expect(avviso.status(), `il webhook non ha preso l'avviso firmato: ${await avviso.text()}`).toBe(200);

    const ordine = await leggiOrdine(b.db, 'stripe_session_id', sessioneId);
    expect(ordine.payment_method).toBe('card');
    expect(ordine.payment_status, 'pagato con la carta, ma l ordine non risulta PAID').toBe('PAID');
    expect(ordine.delivery_status).toBe('NEW');
    expect(ordine.stripe_payment_intent).toBe(pagamento.id);
    expect(centesimi(ordine.total_price), 'l ordine non costa quanto Stripe ha incassato').toBe(totaleCents);
    return { ordine, pagamento, totaleCents };
  }

  test('contrassegno: l\'ordine nasce e il negozio lo vede', async ({ request }) => {
    const b = await preparaLaBottega();

    const risposta = await request.post('/api/orders/cod', {
      data: ordineDalCarrello(b),
      headers: { ...conGettone(b.cliente), 'idempotency-key': `e2e-${randomUUID()}` },
    });
    expect(risposta.status(), `il contrassegno non crea l'ordine: ${await risposta.text()}`).toBe(200);
    const corpo = (await risposta.json()) as { ok: boolean; data?: { orderIds?: string[]; ordini?: Array<{ id: string; totalCents: number }> } };
    expect(corpo.ok).toBe(true);
    expect(corpo.data?.orderIds, 'un carrello di un negozio fa un ordine solo').toHaveLength(1);
    const id = corpo.data!.orderIds![0];

    // L'ordine c'è nel database, nuovo, del cliente e del negozio giusti, in contanti.
    const ordine = await leggiOrdine(b.db, 'id', id);
    expect(ordine.user_id).toBe(b.cliente.id);
    expect(ordine.seller_id).toBe(b.negozio.id);
    expect(ordine.payment_method).toBe('cod');
    expect(ordine.delivery_status).toBe('NEW');
    expect(ordine.payment_status).toBe('PENDING');

    // Il totale: la merce del carrello (2 × 3,50) più la consegna meno lo sconto, uguale a
    // quello che la rotta ha detto al cliente.
    const atteso = centesimi(TOTALE_MERCE) + centesimi(ordine.shipping_cost ?? 0) - centesimi(ordine.discount_amount ?? 0);
    expect(centesimi(ordine.total_price), 'il totale dell ordine non è merce + consegna').toBe(atteso);
    expect(centesimi(ordine.total_price)).toBe(corpo.data?.ordini?.[0]?.totalCents);
    const { data: righe, error: errRighe } = await b.db.from('order_items').select('product_id, quantity, unit_price').eq('order_id', id);
    expect(errRighe).toBeNull();
    expect(righe).toEqual([{ product_id: b.prodottoId, quantity: 2, unit_price: CARRELLO_DI_PROVA[0].price }]);

    // Il negozio lo vede: la sua campanella «Nuovo ordine» con il numero e la cifra.
    const { data: campanelle, error: errCampanelle } = await b.db
      .from('notifications')
      .select('title, body, link')
      .eq('user_id', b.negozio.id);
    expect(errCampanelle).toBeNull();
    const avviso = (campanelle ?? []).find((n) => String(n.link) === `/seller/orders/${id}`);
    expect(avviso, 'il negozio non ha nessuna campanella per l ordine nuovo').toBeTruthy();
    expect(String(avviso!.title)).toMatch(/Nuovo ordine/);
    expect(String(avviso!.body)).toContain(id.slice(0, 6).toUpperCase());
  });

  test('rifiuto del negozio su un ordine pagato: il rimborso esiste', async ({ request }) => {
    const stripe = stripeDiProva();
    const b = await preparaLaBottega();
    const { ordine, pagamento, totaleCents } = await ordinePagatoConLaCarta(request, b, stripe);

    const rifiuto = await request.post(`/api/seller/orders/${ordine.id}/reject`, {
      data: { reason: 'Prova automatica: merce finita' },
      headers: conGettone(b.negozio),
    });
    expect(rifiuto.status(), `il negozio non riesce a rifiutare l'ordine pagato: ${await rifiuto.text()}`).toBe(200);
    const refundId = ((await rifiuto.json()) as { refundId?: string | null }).refundId ?? '';
    expect(refundId, 'rifiutato un ordine pagato senza nessun rimborso').toMatch(/^re_/);

    // Il rimborso è registrato sull'ordine…
    const dopo = await leggiOrdine(b.db, 'id', ordine.id);
    expect(dopo.delivery_status).toBe('CANCELED');
    expect(dopo.payment_status).toBe('REFUNDED');
    expect(String(dopo.stripe_refund_id ?? '')).toContain(refundId);
    expect(dopo.refunded_amount_cents).toBe(totaleCents);

    // …ed esiste su Stripe, sul pagamento giusto e per tutto l'importo.
    const rimborso = await stripe.refunds.retrieve(refundId);
    expect(rimborso.payment_intent).toBe(pagamento.id);
    expect(rimborso.amount).toBe(totaleCents);
    expect(['succeeded', 'pending']).toContain(rimborso.status);

    // E il cliente lo sa.
    const { data: avvisi } = await b.db.from('notifications').select('title, body').eq('user_id', b.cliente.id);
    expect((avvisi ?? []).some((n) => /rifiutato dal negozio/i.test(String(n.title)) && /rimborsato/i.test(String(n.body)))).toBe(true);
  });

  test('consegna completata: il bonifico al negozio parte', async ({ request }) => {
    const stripe = stripeDiProva();
    const b = await preparaLaBottega(AMBIENTE.contoNegozio);
    const { ordine } = await ordinePagatoConLaCarta(request, b, stripe);
    expect(ordine.payout_status, 'i soldi del negozio devono restare fermi fino alla consegna').toBe('HELD');
    expect(ordine.seller_payout_cents ?? 0).toBeGreaterThan(0);
    expect(ordine.stripe_charge_id, 'senza l addebito il bonifico parte dal saldo vuoto').toMatch(/^(ch|py)_/);

    // Consegnato due ore fa: oltre l'attesa del bonifico.
    const dueOreFa = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const { error: errConsegna } = await b.db
      .from('orders')
      .update({ delivery_status: 'DELIVERED', accepted_at: dueOreFa, picked_up_at: dueOreFa, delivered_at: dueOreFa })
      .eq('id', ordine.id);
    expect(errConsegna, `la consegna di prova non si scrive: ${errConsegna?.message}`).toBeNull();

    const giro = await request.post('/api/cron/release-payouts?a_mano=1', {
      headers: { authorization: `Bearer ${AMBIENTE.cron}` },
    });
    expect(giro.status(), `il giro dei bonifici non parte: ${await giro.text()}`).toBe(200);

    const dopo = await leggiOrdine(b.db, 'id', ordine.id);
    expect(dopo.payout_status, 'consegnato e pagato, ma il bonifico al negozio non è partito').toBe('TRANSFERRED');
    expect(dopo.stripe_transfer_id).toMatch(/^tr_/);

    const trasferimento = await stripe.transfers.retrieve(dopo.stripe_transfer_id!);
    expect(trasferimento.destination).toBe(AMBIENTE.contoNegozio);
    expect(trasferimento.amount).toBe(ordine.seller_payout_cents);
    expect(trasferimento.source_transaction).toBe(ordine.stripe_charge_id);
  });
});
