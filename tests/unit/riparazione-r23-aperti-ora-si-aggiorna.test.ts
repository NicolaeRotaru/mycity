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
