/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';
import { OGGI, DOPO_LA_161, PROFILI_CHIUSI_VISTA_VECCHIA, type Mondo } from './aiuti/database-coi-permessi';
import { databaseDegliOrdini, type DatiOrdini } from './aiuti/database-degli-ordini-coi-permessi';

/**
 * 18/10/2026 (seconda ondata, squadra ordini) — GLI ORDINI DEVONO SAPERE DI CHE NEGOZIO SONO ANCHE
 * QUANDO LA TABELLA DEI PROFILI SI CHIUDE.
 *
 * In produzione mancano 48 migrazioni; tre (110, 112, 161) chiudono la lettura di `profiles`: dopo,
 * ognuno legge solo la propria riga. Le pagine degli ordini agganciavano il negozio proprio li'
 * (`seller:profiles!orders_seller_id_fkey`). Dopo la chiusura, per il cliente: «Negozio» al posto del
 * nome in «I miei ordini», nella recensione, nel reclamo e in «Ordina di nuovo»; nessun telefono per
 * chiamare il negozio dal dettaglio dell'ordine; «Utente» in chat al posto del negozio. Per il
 * fattorino: nessun nome, indirizzo e telefono del negozio dove ritirare, e «Naviga» senza meta.
 *
 * Qui ogni pagina si MONTA. La lettura scritta dentro la pagina gira contro un database finto che
 * applica le regole di chi guarda, in tre mondi: quello di oggi in produzione, quello dopo le
 * migrazioni, e quello piu' stretto (profili chiusi e vista ancora senza le colonne della 126). Poi
 * la pagina si disegna con quelle risposte, e si guarda cosa c'e' a schermo. Se una pagina torna ad
 * agganciare il negozio a `profiles`, nei due mondi chiusi il nome sparisce e la prova diventa rossa.
 */

const PANE = 'n-pane';
const SALUMI = 'n-salumi';
const SOSPESO = 'n-sospeso';
const MARIA = 'u-maria';
const LUCA = 'u-luca';
const ANNA = 'u-anna';

const O_PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const O_SALUMI = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const O_SOSPESO = 'cccccccc-3333-4333-8333-cccccccccccc';
const CONV = 'dddddddd-4444-4444-8444-dddddddddddd';
const CONV_SALUMI = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';

const LOGO_PANE = 'https://esempio.supabase.co/storage/v1/object/public/loghi/pane.png';

function ordine(sopra: Record<string, unknown>) {
  return {
    total_price: 24, shipping_cost: 0, delivery_fee_cents: 0, discount_amount: 0, wallet_applied_cents: 0,
    gross_total_cents: 2400, refunded_amount_cents: 0, rider_fee_cents: 300,
    pickup_in_store: false, payment_status: 'PAID', payment_method: 'card', stripe_refund_id: null,
    accepted_at: '2026-10-17T10:05:00Z', ready_at: null, picked_up_at: null, delivered_at: null, canceled_at: null,
    cash_confirmed_at: null,
    delivery_full_name: 'Maria Rossi', delivery_phone: '333 1234567', delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza', delivery_zip: '29121', delivery_notes: null,
    delivery_lat: 45.0411, delivery_lng: 9.7012,
    rider_lat: null, rider_lng: null, rider_position_updated_at: null,
    ...sopra,
  };
}

