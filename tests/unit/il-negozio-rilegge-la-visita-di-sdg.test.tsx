/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 verso le 17:40 — Nicola: dopo la conferma dal link il titolare entra nella sua pagina e deve capire
 * cosa succede adesso. Se nel link ha scelto il giorno della visita di SDG, in cima alla pagina dell'abbonamento
 * lo rilegge. Casi (dato → atteso):
 *  · la porta legge la visita del SUO preventivo (per id dell'utente) e la rende;
 *  · visita passata, nessuna visita, colonna che non c'è (999b non applicata) → `visita: null`;
 *  · il riquadro dice «Il team di SDG passa da te lunedì 30 novembre alle 10:00»; senza visita non c'è.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const stato = vi.hoisted(() => ({
  riga: null as null | { visita_il: string | null },
  errore: null as null | { message: string },
  filtri: [] as Array<[string, unknown]>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAnchePendingRateLimit: (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) =>
    (req: Request) => gestore({ user: { id: 'negozio-1' }, profile: {}, req, params: {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t !== 'preventivi_con_codice') throw new Error(`tabella inattesa ${t}`);
      return {
        select: () => ({
          eq: (c: string, v: unknown) => {
            stato.filtri.push([c, v]);
            return { maybeSingle: async () => ({ data: stato.riga, error: stato.errore }) };
          },
        }),
      };
    },
  }),
}));

import { GET } from '@/app/api/seller/visita-sdg/route';
import VisitaSdg from '@/components/seller/VisitaSdg';

const leggi = async () => (await (GET as unknown as (r: Request) => Promise<Response>)(new Request('https://mycity.example/api/seller/visita-sdg'))).json();

beforeEach(() => {
  stato.riga = null;
  stato.errore = null;
  stato.filtri = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T16:45:00Z'));
});

let radice: Root | null = null;
let contenitore: HTMLDivElement | null = null;
afterEach(() => {
  if (radice) act(() => radice!.unmount());
  contenitore?.remove();
  radice = null;
  contenitore = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('la porta della visita', () => {
  it('legge la visita del suo preventivo, per id dell utente', async () => {
    stato.riga = { visita_il: '2026-11-30T09:00:00.000Z' };
    expect(await leggi()).toEqual({ ok: true, data: { visita: '2026-11-30T09:00:00.000Z' } });
    expect(stato.filtri).toEqual([['seller_id', 'negozio-1']]);
  });

  it('visita passata, nessuna visita, colonna che non c è: visita null', async () => {
    stato.riga = { visita_il: '2026-11-20T09:00:00.000Z' };
    expect((await leggi()).data.visita).toBeNull();
    stato.riga = { visita_il: null };
    expect((await leggi()).data.visita).toBeNull();
    stato.riga = null;
    expect((await leggi()).data.visita).toBeNull();
    stato.errore = { message: 'column preventivi_con_codice.visita_il does not exist' };
    expect((await leggi()).data.visita).toBeNull();
  });
});

async function monta(risposta: unknown) {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(risposta), { status: 200 })));
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
  await act(async () => { radice!.render(<VisitaSdg />); });
  await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
  return contenitore;
}

describe('il riquadro nella pagina dell abbonamento', () => {
  it('dice il giorno e cosa si fa', async () => {
    const r = await monta({ ok: true, data: { visita: '2026-11-30T09:00:00.000Z' } });
    const testo = r.querySelector('[data-testid="visita-sdg"]')?.textContent ?? '';
    expect(testo).toContain('Il team di SDG passa da te lunedì 30 novembre alle 10:00');
    expect(testo).toContain('il fotografo e il videomaker fanno subito le prime foto e i primi video');
  });

  it('senza visita non c è', async () => {
    const r = await monta({ ok: true, data: { visita: null } });
    expect(r.querySelector('[data-testid="visita-sdg"]')).toBeNull();
  });
});
