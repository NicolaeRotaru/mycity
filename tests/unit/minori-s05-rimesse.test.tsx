// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, scrivi, aspetta } from './aiuti/cabina-admin';

/**
 * S05 · schede 586 e 1799 — rimesse contanti.
 * ① Un tocco su «Conferma rimessa» non deve far pagare i negozi: prima si
 *   dicono fattorino, giorno, ordini e importo atteso, si scrive quanto è stato
 *   contato, e se è diverso serve una nota.
 * ② Oltre il tetto di lettura la pagina dice che l'elenco è tagliato.
 */

let righe: unknown[] = [];
// Un client finto che accetta qualunque catena e risponde con `righe`.
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
function ordine(i: number) {
  return {
    id: `o${i}`, rider_id: RIDER, delivered_at: '2026-11-04T10:00:00Z', total_price: 13, shipping_cost: 3,
    rider_fee_cents: 300, pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED',
    cash_confirmed_at: '2026-11-04T10:05:00Z', rider: { full_name: 'Luca' },
  };
}

const chiamate: Array<{ url: string; corpo: unknown }> = [];
let chiudi: (() => void) | null = null;
beforeEach(() => {
  chiamate.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    chiamate.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify({ ok: true, released: 1, saltatiSenzaIncasso: 0 }), { status: 200 });
  }));
});
afterEach(() => { chiudi?.(); chiudi = null; vi.unstubAllGlobals(); });

async function apri() {
  const mod = (await import('@/app/admin/cod-remittance/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}
const bottone = (host: HTMLElement, testo: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(testo)) as HTMLButtonElement | undefined;
async function clic(el: HTMLElement | undefined) {
  await act(async () => { el?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await aspetta();
}

describe('rimesse contanti: conferma in due passi', () => {
  it('586: il primo tocco non chiama il server, e con importo diverso serve la nota', async () => {
    righe = [ordine(1)];
    const host = await apri();
    await clic(bottone(host, 'Conferma rimessa'));
    expect(chiamate.filter((c) => c.url.includes('cod-remittance'))).toHaveLength(0);
    expect(host.textContent).toContain('Luca');
    expect(host.textContent).toContain('atteso');

    const campo = host.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    await scrivi(campo, '9,00');
    const invia = bottone(host, 'Conferma i contanti ricevuti')!;
    expect(invia.disabled, 'importo diverso senza nota: non si conferma').toBe(true);
    await scrivi(host.querySelector('textarea') as HTMLTextAreaElement, 'mancano 1 euro, li porta domani');
    expect(invia.disabled).toBe(false);
    await act(async () => { invia.form?.requestSubmit(); });
    await aspetta();
    const fatta = chiamate.find((c) => c.url.includes('cod-remittance'));
    expect(fatta?.corpo).toMatchObject({ riderId: RIDER, contatiCents: 900, attesiCents: 1000, nota: 'mancano 1 euro, li porta domani' });
  });

  it('1799: oltre 1000 righe la pagina dice «Elenco tagliato» e «almeno»', async () => {
    righe = Array.from({ length: 1001 }, (_, i) => ordine(i));
    const host = await apri();
    expect(host.textContent).toContain('Elenco tagliato');
    expect(host.textContent).toMatch(/almeno/);
  });

  it('1799: con 1000 righe esatte nessun avviso', async () => {
    righe = Array.from({ length: 1000 }, (_, i) => ordine(i));
    const host = await apri();
    expect(host.textContent).not.toContain('Elenco tagliato');
  });
});

describe('POST /api/admin/cod-remittance: la nota è obbligatoria se i conti non tornano', () => {
  it('importo diverso senza nota → 400; chi non è admin → 403', async () => {
    vi.resetModules();
    vi.doMock('@/lib/api/middleware', () => ({
      withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
        req.headers.get('x-ruolo') === 'admin' ? h({ req, user: { id: 'a' } }) : new Response('no', { status: 403 }),
    }));
    const rpc = vi.fn(async () => ({ data: { rilasciati: 1 }, error: null }));
    vi.doMock('@/lib/supabase/server', () => ({ getServerSupabase: async () => ({ rpc }), getAdminSupabase: () => { throw new Error('no'); } }));
    vi.doMock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
    const { POST } = await import('@/app/api/admin/cod-remittance/route');
    const manda = (corpo: unknown, ruolo = 'admin') => (POST as unknown as (r: Request) => Promise<Response>)(
      new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruolo': ruolo }, body: JSON.stringify(corpo) }));
    expect((await manda({ riderId: RIDER, date: '2026-11-04' }, 'rider')).status).toBe(403);
    expect((await manda({ riderId: RIDER, date: '2026-11-04', contatiCents: 900, attesiCents: 1000 })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect((await manda({ riderId: RIDER, date: '2026-11-04', contatiCents: 1000, attesiCents: 1000 })).status).toBe(200);
  });
});