function dati(): DatiOrdini {
  return {
    profiles: [
      {
        id: PANE, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Pane Quotidiano',
        store_address: 'Via Roma 1, Piacenza', store_phone: '0523 000000', store_logo: LOGO_PANE,
        store_lat: 45.0526, store_lng: 9.693, full_name: 'Giovanni Forno', billing_iban: 'IT60X0542811101000000123456',
        business_legal_name: 'Pane Quotidiano', business_form: 'S.r.l.', business_vat_number: '01234567890',
        business_address: 'Via Roma 1', business_city: 'Piacenza', business_zip: '29121',
      },
      {
        id: SALUMI, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Salumeria Due',
        store_address: 'Via Po 2, Piacenza', store_phone: '0523 111111', store_logo: null, store_lat: 45.06, store_lng: 9.7,
      },
      {
        // Sospeso DOPO che i suoi ordini sono partiti: la vetrina non lo mostra piu'.
        id: SOSPESO, role: 'seller', is_approved: false, approval_status: 'suspended', store_name: 'Bottega Sospesa',
        store_address: 'Via Chiusa 3, Piacenza', store_phone: '0523 999999', store_lat: 45.07, store_lng: 9.71,
      },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi' },
      { id: LUCA, role: 'rider', is_approved: true, store_name: null, full_name: 'Luca Verdi', rider_is_online: true, rider_zones: [] },
      { id: ANNA, role: 'rider', is_approved: true, store_name: null, full_name: 'Anna Neri', rider_is_online: true, rider_zones: [] },
    ],
    orders: [
      ordine({ id: O_PANE, user_id: MARIA, seller_id: PANE, rider_id: LUCA, delivery_status: 'ASSIGNED', created_at: '2026-10-17T10:00:00Z' }),
      ordine({
        id: O_SALUMI, user_id: MARIA, seller_id: SALUMI, rider_id: null, delivery_status: 'DELIVERED',
        created_at: '2026-10-16T09:00:00Z', delivered_at: '2026-10-16T11:00:00Z', total_price: 18, gross_total_cents: 1800,
      }),
      ordine({ id: O_SOSPESO, user_id: MARIA, seller_id: SOSPESO, rider_id: ANNA, delivery_status: 'ASSIGNED', created_at: '2026-10-15T08:00:00Z' }),
    ],
    order_items: [
      { id: 'r1', order_id: O_PANE, quantity: 2, unit_price: 12, product_id: 'p-focaccia', product_name: 'Focaccia', product_image: null },
      { id: 'r2', order_id: O_SALUMI, quantity: 1, unit_price: 18, product_id: 'p-coppa', product_name: 'Coppa piacentina', product_image: null },
      { id: 'r3', order_id: O_SOSPESO, quantity: 1, unit_price: 24, product_id: 'p-torta', product_name: 'Torta', product_image: null },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia', images: ['f.jpg'] },
      { id: 'p-coppa', name: 'Coppa piacentina', images: ['c.jpg'] },
      { id: 'p-torta', name: 'Torta', images: null },
    ],
    conversations: [
      {
        id: CONV, buyer_id: MARIA, seller_id: PANE, last_message_at: '2026-10-17T09:00:00Z',
        last_message_preview: 'A che ora chiudete?', buyer_unread_count: 1, seller_unread_count: 0,
      },
      {
        id: CONV_SALUMI, buyer_id: MARIA, seller_id: SALUMI, last_message_at: '2026-10-16T18:00:00Z',
        last_message_preview: 'Avete la coppa stagionata?', buyer_unread_count: 0, seller_unread_count: 0,
      },
    ],
    messages: [
      { id: 'm1', conversation_id: CONV, sender_id: MARIA, body: 'A che ora chiudete?', created_at: '2026-10-17T09:00:00Z', read_at: null },
    ],
  };
}

const MONDI: Array<[string, Mondo]> = [
  ['oggi in produzione', OGGI],
  ['dopo le migrazioni', DOPO_LA_161],
  ['profili chiusi e vista senza la 126', PROFILI_CHIUSI_VISTA_VECCHIA],
];

const globale = globalThis as Record<string, unknown>;

type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };
type Schermo = ReturnType<typeof accendi>;

/**
 * Monta la pagina, esegue le letture che la pagina stessa chiede (la sua `queryFn`, scritta dentro
 * la pagina), la rimonta con le risposte e la restituisce accesa. Qui non si chiama nessuna funzione
 * di lettura a mano. Le letture che cadono (per esempio quelle che vanno in rete) restano senza
 * risposta, e il loro errore si annota.
 */
