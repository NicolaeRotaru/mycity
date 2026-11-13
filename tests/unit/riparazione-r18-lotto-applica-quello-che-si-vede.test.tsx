/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R18-010 — «Migliora tutto il catalogo» faceva vedere i primi 50 risultati (job.results.slice(0, 50))
 * e «Applica» mandava solo {jobId}: la rotta, senza productIds, applicava tutti i risultati, fino
 * a 200 prodotti. Un negozio con 120 prodotti approvava i 50 che vedeva e se ne trovava riscritti 120.
 *
 * Qui si monta la pagina vera, si preme «Applica a tutti», e la sua richiesta arriva alla rotta
 * vera (app/api/ai/catalog-batch/apply/route.ts) con un database finto: i prodotti riscritti devono
 * essere esattamente quelli che la pagina ha mostrato. Lo stesso per «Metti in bozza i segnalati».
 */

const db = vi.hoisted(() => ({
  lavoro: null as Record<string, unknown> | null,
  prodotti: [] as Record<string, unknown>[],
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
  inBozza: [] as unknown[],
  categorie: [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }],
}));

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
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/ai/moderation', () => ({ classifyProductPolicy: async () => ({ allowed: true }) }));

vi.mock('@/lib/supabase/server', () => {
  type D = { op: 'select' | 'update'; valori: Record<string, unknown> | null; filtri: Record<string, unknown>; dentro: unknown[] | null };
  const risolvi = (tabella: string, d: D, una: boolean) => {
    if (tabella === 'categories') return { data: db.categorie, error: null };
    if (tabella === 'catalog_ai_jobs') {
      if (d.op === 'update') {
        if (d.filtri.status !== undefined && db.lavoro?.status !== d.filtri.status) return { data: [], error: null };
        db.lavoro = { ...db.lavoro, ...d.valori };
        return { data: [{ id: db.lavoro.id }], error: null };
      }
      return { data: db.lavoro ? { ...db.lavoro } : null, error: null };
    }
    if (d.op === 'update' && d.dentro) {
      // «Metti in bozza i segnalati»: un update solo, con .in('id', …).
      db.inBozza.push(...d.dentro);
      return { data: d.dentro.map((id) => ({ id })), error: null };
    }
    if (d.op === 'update') {
      db.scritture.push({ id: d.filtri.id, valori: d.valori ?? {} });
      return { data: null, error: null };
    }
    const tutti = d.dentro ? db.prodotti.filter((p) => d.dentro!.includes(p.id)) : db.prodotti;
    return { data: una ? null : tutti, error: null };
  };
  const tabella = (nome: string) => {
    const d: D = { op: 'select', valori: null, filtri: {}, dentro: null };
    const q = {
      select: () => q,
      order: () => q,
      in: (_c: string, v: unknown[]) => { d.dentro = v; return q; },
      eq: (c: string, v: unknown) => { d.filtri[c] = v; return q; },
      update: (v: Record<string, unknown>) => { d.op = 'update'; d.valori = v; return q; },
      single: async () => risolvi(nome, d, true),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risolvi(nome, d, false)).then(ok, ko),
    };
    return q;
  };
  return { getAdminSupabase: () => ({ from: tabella }) };
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

import { POST as applica } from '@/app/api/ai/catalog-batch/apply/route';

const prodotto = (id: string) => ({
  id, seller_id: 'negozio-1', name: `Prodotto ${id}`, description: 'Una descrizione abbastanza lunga.',
  price: 5, compare_at_price: null, unit: 'pezzo', condition: 'nuovo', stock: 3, status: 'available',
  images: ['https://mycity.test/f.jpg'], tags: [], has_variants: false, category_id: 'casa', attributes: {},
});

/** Il lavoro come lo vede il server e come lo racconta /status alla pagina. */
function lavoroPronto(operation: 'improve' | 'moderate', quanti: number) {
  const ids = Array.from({ length: quanti }, (_, i) => `p${i + 1}`);
  db.prodotti = ids.map(prodotto);
  const results = ids.map((id, i) =>
    operation === 'moderate'
      ? { product_id: id, flagged: true, reason: `Segnalato ${i + 1}` }
      : { product_id: id, patch: { name: `Nome nuovo ${i + 1}` } },
  );
  db.lavoro = { id: 'job-1', seller_id: 'negozio-1', operation, status: 'ready', results };
  return {
    id: 'job-1', operation, status: 'ready', total: quanti, targetLang: null, error: null,
    results, counts: { total: quanti, withChanges: quanti },
  };
}

async function aspetta() {
  for (let i = 0; i < 15; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
}

const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().includes(testo)) as HTMLButtonElement | undefined;
const clic = (b: HTMLButtonElement) => b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

let statoPerLaPagina: unknown = null;

beforeEach(() => {
  db.scritture.length = 0;
  db.inBozza.length = 0;
  try { window.localStorage.clear(); } catch { /* niente memoria */ }
  vi.stubGlobal('fetch', async (percorso: string, init?: RequestInit) => {
    if (percorso.startsWith('/api/ai/catalog-batch/status')) {
      return new Response(JSON.stringify(statoPerLaPagina), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (percorso === '/api/ai/catalog-batch/apply') {
      return applica(new Request(`http://localhost${percorso}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: init?.body as string }) as never);
    }
    throw new Error(`chiamata inattesa: ${percorso}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function apriIlLotto() {
  const { default: Pagina } = await import('@/app/seller/products/ai-batch/page');
  const s = accendi(Pagina as ComponentType);
  await aspetta();
  s.agisci(() => clic(pulsante('Catalogo AI')!));
  await aspetta();
  return s;
}

describe('R18-010 — «Applica» riscrive solo quello che il negozio ha visto', () => {
  it('120 proposte: i prodotti riscritti sono esattamente quelli mostrati nell’anteprima', async () => {
    statoPerLaPagina = lavoroPronto('improve', 120);
    const s = await apriIlLotto();
    const testo = document.body.textContent ?? '';
    const mostrati = new Set(Array.from({ length: 120 }, (_, i) => i + 1).filter((n) => testo.includes(`Nome nuovo ${n}`)).map((n) => `p${n}`));
    expect(mostrati.size, 'l’anteprima non mostra nessuna proposta').toBeGreaterThan(0);
    s.agisci(() => clic(pulsante('Applica a tutti')!));
    await aspetta();
    const riscritti = db.scritture.map((w) => String(w.id));
    expect(riscritti.length, 'nessun prodotto riscritto').toBeGreaterThan(0);
    const nonVisti = riscritti.filter((id) => !mostrati.has(id));
    expect(nonVisti.length, `riscritti senza essere stati mostrati: ${nonVisti.length} (per esempio ${nonVisti.slice(0, 3).join(', ')})`).toBe(0);
    expect(riscritti.length).toBe(mostrati.size);
    s.smonta();
  });

  it('«Metti in bozza i segnalati»: va in bozza solo chi è comparso nell’elenco', async () => {
    statoPerLaPagina = lavoroPronto('moderate', 80);
    const s = await apriIlLotto();
    const testo = document.body.textContent ?? '';
    const mostrati = new Set(Array.from({ length: 80 }, (_, i) => i + 1).filter((n) => testo.includes(`Segnalato ${n}`)).map((n) => `p${n}`));
    expect(mostrati.size).toBeGreaterThan(0);
    s.agisci(() => clic(pulsante('Metti in bozza i segnalati')!));
    await aspetta();
    const nascosti = db.inBozza.map(String);
    expect(nascosti.length).toBeGreaterThan(0);
    expect(nascosti.filter((id) => !mostrati.has(id)).length, 'messi in bozza prodotti mai mostrati').toBe(0);
    s.smonta();
  });

  it('la rotta, con l’elenco dei prodotti, non scrive nient’altro', async () => {
    lavoroPronto('improve', 5);
    const res = await applica(new Request('http://localhost/api/ai/catalog-batch/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: 'job-1', productIds: ['p2', 'p4'] }),
    }) as never);
    expect(res.status).toBe(200);
    expect(db.scritture.map((w) => w.id).sort()).toEqual(['p2', 'p4']);
  });
});
