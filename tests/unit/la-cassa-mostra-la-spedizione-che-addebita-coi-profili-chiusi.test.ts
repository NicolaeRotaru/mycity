/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';
import {
  databaseCoiPermessi,
  OGGI,
  DOPO_LA_161,
  PROFILI_CHIUSI_VISTA_VECCHIA,
  type Mondo,
  type Dati,
} from './aiuti/database-coi-permessi';
import { formatPrice } from '@/lib/format';
import { SHIPPING_PER_ORDER } from '@/lib/constants';
import { shippingForEuro } from '@/lib/shipping';
import { getCart } from '@/lib/cart';

/**
 * 18/10/2026 — IL CARRELLO E LA CASSA MOSTRANO LA SPEDIZIONE CHE IL SERVER ADDEBITA, ANCHE
 * QUANDO LA TABELLA DEI PROFILI SI CHIUDE.
 *
 * Passo indietro. La spedizione dipende dalla distanza fra il negozio e la casa del cliente:
 * 2,50 € più 1,20 € al chilometro. Senza le coordinate del negozio si paga la tariffa fissa,
 * 4,90 €. Il carrello e la cassa le coordinate del negozio le chiedevano a `profiles`; le due
 * rotte che creano l'ordine (contanti e carta) le chiedono alla vista `seller_public_profiles`.
 *
 * Oggi le due strade rispondono uguale. Dopo le migrazioni 110, 112 e 161 no: `profiles`, a un
 * cliente, restituisce solo la sua riga. Il carrello e la cassa avrebbero mostrato 4,90 € e il
 * server avrebbe addebitato la distanza. Un esempio: Pane Quotidiano in centro, Maria a circa
 * 2,4 km, una focaccia da 8 €. Il pulsante dice un totale, l'ordine in contanti ne chiede un
 * altro, e Maria lo scopre dal fattorino sulla porta.
 *
 * Qui le due pagine si MONTANO davvero contro un database finto che risponde come risponde a
 * Maria, nel mondo di oggi e nei due mondi dopo la chiusura. Poi la rotta vera dei contanti
 * crea l'ordine contro LO STESSO database finto, e si confronta la spedizione scritta
 * sull'ordine con quella che le due pagine hanno mostrato: devono essere uguali al centesimo.
 * Se una delle due pagine torna a chiedere il negozio a `profiles`, la prova diventa rossa.
 *
 * In fondo c'è anche la lista condivisa su WhatsApp, che agganciava il nome del negozio a
 * `profiles`: a tabella chiusa ogni prodotto diceva «Negozio».
 */

const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
/** Approvato, con prodotti in vendita, ma senza insegna: la vista non lo restituisce. */
const SENZA_INSEGNA = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const MARIA = 'cccccccc-3333-4333-8333-cccccccccccc';
const FOCACCIA = 'dddddddd-4444-4444-8444-dddddddddddd';
const MIELE = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';

const NEGOZIO_IN_CENTRO = { lat: 45.0526, lng: 9.6929 };
const CASA_DI_MARIA = { lat: 45.0701, lng: 9.712 };
const INDIRIZZO_DI_MARIA = {
  fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567',
};

function dati(): Dati {
  return {
    profiles: [
      {
        id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano',
        store_lat: NEGOZIO_IN_CENTRO.lat, store_lng: NEGOZIO_IN_CENTRO.lng, store_hours: null,
      },
      {
        id: SENZA_INSEGNA, role: 'seller', is_approved: true, store_name: null,
        store_lat: 45.03, store_lng: 9.66, store_hours: null,
      },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi', wallet_balance_cents: 0 },
    ],
    products: [
      {
        id: FOCACCIA, name: 'Focaccia al rosmarino', price: 8, images: null, seller_id: PANE,
        status: 'available', stock: 10, has_variants: false, express_enabled: false,
      },
      {
        id: MIELE, name: 'Miele di acacia', price: 6, images: null, seller_id: SENZA_INSEGNA,
        status: 'available', stock: 10, has_variants: false, express_enabled: false,
      },
    ],
    user_addresses: [
      {
        id: 'ind-1', user_id: MARIA, full_name: INDIRIZZO_DI_MARIA.fullName, address: INDIRIZZO_DI_MARIA.address,
        city: INDIRIZZO_DI_MARIA.city, zip: INDIRIZZO_DI_MARIA.zip, phone: INDIRIZZO_DI_MARIA.phone, notes: null,
        lat: CASA_DI_MARIA.lat, lng: CASA_DI_MARIA.lng, is_default: true,
      },
    ],
    // Una riga di un altro cliente: serve solo a far esistere le colonne della tabella.
    pending_checkouts: [{ buyer_id: 'altro-cliente', status: 'PENDING', groups: [] }],
  };
}