async function aSchermo(
  file: string,
  props: Record<string, unknown>,
  mondo: Mondo,
  chi: string | null,
  d = dati(),
  opzioni: { vistaGiu?: boolean } = {},
) {
  const pagina = (await monta(file)).default;
  globale.__CLIENT_SUPABASE__ = databaseDegliOrdini(d, mondo, chi, opzioni).client;
  globale.__UTENTE__ = chi ? { id: chi } : null;
  globale.__PROFILO__ = { isAuthenticated: !!chi, isRider: chi === LUCA || chi === ANNA, profile: { full_name: 'Chi guarda' } };

  const risposte = new Map<string, unknown>();
  const errori = new Map<string, string>();
  const chieste = new Map<string, Opzioni>();
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    if (o.enabled !== false && o.queryFn && !risposte.has(k) && !errori.has(k)) chieste.set(k, o);
    return risposte.get(k);
  };
  // Una lettura caduta arriva alla pagina come la darebbe react-query: isError vero, nessun dato.
  globale.__ESITO_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    return errori.has(k) ? { isError: true, isSuccess: false, data: undefined, error: new Error(errori.get(k)) } : undefined;
  };

  for (let giro = 0; giro < 5; giro += 1) {
    const s = accendi(pagina, props);
    await attendi();
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k) && !errori.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      try {
        risposte.set(k, await o.queryFn!({ queryKey: o.queryKey, meta: undefined }));
      } catch (e) {
        errori.set(k, e instanceof Error ? e.message : JSON.stringify(e));
      }
    }
  }

  const s = accendi(pagina, props);
  await attendi();
  await attendi();
  return { s, errori };
}

/** Lascia girare gli effetti finche' la condizione non e' vera (o finiscono i giri). */
async function attendiFinche(s: Schermo, condizione: () => boolean) {
  for (let i = 0; i < 40 && !condizione(); i += 1) await attendi();
  return testoVisibile(s.radice);
}

function collegamento(s: Schermo, testo: string): HTMLAnchorElement | undefined {
  return Array.from(s.radice.querySelectorAll('a')).find(
    (a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim() === testo,
  ) as HTMLAnchorElement | undefined;
}

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__', '__ESITO_QUERY__', '__PROFILO__']) delete globale[k];
  document.body.innerHTML = '';
});

describe('la controprova: il database finto chiude davvero', () => {
  it.each(MONDI)('la vecchia lettura del negozio dentro l ordine — %s', async (_n, mondo) => {
    const { client } = databaseDegliOrdini(dati(), mondo, MARIA);
    const { data } = await client
      .from('orders')
      .select('id, seller:profiles!orders_seller_id_fkey ( store_name )')
      .eq('id', O_PANE)
      .single();
    const negozio = (data as { seller: { store_name: string } | null }).seller;
    if (mondo.profiliApertiAgliEstranei) expect(negozio?.store_name).toBe('Pane Quotidiano');
    else expect(negozio, 'con profiles chiusa la vecchia lettura dovrebbe tornare vuota: il finto non chiude').toBeNull();
  });
});

