/**
 * @vitest-environment jsdom
 */
/**
 * R04-012 (onda 2, 28/11/2026) — GLI ORARI ALLA CASSA, PROVATI FACENDO GIRARE LA PAGINA.
 *
 * `la-cassa-passa-gli-orari-dei-negozi-al-selettore-e-al-freno.test.ts` cercava parole nel sorgente
 * (`orariNegozi={orariNegozi}`, `orari: orariNegozi`): un filo staccato in un modo che non cambia le
 * parole passava. Qui la pagina di cassa si MONTA intera, con Pane Quotidiano (lun-sab 9-13 e
 * 16:30-19:30), lunedì 2/11/2026:
 *  ① la lettura del carrello chiede gli orari alla vetrina pubblica e li restituisce (eseguita);
 *  ② alle 14:00 il selettore non propone «Oggi · 13:00–16:30»: il forno è chiuso fino alle 16:30
 *     e il ritiro andrebbe oltre le 15:30 (per la sola regola dei 60 minuti sarebbe ancora buona);
 *  ③ scelta alle 12:00 (buona: si ritira entro le 12:45), alle 14:00 «Ordina» la ferma e lo dice,
 *     anche se la pagina non ha ridisegnato.
 * La rotta dei contanti ha la sua prova eseguita: riparazione-onda2-r04-012-contanti-409-fascia.test.ts.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    warning: () => undefined,
    error: (m: unknown) => { avvisi.errori.push(String(m)); },
  }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const GIORNO = [['09:00', '13:00'], ['16:30', '19:30']];
const ORARI_PQ = { mon: GIORNO, tue: GIORNO, wed: GIORNO, thu: [['09:00', '13:00']], fri: GIORNO, sat: GIORNO, sun: [] };
const LUNEDI_12 = '2026-11-02T11:00:00Z';
const LUNEDI_14 = '2026-11-02T13:00:00Z';

const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return { ok: true, json: async () => ({ possibile: false, perche: 'finto' }) };
  return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
}) as unknown as typeof fetch;

const fusoDiPartenza = process.env.TZ;
let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  avvisi.errori.length = 0;
  delete globale.__DATI_QUERY__;
  delete globale.__OPZIONI_QUERY__;
  delete globale.__CLIENT_SUPABASE__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI__;
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});
afterAll(() => { globalThis.fetch = reteDiPartenza; });

async function assesta() {
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const pezzo = { id: 'p-filone', name: 'Filone', price: 4, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
const gruppi = (orari: unknown) => ({
  groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [pezzo] }],
  orphans: [], stockIssues: [], variantIssues: [], prezziCambiati: [],
  orariNegozi: [orari],
});

/** Maria, entrata, apre la cassa all'ora data; la bozza (se c'è) dice giorno e fascia scelti prima. */
async function cassaAlle(ora: string, bozza: Record<string, unknown> = {}) {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(ora));
  localStorage.setItem('cart', JSON.stringify([pezzo]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({
    form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
    metodoPagamento: 'cod',
    sceltaIl: Date.now(),
    ...bozza,
  }));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes('p-filone') ? gruppi(ORARI_PQ) : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  return {
    testo: () => testoVisibile(s.radice),
    fasce: () => [...s.radice.querySelectorAll<HTMLInputElement>('input[name="deliverySlot"]')].map((i) => i.value),
    scelta: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
    ordina: async () => {
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
      return (globale.__MUTAZIONI__ as unknown[]).length;
    },
  };
}