const RPC = { product_active_discounts: () => [] };

const MONDI: Array<[string, Mondo]> = [
  ['oggi', OGGI],
  ['dopo la 161', DOPO_LA_161],
  ['profili chiusi e vista senza la 126', PROFILI_CHIUSI_VISTA_VECCHIA],
];

const globale = globalThis as Record<string, unknown>;

type RigaCarrello = { id: string; name: string; price: number; quantity: number; sellerId: string; storeName?: string };
const UNA_FOCACCIA: RigaCarrello[] = [
  { id: FOCACCIA, name: 'Focaccia al rosmarino', price: 8, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' },
];
const FOCACCIA_E_MIELE: RigaCarrello[] = [
  ...UNA_FOCACCIA,
  { id: MIELE, name: 'Miele di acacia', price: 6, quantity: 1, sellerId: SENZA_INSEGNA },
];

/** Un importo come lo legge una persona: lo spazio prima di «€» qualunque esso sia. */
const euro = (n: number) => formatPrice(n).replace(/\s+/g, ' ');

/** Le cifre scritte accanto a «Spedizione», in ogni riepilogo della pagina. */
function spedizioniMostrate(radice: HTMLElement): string[] {
  const cifre: string[] = [];
  for (const riga of Array.from(radice.querySelectorAll('div'))) {
    const figli = Array.from(riga.children);
    if (figli.length !== 2) continue;
    const etichetta = Array.from(figli[0].childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (!/^Spedizione/.test(etichetta)) continue;
    cifre.push(testoVisibile(figli[1]));
  }
  return cifre;
}

async function finoA(condizione: () => boolean, giri = 40) {
  for (let i = 0; i < giri && !condizione(); i += 1) await attendi();
}

/**
 * Il database con la vista che non risponde: la domanda a `seller_public_profiles` torna con un
 * errore (un tempo scaduto), tutte le altre rispondono come prima.
 */
function conLaVistaGiu(client: ReturnType<typeof databaseCoiPermessi>['client']) {
  const giu = () => {
    const risposta = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq']) c[m] = () => c;
    c.then = (risolvi: (r: unknown) => unknown) => Promise.resolve(risposta).then(risolvi);
    return c;
  };
  return { ...client, from: (t: string) => (t === 'seller_public_profiles' ? giu() : client.from(t)) };
}

function preparaIlMondo(mondo: Mondo, carrello: RigaCarrello[], opzioni: { vistaGiu?: boolean } = {}) {
  const db = databaseCoiPermessi(dati(), mondo, MARIA, RPC);
  globale.__CLIENT_SUPABASE__ = opzioni.vistaGiu ? conLaVistaGiu(db.client) : db.client;
  globale.__UTENTE__ = { id: MARIA, email: 'maria@test.it' };
  localStorage.setItem('cart', JSON.stringify(carrello));
  return db;
}

/** Il carrello montato: la sua lettura gira contro il database finto, poi si legge cosa scrive. */
async function spedizioneNelCarrello(mondo: Mondo, carrello: RigaCarrello[], opzioni: { vistaGiu?: boolean } = {}) {
  const db = preparaIlMondo(mondo, carrello, opzioni);
  const pagina = (await monta('app/cart/page.tsx')).default;
  const s = accendi(pagina, {});
  await finoA(() => db.letture.includes('user_addresses') && /calcolata sul tuo|stima/.test(testoVisibile(s.radice)));
  await attendi();
  const cifre = spedizioniMostrate(s.radice);
  const testo = testoVisibile(s.radice);
  s.smonta();
  return { cifre, testo, letture: [...db.letture] };
}

type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };

/**
 * La cassa montata. Le sue letture passano da `useQuery`: qui si raccolgono quelle che la pagina
 * chiede, si eseguono (sono le funzioni scritte DENTRO la pagina) e la pagina si ridisegna con le
 * risposte, finché non chiede più niente di nuovo.
 */
async function spedizioneAllaCassa(mondo: Mondo, carrello: RigaCarrello[], opzioni: { vistaGiu?: boolean } = {}) {
  const db = preparaIlMondo(mondo, carrello, opzioni);
  const pagina = (await monta('app/checkout/page.tsx')).default;
  const risposte = new Map<string, unknown>();
  const errori = new Map<string, unknown>();
  const chieste = new Map<string, Opzioni>();
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    if (!risposte.has(k) && !errori.has(k)) chieste.set(k, o);
    return risposte.get(k);
  };
  globale.__ESITO_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    return errori.has(k) ? { isError: true, isSuccess: false, error: errori.get(k), data: undefined } : undefined;
  };

  for (let giro = 0; giro < 6; giro += 1) {
    const s = accendi(pagina, {});
    await attendi();
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k) && !errori.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      if (o.enabled === false || !o.queryFn) {
        chieste.delete(k);
        continue;
      }
      try {
        risposte.set(k, await o.queryFn({ queryKey: o.queryKey, meta: undefined }));
      } catch (e) {
        errori.set(k, e);
      }
    }
  }

  const s = accendi(pagina, {});
  await finoA(() => spedizioniMostrate(s.radice).length > 0);
  await attendi();
  const cifre = spedizioniMostrate(s.radice);
  const testo = testoVisibile(s.radice);
  s.smonta();
  return { cifre, testo, letture: [...db.letture], errori: [...errori.values()] };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * LA ROTTA VERA DEI CONTANTI, contro lo stesso database finto.
 * ────────────────────────────────────────────────────────────────────────────*/

