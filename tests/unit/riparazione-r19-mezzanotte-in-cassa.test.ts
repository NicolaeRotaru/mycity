/**
 * @vitest-environment jsdom
 */
/**
 * 13/11/2026 (R19-017) — CON LA CASSA APERTA A MEZZANOTTE, «DOMANI» PASSAVA DA SABATO A DOMENICA IN SILENZIO.
 *
 * Venerdì 6/11 alle 23:59:30 di Piacenza Maria sceglie «Domani · 9:00–11:00»: sabato 7/11. Le date
 * di «Oggi» e «Domani» si ricalcolano a ogni battito dell'orologio: dopo la mezzanotte le tessere
 * dicevano «Oggi · sab 7/11 | Domani · dom 8/11», la scelta restava «Domani · 9:00–11:00» e nessuno
 * lo diceva. L'ordine nasceva per domenica.
 *
 * Due strade per arrivarci, e qui si provano tutte e due, con la pagina di cassa MONTATA intera e
 * l'orologio finto:
 *  ① la pagina resta aperta e il selettore ridisegna da solo dopo la mezzanotte (91 secondi);
 *  ② si preme «Ordina» subito dopo la mezzanotte, prima che qualcosa ridisegni.
 * In tutti e due i casi l'ordine deve partire per sabato 7/11, cioè «Oggi · 9:00–11:00», e la cassa
 * deve dirlo.
 *
 * ⚠️ Cosa NON prova: chi preme alle 23:59:59 e arriva al server dopo la mezzanotte. Lì serve che la
 * richiesta porti la data e che la rotta la confronti (un'altra voce del registro).
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

const avvisi = vi.hoisted(() => ({ errori: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    info: () => undefined,
    warning: () => undefined,
    error: (m: unknown) => {
      avvisi.errori.push(String(m));
    },
  }),
}));

const globale = globalThis as Record<string, unknown>;
const MARIA = { id: 'cccccccc-3333-4333-8333-cccccccccccc', email: 'maria@test.it' };
const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORDINE = '22222222-bbbb-4bbb-8bbb-222222222222';
/** Venerdì 6/11/2026 alle 23:59:30 di Roma (in novembre Roma è a UTC+1). */
const VENERDI_23_59_30 = '2026-11-06T22:59:30Z';

const fasceInviate: string[] = [];
/** R19-017 ④ — la data (`delivery_date`) che ogni richiesta d'ordine ha portato. */
const dateInviate: unknown[] = [];
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/api/consegna/veloce')) return { ok: true, json: async () => ({ possibile: false, perche: 'finto' }) };
  if (url.includes('/api/orders/cod')) {
    const corpo = JSON.parse(init?.body ?? '{}') as { deliverySlot?: string; delivery_date?: unknown };
    fasceInviate.push(corpo.deliverySlot ?? '');
    dateInviate.push(corpo.delivery_date);
    return { ok: true, status: 200, json: async () => ({ ok: true, data: { orderIds: [ORDINE], ordini: [{ id: ORDINE, sellerId: PANE, totalCents: 1500 }] } }) };
  }
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
  avvisi.errori.length = 0;
  fasceInviate.length = 0;
  dateInviate.length = 0;
  delete globale.__DATI_QUERY__;
  delete globale.__UTENTE__;
  delete globale.__MUTAZIONI_VERE__;
  delete globale.__MUTAZIONI_IN_VOLO__;
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

