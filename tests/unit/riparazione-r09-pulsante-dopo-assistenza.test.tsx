/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R09-006 R09-007 — Un lavoro chiuso con «chiedi all'assistenza prima di avviarne un altro» non deve
 * far tornare il pulsante «Avvia sul catalogo»: ne' dopo un clic sulla scheda di un'operazione, ne'
 * dopo un ricaricamento (la rotta di stato senza jobId lo restituisce, e la pagina non lo dimentica).
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

const MOTIVO =
  "invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all'assistenza prima di avviarne un altro";
const riga = (extra: Record<string, unknown> = {}) => ({
  id: 'job-1', seller_id: 'negozio-1', operation: 'improve', status: 'failed', batch_id: null,
  target_lang: null, total: 12, results: [], created_at: '2026-11-20T10:00:00Z', error: MOTIVO, ...extra,
});
const senzaId = async () =>
  (await (await stato(new Request('http://localhost/api/ai/catalog-batch/status') as never)).json()) as { id: string; status: string } | null;

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
  db.lavori = [];
  try { window.localStorage.clear(); } catch { /* niente memoria */ }
  vi.stubGlobal('fetch', async (percorso: string) => {
    if (percorso.startsWith('/api/ai/catalog-batch/status')) return stato(new Request(`http://localhost${percorso}`) as never);
    throw new Error(`chiamata inattesa: ${percorso}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('R09-006 R09-007 · la rotta di stato senza jobId', () => {
  it('con solo un lavoro chiuso con «chiedi all\'assistenza»: lo restituisce', async () => {
    db.lavori = [riga()];
    expect(await senzaId()).toMatchObject({ id: 'job-1', status: 'failed' });
  });

  it('un lavoro chiuso con un altro motivo: null, come prima', async () => {
    db.lavori = [riga({ error: 'il lotto non e\' finito entro 24 ore: chiuso.' })];
    expect(await senzaId()).toBeNull();
    db.lavori = [riga({ status: 'applied', error: null })];
    expect(await senzaId()).toBeNull();
  });

  it('il lavoro di un altro negozio non si restituisce mai', async () => {
    db.lavori = [riga({ seller_id: 'altro-negozio' })];
    expect(await senzaId()).toBeNull();
  });
});

describe('R09-006 R09-007 · il pulsante «Avvia sul catalogo»', () => {
  it('dopo un ricaricamento (nessun lavoro ricordato) non torna', async () => {
    db.lavori = [riga()];
    const s = await apriIlLotto();
    expect(document.body.textContent ?? '').toMatch(/chiedi all.assistenza/i);
    expect(pulsante('Avvia sul catalogo'), 'il pulsante torna dopo il ricaricamento').toBeUndefined();
    s.smonta();
  });

  it('dopo il clic su una scheda operazione non torna', async () => {
    db.lavori = [riga()];
    window.localStorage.setItem('mycity:ai-batch:lavoro', 'job-1');
    const s = await apriIlLotto();
    expect(pulsante('Avvia sul catalogo')).toBeUndefined();
    const scheda = Array.from(document.querySelectorAll('button')).find((b) => /Ri-descrivi|Modera/.test(b.textContent ?? '') && !/Avvia/.test(b.textContent ?? ''))!;
    s.agisci(() => clic(scheda));
    await aspetta();
    expect(pulsante('Avvia sul catalogo'), 'il clic sulla scheda ha azzerato il lavoro').toBeUndefined();
    s.smonta();
  });

  it('controprova: un lavoro chiuso con un altro motivo lascia il pulsante', async () => {
    db.lavori = [riga({ error: 'il lotto non e\' finito entro 24 ore: chiuso.' })];
    window.localStorage.setItem('mycity:ai-batch:lavoro', 'job-1');
    const s = await apriIlLotto();
    expect(pulsante('Avvia sul catalogo')).toBeDefined();
    s.smonta();
  });
});