const ordiniScritti: Array<Record<string, unknown>> = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _o: unknown,
      h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
    ) =>
    (req: unknown) =>
      h({
        user: { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: false },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => true),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessuno' })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'e1' })) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
  newOrderSellerTemplate: vi.fn(() => ({ subject: 's', html: 'h' })),
}));
vi.mock('@/lib/stripe/client', () => ({
  computeOrderSplit: vi.fn(() => ({ applicationFeeCents: 100, sellerPayoutCents: 900 })),
}));
vi.mock('@/lib/analytics/server', () => ({
  contaAcquisto: vi.fn(async () => {}),
  misuraAttiva: () => true,
  analyticsConsentita: vi.fn(async () => true),
}));
vi.mock('@/lib/supabase/server', () => {
  const g = globalThis as Record<string, unknown>;
  /** Tutto quello che il client di servizio scrive o legge e qui non conta: risponde vuoto. */
  const vuoto = (valore: unknown) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'lt', 'lte', 'gt', 'gte', 'order', 'limit', 'filter', 'insert', 'update', 'upsert', 'delete', 'not', 'or']) {
      b[m] = () => b;
    }
    b.single = () => Promise.resolve(valore);
    b.maybeSingle = () => Promise.resolve(valore);
    b.then = (risolvi: (v: unknown) => unknown) => Promise.resolve(valore).then(risolvi);
    return b;
  };
  const servizio = () => ({
    from: (tavola: string) => {
      // Gli indirizzi salvati si leggono dal database finto: sono le coordinate con cui il
      // server prezza la consegna.
      if (tavola === 'user_addresses') return (g.__DB_DEL_SERVER__ as { from: (t: string) => unknown }).from(tavola);
      if (tavola === 'orders') {
        return {
          insert: (riga: Record<string, unknown>) => {
            (g.__ORDINI_SCRITTI__ as Array<Record<string, unknown>>).push(riga);
            const id = `ord-${(g.__ORDINI_SCRITTI__ as unknown[]).length}`;
            return { select: () => ({ single: () => Promise.resolve({ data: { id }, error: null }) }) };
          },
          select: () => vuoto({ data: [], error: null }),
          update: () => vuoto({ data: null, error: null }),
          delete: () => vuoto({ error: null }),
        };
      }
      return vuoto({ data: [], error: null });
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
  });
  return {
    getAdminSupabase: servizio,
    // Il client della richiesta legge coi permessi di Maria: è lo stesso database finto delle pagine.
    getServerSupabase: async () => g.__DB_DEL_SERVER__,
  };
});

