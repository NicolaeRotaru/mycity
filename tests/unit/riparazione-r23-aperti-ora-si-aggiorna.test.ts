/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { nomeAccessibile, controlli } from './aiuti/monta-componente';
import { act } from 'react';

/**
 * R23-010 — con «Aperti ora» acceso l'elenco dei negozi si rifà all'orario di chiusura.
 * Giovedì 29/10/2026 alle 12:59:30 a Piacenza il forno (9–13) è aperto; un minuto dopo ha chiuso.
 */
const TUTTO = [['00:00', '23:59']];
const negozio = (id: string, nome: string, giovedi: string[][]) => ({
  id, store_name: nome, store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null,
  store_logo: null, store_media: null, is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
  store_hours: { thu: giovedi },
});
const DATI = {
  stores: [negozio('n1', 'Forno Mattutino', [['09:00', '13:00']]), negozio('n2', 'Bar Sempre Aperto', TUTTO)],
  productsByStore: {}, reviewsByStore: {}, countByStore: {}, categoriesByStore: {}, categories: [],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('R23-010 — «Aperti ora» e la chiusura', () => {
  it('il negozio che chiude esce dall\'elenco senza ricaricare la pagina', async () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = DATI;
    const mod = await monta('app/stores/page.tsx');
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ possibile: true }) }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T11:59:30Z'));
    const s = accendi(mod.default, {});
    const aperti = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Aperti ora'))!;
    s.agisci(() => clicca(aperti));
    expect(s.radice.textContent).toContain('Forno Mattutino');
    expect(s.radice.textContent).toContain('Bar Sempre Aperto');

    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(s.radice.textContent).not.toContain('Forno Mattutino');
    expect(s.radice.textContent).toContain('Bar Sempre Aperto');
    s.smonta();
  }, 60000);
});

/**
 * R23-010 correzione (14/11/2026) — Il collaudo (K06) ha trovato una piccola regressione: il filtro usava
 * l'ora dell'ultimo battito (vecchia fino a 60 s), la scheda l'ora vera. Una resa nuova subito dopo la
 * chiusura — qui un cambio d'ordinamento 40 secondi dopo le 13, prima del battito — teneva in lista il
 * forno con scritto «Chiuso ora».
 */
function scegli(el: HTMLSelectElement, valore: string) {
  const imposta = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  imposta.call(el, valore);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('R23-010 correzione — una resa nuova subito dopo la chiusura', () => {
  it('il negozio appena chiuso non resta in lista con scritto «Chiuso ora»', async () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = DATI;
    const mod = await monta('app/stores/page.tsx');
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ possibile: true }) }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T11:59:30Z'));
    const s = accendi(mod.default, {});
    const aperti = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Aperti ora'))!;
    s.agisci(() => clicca(aperti));
    expect(s.radice.textContent).toContain('Forno Mattutino');

    // Le 13:00:10: il forno ha chiuso, il battito (alle 13:00:30) non è ancora arrivato.
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    const ordine = s.radice.querySelector('select') as HTMLSelectElement;
    s.agisci(() => scegli(ordine, 'name'));

    const testo = s.radice.textContent ?? '';
    expect(testo, 'la resa nuova tiene in lista il forno chiuso').not.toContain('Forno Mattutino');
    expect(testo, 'in lista con «Aperti ora» c\'è un negozio che dice «Chiuso ora»').not.toContain('Chiuso ora');
    expect(testo).toContain('Bar Sempre Aperto');
    s.smonta();
  }, 60000);

  it('senza «Aperti ora» il forno chiuso resta in lista, con scritto «Chiuso ora»', async () => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = DATI;
    const mod = await monta('app/stores/page.tsx');
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ possibile: true }) }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T12:00:10Z'));
    const s = accendi(mod.default, {});
    const testo = s.radice.textContent ?? '';
    expect(testo).toContain('Forno Mattutino');
    expect(testo).toContain('Chiuso ora');
    s.smonta();
  }, 60000);
});

/**
 * R23-010 correzione, verifica (14/11/2026) — Il verificatore ha trovato l'ultima strada: su /stores i dati
 * arrivano dopo il montaggio della pagina, e le schede partono col loro orologio dopo quello della pagina.
 * Se la chiusura cade fra i due battiti, la scheda si rifà da sola e scrive «Chiuso ora», mentre il filtro
 * la tiene in lista fino al battito dopo della pagina (fino a quasi un minuto). Qui lo sfasamento è largo
 * (dati dopo 40 s) perché la prova non dipenda dall'istante esatto in cui parte l'orologio della pagina:
 * la pagina batte verso le 12:59:30 (forno aperto) e le 13:00:30, la scheda alle 13:00:10 (forno chiuso).
 */
/** L'orologio avanza un secondo alla volta, come quello vero: con un salto solo React rifà le rese in ritardo. */
async function avanza(secondi: number) {
  for (let i = 0; i < secondi; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  }
}

describe('R23-010 correzione — la scheda e il filtro con due orologi sfasati', () => {
  it('fra il battito della scheda e quello della pagina il forno in lista non dice «Chiuso ora»', async () => {
    const globali = globalThis as Record<string, unknown>;
    globali.__DATI_QUERY__ = undefined;
    const mod = await monta('app/stores/page.tsx');
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ possibile: true }) }));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T11:58:30Z'));
    const s = accendi(mod.default, {});

    // I dati arrivano alle 12:59:10: la resa dopo monta le schede, coi loro orologi.
    await avanza(40);
    globali.__DATI_QUERY__ = DATI;
    const aperti = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Aperti ora'))!;
    s.agisci(() => clicca(aperti));
    expect(s.radice.textContent).toContain('Forno Mattutino');
    expect(s.radice.textContent).not.toContain('Chiuso ora');

    // 13:00:15 — la scheda ha battuto alle 13:00:10 (forno chiuso), la pagina non ancora.
    await avanza(65);
    const testo = s.radice.textContent ?? '';
    expect(
      testo.includes('Forno Mattutino') && testo.includes('Chiuso ora'),
      'il forno è in lista con «Aperti ora» acceso e la sua scheda dice «Chiuso ora»',
    ).toBe(false);

    // Al battito dopo della pagina (verso le 13:00:30) il forno esce.
    await avanza(20);
    expect(s.radice.textContent).not.toContain('Forno Mattutino');
    expect(s.radice.textContent).toContain('Bar Sempre Aperto');
    s.smonta();
  }, 60000);
});
