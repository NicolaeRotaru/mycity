/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R02-007 — Un lavoro «in invio» rimasto senza risposta non si poteva scartare:
 * «Scarta» c'era solo per un lavoro pronto, e il negozio restava fermo fino a
 * 24 ore (l'avvio risponde 409 finche' c'e' un lavoro aperto). Adesso, quando
 * lo stato dice che l'invio e' incerto, la pagina ha «Scarta»: la richiesta va
 * alla rotta vera di scarto, la riga resta annullata come traccia, e il pulsante
 * «Avvia» torna.
 *
 * Qui la pagina vera parla con le rotte vere dello stato e dello scarto, con un
 * database finto che valuta i loro filtri.
 */

const db = vi.hoisted(() => ({ lavori: [] as Record<string, unknown>[] }));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'negozio-1' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/supabase/server', () => {
  type Riga = Record<string, unknown>;
  const tabella = () => {
    const filtri: ((r: Riga) => boolean)[] = [];
    let valori: Riga | null = null;
    let limite: number | null = null;
    let una = false;
    const esegui = () => {
      const scelte = db.lavori.filter((r) => filtri.every((f) => f(r)));
      if (valori) {
        db.lavori = db.lavori.map((r) => (scelte.includes(r) ? { ...r, ...valori } : r));
        return { data: db.lavori.filter((r) => scelte.some((x) => x.id === r.id)), error: null };
      }
      const out = limite === null ? scelte : scelte.slice(0, limite);
      return { data: una ? out[0] ?? null : out, error: null };
    };
    const q = {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return q; },
      is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; },
      lt: (c: string, v: unknown) => { filtri.push((r) => Date.parse(String(r[c])) < Date.parse(String(v))); return q; },
      limit: (n: number) => { limite = n; return q; },
      update: (v: Riga) => { valori = v; return q; },
      single: () => { una = true; return q; },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
    };
    return q;
  };
  return { getAdminSupabase: () => ({ from: tabella }) };
});
const pollMock = vi.fn();
vi.mock('@/lib/ai/batch', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/batch')>();
  return { ...actual, pollBatch: (...a: unknown[]) => pollMock(...(a as [])) };
});

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'gettone' } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'negozio-1' } }, error: null }),
    },
    from: () => { throw new Error('la pagina del lotto non legge il database dal browser'); },
  },
}));
vi.mock('@/components/seller/CatalogCopilot', () => ({ default: () => null }));
vi.mock('@/components/products/ImportFromUrlBox', () => ({ default: () => null }));
vi.mock('next/navigation', () => {
  const rotta = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} };
  return { useRouter: () => rotta, usePathname: () => '/seller/products/ai-batch', useSearchParams: () => new URLSearchParams() };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: function Collegamento({ href, children, ...resto }: { href: unknown; children?: unknown } & Record<string, unknown>) {
      return ce('a', { ...resto, href: String(href) }, children as never);
    },
  };
});
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} } }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));

import { GET as stato } from '@/app/api/ai/catalog-batch/status/route';
import { POST as scartaRotta } from '@/app/api/ai/catalog-batch/cancel/route';
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';

const ADESSO = new Date('2026-11-21T10:00:00Z');
const minutiFa = (m: number) => new Date(ADESSO.getTime() - m * 60_000).toISOString();
const rigaInInvio = (minuti: number, error: string | null = INVIO_SENZA_RISPOSTA) => ({
  id: 'job-1', seller_id: 'negozio-1', operation: 'improve', status: 'submitting', batch_id: null,
  target_lang: null, total: 12, results: [], created_at: minutiFa(minuti), error,
});

async function aspetta() {
  for (let i = 0; i < 15; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}
const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().includes(testo)) as HTMLButtonElement | undefined;
const clic = (b: HTMLButtonElement) => b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

async function apriIlLotto() {
  const { default: Pagina } = await import('@/app/seller/products/ai-batch/page');
  const s = accendi(Pagina as ComponentType);
  await aspetta();
  s.agisci(() => clic(pulsante('Catalogo AI')!));
  await aspetta();
  return s;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  db.lavori = [];
  try { window.localStorage.clear(); } catch { /* niente memoria */ }
  vi.stubGlobal('fetch', async (percorso: string, init?: RequestInit) => {
    if (percorso.startsWith('/api/ai/catalog-batch/status')) return stato(new Request(`http://localhost${percorso}`) as never);
    if (percorso === '/api/ai/catalog-batch/cancel') {
      return scartaRotta(new Request(`http://localhost${percorso}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: init?.body as string,
      }) as never);
    }
    throw new Error(`chiamata inattesa: ${percorso}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('R02-007 · un invio senza risposta si scarta dalla pagina', () => {
  it('senza risposta da 10 minuti: «Scarta» c\'e\', lo scarto arriva alla rotta, la riga resta annullata e «Avvia» torna', async () => {
    db.lavori = [rigaInInvio(10)];
    const s = await apriIlLotto();
    expect(pulsante('Avvia sul catalogo')).toBeUndefined();
    const scarta = pulsante('Scarta');
    expect(scarta, 'nessun pulsante «Scarta» per il lavoro incerto').toBeDefined();
    s.agisci(() => clic(scarta!));
    await aspetta();
    expect(db.lavori).toHaveLength(1);
    expect(db.lavori[0].status).toBe('canceled');
    expect(String(db.lavori[0].error)).toMatch(/potrebbe essere partito/);
    expect(document.body.textContent ?? '').toMatch(/annullato/);
    expect(pulsante('Avvia sul catalogo')).toBeDefined();
    s.smonta();
  });

  it('in invio da un minuto: niente «Scarta», l\'invio puo\' ancora rispondere', async () => {
    db.lavori = [rigaInInvio(1)];
    const s = await apriIlLotto();
    expect(pulsante('Scarta')).toBeUndefined();
    expect(db.lavori[0].status).toBe('submitting');
    s.smonta();
  });
});