/** Quanto addebita il server, in euro, per questi gruppi: la somma di `shipping_cost` degli ordini creati. */
async function spedizioneAddebitata(mondo: Mondo, gruppi: Array<{ sellerId: string; items: Array<{ productId: string; quantity: number }> }>) {
  const db = databaseCoiPermessi(dati(), mondo, MARIA, RPC);
  globale.__DB_DEL_SERVER__ = db.client;
  ordiniScritti.length = 0;
  globale.__ORDINI_SCRITTI__ = ordiniScritti;
  const { POST } = await import('@/app/api/orders/cod/route');
  const risposta = await (POST as unknown as (req: never) => Promise<Response>)(
    new Request('http://localhost/api/orders/cod', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups: gruppi, delivery: INDIRIZZO_DI_MARIA, pickupInStore: false, useCredit: false }),
    }) as never,
  );
  const corpo = await risposta.json();
  expect(risposta.status, `la rotta dei contanti non ha creato l'ordine: ${JSON.stringify(corpo)}`).toBe(200);
  expect(db.letture, 'il server non legge più il negozio dalla vista').toContain('seller_public_profiles');
  return ordiniScritti.reduce((s, o) => s + Number(o.shipping_cost), 0);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__', '__DB_DEL_SERVER__', '__ORDINI_SCRITTI__', '__QUERY_FINTA__']) {
    delete globale[k];
  }
  localStorage.clear();
});

describe('la spedizione che il server addebita: la distanza fra Pane Quotidiano e la casa di Maria', () => {
  it('la scena regge: a quella distanza la spedizione NON è la tariffa fissa', () => {
    const aDistanza = shippingForEuro({
      subtotal: 8, storeLat: NEGOZIO_IN_CENTRO.lat, storeLng: NEGOZIO_IN_CENTRO.lng,
      deliveryLat: CASA_DI_MARIA.lat, deliveryLng: CASA_DI_MARIA.lng, pickupInStore: false,
    });
    expect(
      euro(aDistanza),
      'con la tariffa fissa uguale a quella sulla distanza la prova non distinguerebbe le due letture',
    ).not.toBe(euro(SHIPPING_PER_ORDER));
  });

  it.each(MONDI)('il server la addebita sulla distanza — %s', async (_n, mondo) => {
    const addebitata = await spedizioneAddebitata(mondo, [{ sellerId: PANE, items: [{ productId: FOCACCIA, quantity: 1 }] }]);
    expect(euro(addebitata)).not.toBe(euro(SHIPPING_PER_ORDER));
  });
});

describe('il carrello mostra la spedizione che il server addebita', () => {
  it.each(MONDI)('Pane Quotidiano, casa di Maria — %s', async (_n, mondo) => {
    const addebitata = await spedizioneAddebitata(mondo, [{ sellerId: PANE, items: [{ productId: FOCACCIA, quantity: 1 }] }]);
    const { cifre, testo } = await spedizioneNelCarrello(mondo, UNA_FOCACCIA);
    expect(cifre.length, `nel carrello non si trova la riga della spedizione: ${testo.slice(0, 400)}`).toBeGreaterThan(0);
    for (const c of cifre) {
      expect(c, 'il carrello mostra una spedizione e il server ne addebita un\'altra').toBe(euro(addebitata));
    }
    expect(testo, 'con tutti e due i punti noti il numero non è una stima').toContain('calcolata sul tuo indirizzo predefinito');
  }, 60000);
});

