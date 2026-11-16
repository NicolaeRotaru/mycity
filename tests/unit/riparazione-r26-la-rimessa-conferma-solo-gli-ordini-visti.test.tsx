// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, scrivi, aspetta } from './aiuti/cabina-admin';

/**
 * R26-019 — «Conferma rimessa» sbloccava anche gli incassi registrati dopo che
 * l'amministratore aveva aperto la pagina.
 *
 * La conferma mandava solo (fattorino, giorno) e la funzione del database
 * rendeva pagabili TUTTI gli ordini di quel giorno con l'incasso: anche quelli
 * chiusi mentre l'admin contava i contanti degli altri. Adesso la pagina manda
 * l'elenco degli ordini che mostrava, e la rotta lo passa alla funzione
 * (migrazione 501, provata in tests/sql/rls/riparazione-r26-la-rimessa-conferma-solo-gli-ordini-visti.test.sql).
 */

let righe: unknown[] = [];
function catena(): unknown {
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: righe, error: null }).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => catena(), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const RIDER = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
function ordine(id: string) {
  return {
    id, rider_id: RIDER, delivered_at: '2026-11-04T10:00:00Z', total_price: 13, shipping_cost: 3,
    rider_fee_cents: 300, pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED',
    cash_confirmed_at: '2026-11-04T10:05:00Z', rider: { full_name: 'Luca' },
  };
}

const chiamate: Array<{ url: string; corpo: Record<string, unknown> | null }> = [];
let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; vi.unstubAllGlobals(); vi.doUnmock('@/lib/api/middleware'); vi.doUnmock('@/lib/supabase/server'); vi.doUnmock('@/lib/logger'); vi.doUnmock('@/lib/audit'); });

describe('R26-019 — la pagina manda gli ordini che mostra', () => {
  beforeEach(() => {
    chiamate.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      chiamate.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true, released: 2, saltatiSenzaIncasso: 0 }), { status: 200 });
    }));
  });

  it('la conferma porta l elenco degli ordini del gruppo, non solo fattorino e giorno', async () => {
    righe = [ordine(A), ordine(B)];
    const mod = (await import('@/app/admin/cod-remittance/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const host = r.host;
    const bottone = (testo: string) =>
      [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(testo)) as HTMLButtonElement | undefined;

    await act(async () => { bottone('Conferma rimessa')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    await scrivi(host.querySelector('input[inputmode="decimal"]') as HTMLInputElement, '20,00');
    const invia = bottone('Conferma i contanti ricevuti')!;
    expect(invia.disabled).toBe(false);
    await act(async () => { invia.form?.requestSubmit(); });
    await aspetta();

    const fatta = chiamate.find((c) => c.url.includes('cod-remittance'));
    expect(fatta?.corpo?.riderId).toBe(RIDER);
    expect(fatta?.corpo?.orderIds, 'la conferma non dice quali ordini l amministratore ha visto').toEqual([A, B]);
  });
});

describe('R26-019 — la rotta passa l elenco alla funzione del database', () => {
  async function rotta(rpc: ReturnType<typeof vi.fn>) {
    vi.resetModules();
    vi.doMock('@/lib/api/middleware', () => ({
      withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) => h({ req, user: { id: 'admin-1' } }),
    }));
    vi.doMock('@/lib/supabase/server', () => ({ getServerSupabase: async () => ({ rpc }) }));
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    vi.doMock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
    const { POST } = await import('@/app/api/admin/cod-remittance/route');
    return (corpo: unknown) => (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));
  }

  it('con gli ordini visti la funzione riceve p_order_ids', async () => {
    const rpc = vi.fn(async () => ({ data: { rilasciati: 1, saltati_senza_incasso: 0 }, error: null }));
    const manda = await rotta(rpc);
    const res = await manda({ riderId: RIDER, date: '2026-11-04', contatiCents: 1000, attesiCents: 1000, orderIds: [A] });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('confirm_cod_remittance', { p_rider: RIDER, p_date: '2026-11-04', p_order_ids: [A] });
  });

  it('un elenco con un identificativo non valido si rifiuta senza chiamare il database', async () => {
    const rpc = vi.fn(async () => ({ data: { rilasciati: 1 }, error: null }));
    const manda = await rotta(rpc);
    const res = await manda({ riderId: RIDER, date: '2026-11-04', orderIds: ['non-un-id'] });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('senza la migrazione 501 applicata ripiega sulla forma per giorno, invece di bloccare i pagamenti', async () => {
    const rpc = vi.fn(async (_n: string, args: Record<string, unknown>) =>
      'p_order_ids' in args
        ? { data: null, error: { code: 'PGRST202', message: 'funzione non trovata' } }
        : { data: { rilasciati: 1, saltati_senza_incasso: 0 }, error: null });
    const manda = await rotta(rpc);
    const res = await manda({ riderId: RIDER, date: '2026-11-04', orderIds: [A] });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('confirm_cod_remittance', { p_rider: RIDER, p_date: '2026-11-04' });
  });
});