describe('il cliente', () => {
  it.each(MONDI)('«I miei ordini» dice il nome di ogni negozio, e il logo — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/orders/page.tsx', {}, mondo, MARIA);
    const testo = testoVisibile(s.radice);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    // Due negozi diversi: un elenco che desse a tutti gli ordini il primo negozio resterebbe verde
    // con un negozio solo in scena.
    expect(testo, 'il nome del forno e sparito dall elenco degli ordini').toContain('Pane Quotidiano');
    expect(testo, 'il nome della salumeria e sparito dall elenco degli ordini').toContain('Salumeria Due');
    // Il negozio sospeso non si mostra, come la vetrina non lo mostra (oggi come dopo).
    expect(testo).not.toContain('Bottega Sospesa');
    expect(testo, 'gli ordini in elenco non sono tre').toContain('3 ordini');
    // Ma il suo ordine resta: un elenco che scartasse le righe senza negozio lo farebbe sparire.
    for (const id of [O_PANE, O_SALUMI, O_SOSPESO]) {
      // testoVisibile separa «#» dal codice con uno spazio: si cerca il codice da solo.
      expect(testo, `l ordine #${id.slice(0, 6).toUpperCase()} e sparito dall elenco`).toContain(id.slice(0, 6).toUpperCase());
    }
    const loghi = Array.from(s.radice.querySelectorAll('img')).map((i) => i.getAttribute('src') ?? '');
    expect(loghi.some((src) => src.includes('pane.png')), 'il logo del forno e sparito').toBe(true);
    s.smonta();
  }, 60000);

  it.each(MONDI)('il dettaglio dell ordine mostra il negozio e fa chiamare il suo telefono — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/orders/[id]/page.tsx', { params: { id: O_PANE } }, mondo, MARIA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    expect(testoVisibile(s.radice)).toContain('Pane Quotidiano');

    const contatta = Array.from(s.radice.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Contatta il negozio'));
    expect(contatta, 'il pulsante per chiamare il negozio e sparito: manca il telefono').toBeTruthy();
    s.agisci(() => clicca(contatta!));
    await attendi();
    const finestra = s.radice.querySelector('[role="dialog"]');
    expect(finestra?.getAttribute('aria-label')).toBe('Contatta Pane Quotidiano');
    const chiama = finestra?.querySelector('a[href^="tel:"]');
    expect(chiama?.getAttribute('href'), 'il cliente non puo chiamare il negozio').toBe('tel:0523000000');
    s.smonta();
  }, 60000);

  it.each(MONDI)('la recensione dice quale negozio si sta valutando — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/orders/[id]/review/page.tsx', { params: { id: O_SALUMI } }, mondo, MARIA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    expect(testoVisibile(s.radice)).toContain('Salumeria Due');
    s.smonta();
  }, 60000);

  it.each(MONDI)('il reclamo dice contro quale negozio si apre — %s', async (_n, mondo) => {
    const { s } = await aSchermo('app/orders/[id]/dispute/page.tsx', { params: { id: O_SALUMI } }, mondo, MARIA);
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('Apri un reclamo'));
    expect(testo, 'il modulo del reclamo non si e aperto').toContain('Apri un reclamo');
    const riga = Array.from(s.radice.querySelectorAll('p')).find((p) => (p.textContent ?? '').startsWith('Ordine #'));
    expect(riga?.textContent).toBe(`Ordine #${O_SALUMI.slice(0, 8)} · Salumeria Due`);
    s.smonta();
  }, 60000);

  it.each(MONDI)('«Ordina di nuovo» in home dice da che negozio riordinare — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('components/home-sections/ReorderRail.tsx', {}, mondo, MARIA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = testoVisibile(s.radice);
    expect(testo, 'la fascia «Ordina di nuovo» non si e disegnata').toContain('Ordina di nuovo');
    expect(testo).toContain('Pane Quotidiano');
    expect(testo).toContain('Salumeria Due');
    s.smonta();
  }, 60000);

  it.each(MONDI)('in chat, il cliente vede a quale negozio sta scrivendo — elenco · %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/page.tsx', {}, mondo, MARIA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('A che ora chiudete?'));
    expect(testo, 'l elenco delle conversazioni non si e disegnato').toContain('A che ora chiudete?');
    expect(testo).not.toContain('Utente');
    // Due conversazioni con due negozi: ogni riga porta l'insegna del SUO negozio. Con una
    // conversazione sola, un'insegna attaccata alla conversazione sbagliata resterebbe verde.
    const riga = (anteprima: string) => {
      const nodi = Array.from(s.radice.querySelectorAll('a, li, button')).filter((n) => (n.textContent ?? '').includes(anteprima));
      return nodi.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length)[0]?.textContent ?? '';
    };
    const delForno = riga('A che ora chiudete?');
    const dellaSalumeria = riga('Avete la coppa stagionata?');
    expect(delForno, 'la conversazione col forno non porta il suo negozio').toContain('Pane Quotidiano');
    expect(delForno).not.toContain('Salumeria Due');
    expect(dellaSalumeria, 'la conversazione con la salumeria non porta il suo negozio').toContain('Salumeria Due');
    expect(dellaSalumeria).not.toContain('Pane Quotidiano');
    s.smonta();
  }, 60000);

  it.each(MONDI)('in chat, il cliente vede a quale negozio sta scrivendo — conversazione · %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/[id]/page.tsx', { params: { id: CONV } }, mondo, MARIA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    await attendiFinche(s, () => !!s.radice.querySelector('h2'));
    expect(s.radice.querySelector('h2')?.textContent, 'in testa alla chat non c e il negozio').toBe('Pane Quotidiano');
    s.smonta();
  }, 60000);
});