describe('la cassa mostra la spedizione che il server addebita', () => {
  it.each(MONDI)('Pane Quotidiano, casa di Maria — %s', async (_n, mondo) => {
    const addebitata = await spedizioneAddebitata(mondo, [{ sellerId: PANE, items: [{ productId: FOCACCIA, quantity: 1 }] }]);
    const { cifre, testo, errori } = await spedizioneAllaCassa(mondo, UNA_FOCACCIA);
    expect(errori, 'una lettura della cassa è caduta').toEqual([]);
    expect(cifre.length, `alla cassa non si trova la riga della spedizione: ${testo.slice(0, 400)}`).toBeGreaterThan(0);
    for (const c of cifre) {
      expect(c, 'la cassa mostra una spedizione e il server ne addebita un\'altra').toBe(euro(addebitata));
    }
  }, 60000);
});

describe('un negozio che la vista non restituisce: la spedizione è quella fissa, come la fa il server', () => {
  /**
   * Il negozio del miele è approvato e i suoi prodotti si comprano, ma non ha l'insegna: la vista
   * non lo restituisce. Il server allora non ha le sue coordinate e addebita la tariffa fissa.
   * Il carrello e la cassa non devono inventarne un'altra: mostrano la stessa.
   */
  const GRUPPI = [
    { sellerId: PANE, items: [{ productId: FOCACCIA, quantity: 1 }] },
    { sellerId: SENZA_INSEGNA, items: [{ productId: MIELE, quantity: 1 }] },
  ];

  it.each(MONDI)('il server: distanza per il fornaio, tariffa fissa per il miele — %s', async (_n, mondo) => {
    const addebitata = await spedizioneAddebitata(mondo, GRUPPI);
    const soloIlFornaio = await spedizioneAddebitata(mondo, [GRUPPI[0]]);
    expect(euro(addebitata - soloIlFornaio)).toBe(euro(SHIPPING_PER_ORDER));
  });

  it.each(MONDI)('il carrello mostra la somma che il server addebita, e la chiama stima — %s', async (_n, mondo) => {
    const addebitata = await spedizioneAddebitata(mondo, GRUPPI);
    const { cifre, testo } = await spedizioneNelCarrello(mondo, FOCACCIA_E_MIELE);
    expect(cifre.length, `nel carrello non si trova la riga della spedizione: ${testo.slice(0, 400)}`).toBeGreaterThan(0);
    for (const c of cifre) expect(c).toBe(euro(addebitata));
    expect(testo, 'senza le coordinate di un negozio il numero va detto come stima').toContain('stima · potrebbe variare al checkout');
  }, 60000);

  it.each(MONDI)('la cassa mostra la somma che il server addebita — %s', async (_n, mondo) => {
    const addebitata = await spedizioneAddebitata(mondo, GRUPPI);
    const { cifre, testo, errori } = await spedizioneAllaCassa(mondo, FOCACCIA_E_MIELE);
    expect(errori, 'una lettura della cassa è caduta').toEqual([]);
    expect(cifre.length, `alla cassa non si trova la riga della spedizione: ${testo.slice(0, 400)}`).toBeGreaterThan(0);
    for (const c of cifre) expect(c).toBe(euro(addebitata));
  }, 60000);
});

