/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R02-005 — Un invio del lotto rimasto senza risposta (la riga «in invio»
 * col motivo «invio senza risposta») tornava da /status come un «in invio»
 * qualunque, e la pagina mostrava la rotella «tra poco lo vedi partire» per
 * 24 ore. Passati 3 minuti (la rotta di avvio vive al massimo 120 secondi)
 * lo stato lo dice alla pagina, e la pagina toglie la rotella e dice com'e'.
 *
 * Qui la pagina vera chiede lo stato alla rotta vera, con un database finto.
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
        return { data: scelte.map((r) => ({ id: r.id })), error: null };
      }
      const out = limite === null ? scelte : scelte.slice(0, limite);
      return { data: una ? out[0] ?? null : out, error: null };
    };
    const q = {
      select: () => q,
      order: () => q,
      eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
      in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return q; },
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
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';

const ADESSO = new Date('2026-11-21T10:00:00Z');
const minutiFa = (m: number) => new Date(ADESSO.getTime() - m * 60_000).toISOString();
const rigaInInvio = (minuti: number, error: string | null = INVIO_SENZA_RISPOSTA) => ({
  id: 'job-1', seller_id: 'negozio-1', operation: 'improve', status: 'submitting', batch_id: null,
  target_lang: null, total: 12, results: [], created_at: minutiFa(minuti), error,
});
const chiedi = async () =>
  (await (await stato(new Request('http://localhost/api/ai/catalog-batch/status?jobId=job-1') as never)).json()) as {
    status: string; incerto?: boolean;
  };

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
  vi.stubGlobal('fetch', async (percorso: string) => {
    if (percorso.startsWith('/api/ai/catalog-batch/status')) return stato(new Request(`http://localhost${percorso}`) as never);
    throw new Error(`chiamata inattesa: ${percorso}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('R02-005 · lo stato dice quando un invio e\' rimasto senza risposta', () => {
  it('senza risposta da 10 minuti: ancora aperto, ma «incerto»', async () => {
    db.lavori = [rigaInInvio(10)];
    const corpo = await chiedi();
    expect(corpo.status).toBe('submitting');
    expect(corpo.incerto).toBe(true);
    expect(db.lavori[0].status).toBe('submitting');
  });

  it('da un minuto: l\'invio puo\' ancora rispondere, non e\' incerto', async () => {
    db.lavori = [rigaInInvio(1)];
    expect((await chiedi()).incerto).toBeFalsy();
  });

  it('un «in invio» senza quel motivo non e\' incerto', async () => {
    db.lavori = [rigaInInvio(10, null)];
    expect((await chiedi()).incerto).toBeFalsy();
  });
});

describe('R02-005 · la pagina non mostra la rotella su un invio senza risposta', () => {
  it('senza risposta da 10 minuti: niente rotella né «tra poco lo vedi partire», e si dice com\'e\'', async () => {
    db.lavori = [rigaInInvio(10)];
    const s = await apriIlLotto();
    const testo = document.body.textContent ?? '';
    expect(testo).not.toMatch(/tra poco lo vedi partire/);
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(testo).toMatch(/non ha avuto risposta/);
    s.smonta();
  });

  it('in invio da un minuto: la rotella resta', async () => {
    db.lavori = [rigaInInvio(1)];
    const s = await apriIlLotto();
    expect(document.body.textContent ?? '').toMatch(/tra poco lo vedi partire/);
    expect(document.querySelector('.animate-spin')).not.toBeNull();
    s.smonta();
  });
});
