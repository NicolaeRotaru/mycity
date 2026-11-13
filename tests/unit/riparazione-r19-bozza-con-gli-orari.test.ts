/**
 * @vitest-environment jsdom
 */
/**
 * 13/11/2026 (R19-012) — LA BOZZA DELLA CASSA RICEVEVA GLI ORARI DEI NEGOZI VUOTI.
 *
 * Chi passa dall'accesso ritrova giorno e fascia della bozza solo se la regola unica della cassa li
 * accetta adesso, CON gli orari dei negozi del carrello (`fasciaDaRimettere`, `giornoDaRimettere`).
 * Ma l'effetto della bozza girava una volta al montaggio, quando la lettura del carrello non era
 * ancora arrivata: gli orari erano una lista vuota, e la bozza rimetteva fasce che il negozio non
 * può servire. Poi il selettore le spostava per conto suo, su un'altra fascia.
 *
 * Il caso: mercoledì 28/10 alle 21:30 Maria aveva scelto «Domani · 7:30–9:00» da Pane Quotidiano,
 * che giovedì apre alle 9: la fascia non si può servire. Con gli orari la bozza non la rimette e la
 * cassa resta sulla sua fascia di partenza per domani; con la lista vuota la rimetteva, e il
 * selettore la spostava sulla prima che trovava.
 *
 * Qui la pagina di cassa si MONTA intera, e la lettura del carrello arriva dopo il montaggio, come
 * nella pagina vera.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';
import { fasciaDaRimettere } from '@/lib/bozza-checkout';
import { romeNow } from '@/lib/store-hours';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, info: () => undefined, warning: () => undefined, error: () => undefined }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const GIORNATA: [string, string][] = [['09:00', '13:00'], ['16:30', '19:30']];
/** Pane Quotidiano: lun-sab 9-13 e 16:30-19:30, giovedì pomeriggio e domenica chiuso. */
const PANE_QUOTIDIANO = { mon: GIORNATA, tue: GIORNATA, wed: GIORNATA, thu: [['09:00', '13:00']], fri: GIORNATA, sat: GIORNATA };
/** Mercoledì 28/10/2026 alle 21:30 di Roma (ora solare dal 25/10: UTC+1). */
const MERCOLEDI_21_30 = '2026-10-28T20:30:00Z';

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
  sessionStorage.clear();
  vi.useRealTimers();
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  if (fusoDiPartenza === undefined) delete process.env.TZ;
  else process.env.TZ = fusoDiPartenza;
});
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});

async function assesta() {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function cassaConLaBozza(fasciaDomani: string) {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(MERCOLEDI_21_30));
  const filone = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
  const gruppi = {
    groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [filone] }],
    orphans: [],
    stockIssues: [],
    variantIssues: [],
    prezziCambiati: [],
    orariNegozi: [PANE_QUOTIDIANO],
  };
  localStorage.setItem('cart', JSON.stringify([filone]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({
    form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
    metodoPagamento: 'cod',
    giorno: 'tomorrow',
    fasciaDomani,
    sceltaIl: Date.now(),
  }));
  globale.__UTENTE__ = MARIA;
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    // Come la lettura vera: i gruppi (e gli orari) arrivano solo dopo che il carrello è stato letto.
    if (chi === 'checkout-groups') return String(cosa).includes('p-filone') ? gruppi : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  return {
    domani: () => s.radice.querySelector<HTMLButtonElement>('button[aria-label^="Domani,"]'),
    fascia: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
  };
}

describe('R19-012 · la bozza della cassa chiede alla regola unica CON gli orari dei negozi', () => {
  it('«Domani · 7:30–9:00» da un forno che apre alle 9 non si rimette: resta la fascia di partenza della cassa', async () => {
    const c = await cassaConLaBozza('Domani · 7:30–9:00');
    // Il caso è quello giusto: con gli orari quella fascia non si rimette.
    expect(fasciaDaRimettere('tomorrow', 'Domani · 7:30–9:00', romeNow(), [PANE_QUOTIDIANO])).toBeNull();
    expect(c.domani()!.getAttribute('aria-pressed')).toBe('true');
    expect(
      c.fascia(),
      'la bozza ha rimesso una fascia che il negozio non serve (con gli orari vuoti) e il selettore l’ha spostata per conto suo',
    ).toBe(FASCE_DI_DOMANI[2]);
  }, 30_000);

  it('una fascia che il forno serve si rimette come sempre', async () => {
    const c = await cassaConLaBozza('Domani · 16:30–18:00');
    expect(c.domani()!.getAttribute('aria-pressed')).toBe('true');
    expect(c.fascia()).toBe('Domani · 16:30–18:00');
  }, 30_000);
});
