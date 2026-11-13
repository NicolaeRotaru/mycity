// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-001 / R11-004 (collaudo K04) — «Bonifico fatto» poteva pagare due volte: la funzione 350 salta
 * in silenzio i contanti con un reso o un reclamo aperto, ma il pannello li contava nei «Da versare»
 * e la pagina non guardava quanti ordini erano stati segnati. Quell'ordine restava HELD e tornava il
 * lunedì dopo. Orologio finto: lunedì 16/11/2026.
 */

const stato = vi.hoisted(() => ({ ordini: [] as unknown[], resi: [] as unknown[], segnati: 0, chiamate: [] as unknown[] }));
function catena(dati: () => unknown, count?: number): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: dati(), error: null, count }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => (t === 'orders' ? catena(() => stato.ordini, stato.ordini.length) : t === 'returns' ? catena(() => stato.resi) : catena(() => [])),
    rpc: vi.fn(async (_n: string, args: unknown) => {
      stato.chiamate.push(args);
      // R17-002 — la funzione della 410 risponde con un esito, tutto o niente.
      return { data: { ok: true, segnati: stato.segnati }, error: null };
    }),
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T08:00:00Z'));
  stato.chiamate = [];
});
afterEach(() => { chiudi?.(); chiudi = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

const riga = (id: string) => ({
  id, seller_id: 'forno', total_price: 20, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
  dispute_status: null, internal_dispute_status: null, payment_status: 'PAID',
  payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: '2026-11-10T09:00:00Z', delivered_at: '2026-11-12T15:00:00Z',
  seller: { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' },
});

async function apri() {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R11-001/004 — il bonifico a mano non paga due volte', () => {
  it('un contante con un reso aperto non è fra i «Da versare» né fra quelli che il tasto segna', async () => {
    stato.ordini = [riga('a1'), riga('a2')];
    stato.resi = [{ order_id: 'a2' }];
    const host = await apri();
    const riquadri = Array.from(host.querySelectorAll('p.text-\\[26px\\]')).map((p) => p.textContent ?? '');
    expect(riquadri[0], 'l ordine col reso aperto entra nel totale da versare').toMatch(/18,00/);
    // R17-002 — prima la cifra versata (quella degli ordini segnabili), poi il riferimento.
    const risposte = ['18,00', 'TRN-1'];
    vi.stubGlobal('prompt', () => risposte.shift() ?? null);
    stato.segnati = 1;
    const tasto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
    await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
    expect((stato.chiamate[0] as { p_order_ids: string[] }).p_order_ids).toEqual(['a1']);
  });

  it('se la funzione ne segna meno di quanti chiesti, la pagina lo dice', async () => {
    stato.ordini = [riga('a1'), riga('a2')];
    stato.resi = [];
    const host = await apri();
    const risposte = ['36,00', 'TRN-2'];
    vi.stubGlobal('prompt', () => risposte.shift() ?? null);
    stato.segnati = 1;
    const tasto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
    await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
    expect(host.textContent, 'la pagina tace che un ordine non è stato segnato').toMatch(/segnati 1 ordini su 2/);
  });
});