/** Un client finto che risponde per tavola; la vetrina dà gli orari solo se la lettura li chiede. */
function databaseDellaCassa(chieste: string[]) {
  const righe: Record<string, unknown[]> = {
    products: [{ id: 'p-filone', seller_id: PANE, stock: 10, has_variants: false, price: 4, express_enabled: null }],
    product_variants: [],
  };
  const negozio = { id: PANE, store_name: 'Pane Quotidiano', store_lat: null, store_lng: null, is_approved: true, store_hours: ORARI_PQ };
  return {
    from: (tavola: string) => {
      let colonne = '';
      const q: Record<string, unknown> = {};
      const dati = () => {
        if (tavola === 'seller_public_profiles') {
          chieste.push(colonne);
          return [/store_hours|\*/.test(colonne) ? negozio : (({ store_hours: _o, ...r }) => r)(negozio)];
        }
        return righe[tavola] ?? [];
      };
      Object.assign(q, {
        select: (c?: string) => { colonne = c ?? '*'; return q; },
        in: () => q, eq: () => q, is: () => q, gte: () => q, lte: () => q, lt: () => q, gt: () => q, order: () => q, limit: () => q, or: () => q,
        maybeSingle: async () => ({ data: dati()[0] ?? null, error: null }),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: dati(), error: null }).then(ok, ko),
      });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
}

describe('R04-012 · la cassa e gli orari dei negozi, a pagina montata', () => {
  it('① la lettura del carrello chiede gli orari alla vetrina e li consegna al resto della cassa', async () => {
    const chieste: string[] = [];
    globale.__CLIENT_SUPABASE__ = databaseDellaCassa(chieste);
    globale.__OPZIONI_QUERY__ = [];
    await cassaAlle(LUNEDI_12);
    // L'ultima domanda col carrello dentro (alla prima il carrello non è ancora uscito dal browser).
    const lettura = [...(globale.__OPZIONI_QUERY__ as Array<{ queryKey?: readonly unknown[]; queryFn?: () => Promise<unknown> }>)]
      .reverse()
      .find((q) => q.queryKey?.[0] === 'checkout-groups' && String(q.queryKey?.[1]).includes('p-filone'));
    expect(lettura?.queryFn, 'la lettura del carrello non si trova').toBeTypeOf('function');
    const letto = (await lettura!.queryFn!()) as { orariNegozi?: unknown[] };
    expect(chieste.some((c) => /store_hours/.test(c)), 'la cassa non chiede gli orari dei negozi').toBe(true);
    expect(letto.orariNegozi, 'gli orari letti non arrivano a selettore e freno').toEqual([ORARI_PQ]);
  }, 30_000);

  it('② lunedì alle 14:00 il selettore non propone «Oggi · 13:00–16:30» (forno chiuso fino alle 16:30)', async () => {
    const c = await cassaAlle(LUNEDI_14, { giorno: 'today' });
    expect(c.testo(), 'il carrello non è arrivato in cassa').toMatch(/Filone/);
    const fasce = c.fasce();
    expect(fasce.length, 'nessuna fascia a video: la prova non misurerebbe niente').toBeGreaterThan(0);
    expect(fasce, 'il selettore propone una fascia che il negozio non può servire').not.toContain('Oggi · 13:00–16:30');
    expect(fasce).toContain('Oggi · 16:30–18:00');
  }, 30_000);

  it('③ scelta alle 12:00, alle 14:00 «Ordina» la ferma e dice perché, senza ridisegno', async () => {
    const c = await cassaAlle(LUNEDI_12, { giorno: 'today', fasciaOggi: 'Oggi · 13:00–16:30' });
    expect(c.scelta(), 'alle 12:00 la «Oggi · 13:00–16:30» si può (si ritira entro le 12:45)').toBe('Oggi · 13:00–16:30');
    vi.setSystemTime(new Date(LUNEDI_14));
    const ordini = await c.ordina();
    expect(ordini, 'alle 14:00 l’ordine per la 13:00–16:30 col forno chiuso è partito').toBe(0);
    expect(avvisi.errori.length, '«Ordina» fermato deve dire perché').toBeGreaterThan(0);
  }, 30_000);

  it('controprova: alle 12:00 la stessa fascia si ordina', async () => {
    const c = await cassaAlle(LUNEDI_12, { giorno: 'today', fasciaOggi: 'Oggi · 13:00–16:30' });
    const ordini = await c.ordina();
    expect(avvisi.errori).toEqual([]);
    expect(ordini).toBe(1);
  }, 30_000);
});