describe('il fattorino', () => {
  it.each(MONDI)('al ritiro vede nome e indirizzo del negozio, e «Naviga» e «Chiama» portano al negozio — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/rider/orders/[id]/page.tsx', { params: { id: O_PANE } }, mondo, LUCA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('Ritira al negozio');
    expect(testo).toContain('Pane Quotidiano');
    expect(testo).toContain('Via Roma 1, Piacenza');
    expect(collegamento(s, 'Naviga')?.getAttribute('href'), '«Naviga» non porta al negozio').toBe(
      'https://www.google.com/maps/dir/?api=1&destination=45.0526,9.693',
    );
    expect(collegamento(s, 'Chiama')?.getAttribute('href'), '«Chiama» non chiama il negozio').toBe('tel:0523 000000');
    expect(testo).not.toContain('Non so dove ritirare');
    s.smonta();
  }, 60000);

  it.each(MONDI)('dopo il ritiro «Naviga» e «Chiama» passano al cliente, come prima — %s', async (_n, mondo) => {
    const d = dati();
    Object.assign(d.orders[0], { delivery_status: 'PICKED_UP', picked_up_at: '2026-10-17T10:30:00Z' });
    const { s } = await aSchermo('app/rider/orders/[id]/page.tsx', { params: { id: O_PANE } }, mondo, LUCA, d);
    expect(testoVisibile(s.radice)).toContain('Consegna al cliente');
    expect(collegamento(s, 'Naviga')?.getAttribute('href')).toBe('https://www.google.com/maps/dir/?api=1&destination=45.0411,9.7012');
    expect(collegamento(s, 'Chiama')?.getAttribute('href')).toBe('tel:333 1234567');
    s.smonta();
  }, 60000);

  it.each(MONDI)('un negozio sospeso a ordine in corso: gli si dice di chiedere all assistenza, non un riquadro vuoto — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/rider/orders/[id]/page.tsx', { params: { id: O_SOSPESO } }, mondo, ANNA);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = testoVisibile(s.radice);
    expect(testo, 'la pagina della consegna non si e disegnata').toContain('Ritira al negozio');
    expect(testo, 'il fattorino resta senza sapere dove ritirare, in silenzio').toContain('Non so dove ritirare questo ordine');
    expect(testo).toContain("chiedi all'assistenza dove ritirare");
    expect(collegamento(s, 'Contatta l\'assistenza')?.getAttribute('href')).toBe('/rider/help');
    // Niente pulsanti che portano da qualche parte a caso.
    expect(collegamento(s, 'Naviga')).toBeUndefined();
    expect(collegamento(s, 'Chiama')).toBeUndefined();
    s.smonta();
  }, 60000);

  it.each(MONDI)('in bacheca la consegna in corso dice da che negozio parte — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/rider/page.tsx', {}, mondo, LUCA);
    // Gli incassi da confermare si leggono in rete (qui vietata): conta solo la lettura delle consegne.
    expect(errori.get(JSON.stringify(['rider', 'orders']))).toBeUndefined();
    const testo = testoVisibile(s.radice);
    expect(testo, 'la consegna in corso non si e disegnata').toContain('La tua consegna');
    expect(testo).toContain('Pane Quotidiano');
    s.smonta();
  }, 60000);
});

/**
 * Riesame del lotto, 18/10/2026: la vista dei negozi e' una seconda domanda, dopo quella
 * principale. Se cadeva lei sola, la bacheca del fattorino (interruttore online compreso), la chat
 * e «Ordina di nuovo» passavano per intero allo stato d'errore. Qui la vista risponde con un errore
 * e tutto il resto si legge: le pagine restano in piedi, senza il nome del negozio.
 */