describe('se la vista non risponde, nessuna pagina indovina la spedizione', () => {
  it.each(MONDI)('il carrello si disegna lo stesso, con la tariffa fissa detta come stima — %s', async (_n, mondo) => {
    const { cifre, testo } = await spedizioneNelCarrello(mondo, UNA_FOCACCIA, { vistaGiu: true });
    expect(cifre.length, `il carrello non si disegna più: ${testo.slice(0, 400)}`).toBeGreaterThan(0);
    for (const c of cifre) expect(c).toBe(euro(SHIPPING_PER_ORDER));
    expect(testo).toContain('stima · potrebbe variare al checkout');
  }, 60000);

  it.each(MONDI)('la cassa non lascia ordinare e dice che non riesce a leggere — %s', async (_n, mondo) => {
    const { testo, errori } = await spedizioneAllaCassa(mondo, UNA_FOCACCIA, { vistaGiu: true });
    expect(errori.length, 'la lettura del negozio è caduta e la cassa ha fatto finta di niente').toBeGreaterThan(0);
    expect(testo, 'il pulsante d\'ordine resta acceso senza sapere quanto costa la consegna').toContain('Non puoi ancora ordinare');
    expect(testo).toContain('Non riusciamo a leggere i prodotti del carrello');
  }, 60000);
});

describe('la lista condivisa su WhatsApp prende il nome del negozio dalla vista', () => {
  /**
   * Chi apre il link può essere un visitatore senza account o una cliente: in tutti e due i casi,
   * a tabella chiusa, l'aggancio a `profiles` tornava vuoto e ogni prodotto diceva «Negozio».
   */
  const CHI: Array<[string, string | null]> = [
    ['visitatore', null],
    ['Maria', MARIA],
  ];
  const CASI = MONDI.flatMap(([m, mondo]) => CHI.map(([c, chi]) => [`${m} · ${c}`, mondo, chi] as const));

  async function apriLaLista(client: unknown, chi: string | null) {
    globale.__CLIENT_SUPABASE__ = client;
    globale.__UTENTE__ = chi ? { id: chi } : null;
    globale.__QUERY_FINTA__ = `cart=${FOCACCIA}:2,${MIELE}:1`;
    const pagina = (await monta('app/shared-cart/page.tsx')).default;
    const s = accendi(pagina, {});
    await finoA(() => /Aggiungi tutto|Non riesco/.test(testoVisibile(s.radice)));
    return s;
  }

  it.each(CASI)('la focaccia dice Pane Quotidiano ed entra nel carrello col suo negozio — %s', async (_n, mondo, chi) => {
    const s = await apriLaLista(databaseCoiPermessi(dati(), mondo, chi, RPC).client, chi);
    expect(testoVisibile(s.radice), 'la lista scrive «Negozio» al posto di Pane Quotidiano').toContain('Pane Quotidiano');

    const aggiungi = Array.from(s.radice.querySelectorAll('button')).find((b) => /aggiungi tutto/i.test(b.textContent ?? ''));
    expect(aggiungi, 'il pulsante che aggiunge la lista non c\'è più: questa prova non misura niente').toBeTruthy();
    s.agisci(() => clicca(aggiungi!));
    const carrello = getCart();
    const focaccia = carrello.find((r) => r.id === FOCACCIA);
    expect(focaccia?.sellerId).toBe(PANE);
    expect(focaccia?.storeName, 'la focaccia entra nel carrello senza il nome del negozio').toBe('Pane Quotidiano');
    // Il miele è di un negozio che la vista non restituisce: entra lo stesso, col suo negozio, come
    // lo accetterebbe la cassa — e senza un nome inventato.
    const miele = carrello.find((r) => r.id === MIELE);
    expect(miele?.sellerId).toBe(SENZA_INSEGNA);
    expect(miele?.storeName).toBeUndefined();
    s.smonta();
  }, 60000);

  it.each(MONDI)('se la vista non risponde la lista si dichiara non letta, non dimezzata — %s', async (_n, mondo) => {
    const s = await apriLaLista(conLaVistaGiu(databaseCoiPermessi(dati(), mondo, MARIA, RPC).client), MARIA);
    expect(testoVisibile(s.radice)).toContain('Non riesco a leggere la lista');
    s.smonta();
  }, 60000);
});