/** Maria, entrata, con un filone da 15 € e «Domani · 9:00–11:00» già scelto, venerdì alle 23:59:30. */
async function cassaDiVenerdiSera() {
  process.env.TZ = 'Europe/Rome';
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(VENERDI_23_59_30));
  const filone = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: PANE, storeName: 'Pane Quotidiano' };
  const gruppi = {
    groups: [{ sellerId: PANE, storeName: 'Pane Quotidiano', storeLat: null, storeLng: null, items: [filone] }],
    orphans: [],
    stockIssues: [],
    variantIssues: [],
    prezziCambiati: [],
  };
  localStorage.setItem('cart', JSON.stringify([filone]));
  localStorage.setItem('mc_checkout_draft', JSON.stringify({
    form: { fullName: 'Maria Rossi', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', phone: '3331234567', notes: '' },
    metodoPagamento: 'cod',
    giorno: 'tomorrow',
    fasciaDomani: 'Domani · 9:00–11:00',
    sceltaIl: Date.now(),
  }));
  globale.__UTENTE__ = MARIA;
  globale.__MUTAZIONI_VERE__ = true;
  globale.__MUTAZIONI_IN_VOLO__ = [];
  globale.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => {
    const [chi, cosa] = o.queryKey;
    if (chi === 'checkout-groups') return String(cosa).includes('p-filone') ? gruppi : undefined;
    if (chi === 'auth-user') return MARIA;
    if (chi === 'user-addresses') return [];
    return undefined;
  };
  const pagina = (await monta('app/checkout/page.tsx')).default;
  schermo = accendi(pagina, {});
  await assesta();
  const s = schermo;
  const tessera = (nome: string) => s.radice.querySelector<HTMLButtonElement>(`button[aria-label^="${nome},"]`);
  return {
    oggi: () => tessera('Oggi'),
    domani: () => tessera('Domani'),
    fascia: () => s.radice.querySelector<HTMLInputElement>('input[name="deliverySlot"]:checked')?.value ?? null,
    avviso: () => [...s.radice.querySelectorAll('[role="status"]')].map((n) => n.textContent ?? '').join(' · '),
    ordina: async () => {
      const modulo = s.radice.querySelector('form#checkout-form');
      expect(modulo, 'il modulo della cassa non si trova: la prova non misurerebbe niente').not.toBeNull();
      await act(async () => {
        modulo!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await assesta();
      await Promise.all(globale.__MUTAZIONI_IN_VOLO__ as Promise<unknown>[]);
      await assesta();
    },
  };
}

describe('R19-017 · a mezzanotte la fascia di domani non cambia giorno in silenzio', () => {
  it('① la cassa resta aperta oltre la mezzanotte: la consegna resta sabato 7/11, la cassa lo dice, l’ordine parte con «Oggi»', async () => {
    const c = await cassaDiVenerdiSera();
    expect(c.domani()?.getAttribute('aria-label'), 'venerdì sera «Domani» è sabato 7/11').toMatch(/sab 7\/11/);
    expect(c.domani()!.getAttribute('aria-pressed')).toBe('true');
    expect(c.fascia()).toBe('Domani · 9:00–11:00');

    await act(async () => {
      vi.advanceTimersByTime(91_000);
    });
    await assesta();

    expect(c.oggi()?.getAttribute('aria-label'), 'dopo la mezzanotte «Oggi» è sabato 7/11').toMatch(/sab 7\/11/);
    expect(c.oggi()!.getAttribute('aria-pressed'), 'la consegna è passata a domenica: «Domani» è ancora la scelta').toBe('true');
    expect(c.fascia(), 'la fascia non è più quella di sabato').toBe('Oggi · 9:00–11:00');
    expect(c.avviso(), 'il cambio di giorno è muto').toMatch(/mezzanotte/);
    expect(c.avviso(), 'l’avviso non dice per che giorno resta la consegna').toMatch(/sab 7\/11/);

    await c.ordina();
    expect(avvisi.errori).toEqual([]);
    expect(fasceInviate, 'l’ordine non nasce per sabato 7/11').toEqual(['Oggi · 9:00–11:00']);
    expect(dateInviate, 'la richiesta non porta la data di sabato 7/11').toEqual(['2026-11-07']);
  }, 30_000);

  it('② «Ordina» subito dopo la mezzanotte, prima che la cassa ridisegni: niente ordine per domenica', async () => {
    const c = await cassaDiVenerdiSera();
    // Sabato alle 00:00:10: l'orologio è andato avanti, ma niente ha ridisegnato la pagina.
    vi.setSystemTime(new Date('2026-11-06T23:00:10Z'));
    await c.ordina();
    expect(fasceInviate, 'l’ordine è partito con «Domani» di ieri sera: nasce per domenica 8/11').toEqual([]);
    expect(avvisi.errori.join(' · '), 'la cassa ferma l’invio senza dire perché').toMatch(/mezzanotte/);

    expect(c.fascia(), 'dopo il ridisegno la fascia deve essere quella di sabato').toBe('Oggi · 9:00–11:00');
    expect(c.avviso()).toMatch(/sab 7\/11/);
    await c.ordina();
    expect(fasceInviate, 'ripremuto, l’ordine deve nascere per sabato 7/11').toEqual(['Oggi · 9:00–11:00']);
    expect(dateInviate, 'la richiesta non porta la data di sabato 7/11').toEqual(['2026-11-07']);
  }, 30_000);

  /**
   * Giro di correzione (13/11), punto ④ della cura: chi preme alle 23:59:59 e arriva al server dopo
   * la mezzanotte. L'etichetta da sola («Domani · …») la rotta la legge col suo orologio, cioè
   * domenica: la richiesta porta anche la data del giorno di Roma scelto.
   */
  it('④ «Ordina» venerdì alle 23:59:59.9: la richiesta porta «Domani» E la data di sabato 7/11', async () => {
    const c = await cassaDiVenerdiSera();
    expect(c.fascia()).toBe('Domani · 9:00–11:00');
    vi.setSystemTime(new Date('2026-11-06T22:59:59.900Z'));
    await c.ordina();
    expect(avvisi.errori).toEqual([]);
    expect(fasceInviate).toEqual(['Domani · 9:00–11:00']);
    expect(dateInviate, 'senza la data, la rotta che riceve dopo la mezzanotte legge «Domani» come domenica').toEqual(['2026-11-07']);
  }, 30_000);

  it('④ anche la richiesta della carta porta la data, accanto all’etichetta (la carta al lancio è spenta: si legge la richiesta)', async () => {
    const { readFileSync } = await import('node:fs');
    const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
    const carta = cassa.slice(cassa.indexOf("fetch('/api/stripe/checkout'"));
    const corpo = carta.slice(0, carta.indexOf('});'));
    expect(corpo).toMatch(/deliverySlot,\s*(\/\/[^\n]*\n\s*)*delivery_date: dataDellaConsegna,/);
  });
});