describe('se la vetrina dei negozi non risponde', () => {
  const GIU = { vistaGiu: true };

  it.each(MONDI)('la bacheca del fattorino resta in piedi, con la sua consegna — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/rider/page.tsx', {}, mondo, LUCA, dati(), GIU);
    expect(errori.get(JSON.stringify(['rider', 'orders'])), 'un guasto della sola vista ha spento la bacheca').toBeUndefined();
    const testo = testoVisibile(s.radice);
    expect(testo, 'la consegna in corso e sparita').toContain('La tua consegna');
    expect(testo).not.toContain('Pane Quotidiano');
    s.smonta();
  }, 60000);

  it.each(MONDI)('il cliente legge le sue conversazioni — elenco · %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/page.tsx', {}, mondo, MARIA, dati(), GIU);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(s, () => (s.radice.textContent ?? '').includes('A che ora chiudete?'));
    expect(testo, 'un guasto della sola vista ha spento l elenco dei messaggi').toContain('A che ora chiudete?');
    expect(testo).toContain('Avete la coppa stagionata?');
    s.smonta();
  }, 60000);

  it.each(MONDI)('il cliente legge la conversazione — %s', async (_n, mondo) => {
    const { s, errori } = await aSchermo('app/messages/[id]/page.tsx', { params: { id: CONV } }, mondo, MARIA, dati(), GIU);
    expect(errori.size, [...errori.values()].join(' · ')).toBe(0);
    const testo = await attendiFinche(s, () => !!s.radice.querySelector('h2'));
    expect(s.radice.querySelector('h2'), 'un guasto della sola vista ha spento la conversazione').toBeTruthy();
    expect(testo).not.toContain('Non riusciamo a caricare');
    s.smonta();
  }, 60000);

  it.each(MONDI)('dalla bacheca alla consegna: la pagina dice di riprovare, non che l ordine non esiste — %s', async (_n, mondo) => {
    // Qui il negozio e' il cuore della pagina: senza, il fattorino non sa dove andare. La pagina non
    // si disegna senza negozio, e non dice «Ordine non trovato»: rimanderebbe alla bacheca, che la
    // consegna la mostra ancora, in un giro senza uscita.
    const { s, errori } = await aSchermo('app/rider/orders/[id]/page.tsx', { params: { id: O_PANE } }, mondo, LUCA, dati(), GIU);
    expect(errori.size, 'la consegna senza negozio si e disegnata come se fosse tutto a posto').toBeGreaterThan(0);
    const testo = testoVisibile(s.radice);
    expect(testo).toContain('Non riesco a leggere la consegna');
    expect(testo).not.toContain('Ordine non trovato');
    const riprova = Array.from(s.radice.querySelectorAll('button')).find((b) => /riprova/i.test(b.textContent ?? ''));
    expect(riprova, 'manca il pulsante per riprovare').toBeTruthy();
    s.smonta();
  }, 60000);

  it.each(MONDI)('una consegna che non e del fattorino dice «Ordine non trovato», non «Riprova» — %s', async (_n, mondo) => {
    // Zero righe non e' un guasto. La consegna del negozio sospeso e' di Anna: Luca non la vede
    // (riassegnata, vecchia, link sbagliato). Con la vista giu' o su, la risposta e' la stessa.
    for (const [id, opzioni] of [[O_SOSPESO, {}], [O_SOSPESO, GIU], ['ffffffff-9999-4999-8999-ffffffffffff', {}]] as const) {
      const { s } = await aSchermo('app/rider/orders/[id]/page.tsx', { params: { id } }, mondo, LUCA, dati(), opzioni);
      const testo = testoVisibile(s.radice);
      expect(testo, `consegna ${id.slice(0, 8)}: doveva dire che non c'e`).toContain('Ordine non trovato');
      expect(testo).not.toContain('Non riesco a leggere la consegna');
      s.smonta();
    }
  }, 60000);

  it.each(MONDI)('«Ordina di nuovo» con la vista giu non si disegna con «Negozio» al posto dei nomi — %s', async (_n, mondo) => {
    // La fascia legge il negozio in modo severo: se la vista cade, la fascia non compare, come
    // prima del lotto. Mostrarla con «Negozio» su ogni scheda per cinque minuti sarebbe peggio.
    const { s } = await aSchermo('components/home-sections/ReorderRail.tsx', {}, mondo, MARIA, dati(), GIU);
    const testo = testoVisibile(s.radice);
    expect(testo).not.toContain('Ordina di nuovo');
    expect(testo).not.toContain('Negozio');
    s.smonta();
  }, 60000);

  it.each(MONDI)('le pagine dell ordine del cliente dicono di riprovare — %s', async (_n, mondo) => {
    // Anche qui il negozio e' il cuore: un ordine senza negozio a schermo sembrerebbe la verita'.
    const elenco = await aSchermo('app/orders/page.tsx', {}, mondo, MARIA, dati(), GIU);
    expect(testoVisibile(elenco.s.radice)).toContain('Impossibile caricare gli ordini');
    elenco.s.smonta();
    const dettaglio = await aSchermo('app/orders/[id]/page.tsx', { params: { id: O_PANE } }, mondo, MARIA, dati(), GIU);
    expect(testoVisibile(dettaglio.s.radice)).toContain("Non riesco a caricare l'ordine");
    dettaglio.s.smonta();
  }, 60000);
});

