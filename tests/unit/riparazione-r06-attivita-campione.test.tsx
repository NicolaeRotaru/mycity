// @vitest-environment jsdom
/**
 * R06-021 (12/11/2026) — LA SINTESI DELLE 24 ORE ERA UN CAMPIONE E NON LO DICEVA.
 *
 * La pagina Attività chiedeva `.limit(3000)` e mostrava «campione» solo con
 * almeno 3000 righe in mano. Ma il database ne consegna al massimo mille per
 * richiesta: «Visitatori 24h» si contava sulle ultime mille righe e l'avviso
 * non compariva mai. Qui il finto database ha il tetto vero di mille righe e
 * cinquemila visite di cinquemila visitatori diversi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';
import { creaPostgrestColTetto, type Riga } from './aiuti/riparazione-r06-postgrest-col-tetto';

const stato: { client: ReturnType<typeof creaPostgrestColTetto>['client'] | null } = { client: null };

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => stato.client!.from(t),
    rpc: async () => ({ data: null, error: null }),
    channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => {} }; return c; },
    removeChannel: () => {},
  },
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; vi.unstubAllGlobals(); });

function visite(n: number): Riga[] {
  const adesso = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    id: `e-${i}`,
    created_at: new Date(adesso - i * 10_000).toISOString(),
    category: 'page',
    is_bot: false,
    anon_id: `visitatore-${i}`,
  }));
}

async function apri(righe: number) {
  stato.client = creaPostgrestColTetto({ activity_events: visite(righe) }).client;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { acceso: true } }), { status: 200 })));
  const mod = (await import('@/app/admin/activity/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function kpi(host: HTMLElement, etichetta: string) {
  const p = [...host.querySelectorAll('p')].find((x) => x.textContent === etichetta);
  return { valore: p?.previousElementSibling?.textContent, riquadro: p?.parentElement?.textContent ?? '' };
}

describe('R06-021 · Attività: visitatori delle 24 ore oltre le mille righe', () => {
  it('legge fino a 3000 righe e dice che e\' un campione', async () => {
    const host = await apri(5000);
    const v = kpi(host, 'Visitatori 24h');
    expect(v.valore, 'I visitatori si contavano sulle sole mille righe che il database consegna in una volta').toBe('3000');
    expect(v.riquadro.toLowerCase(), 'Il numero e\' un campione e la pagina deve dirlo').toContain('campione');
  });

  it('con poche righe non parla di campione', async () => {
    const host = await apri(40);
    const v = kpi(host, 'Visitatori 24h');
    expect(v.valore).toBe('40');
    expect(v.riquadro.toLowerCase()).not.toContain('campione');
  });
});
