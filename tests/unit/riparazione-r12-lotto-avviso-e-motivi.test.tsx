/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { accendi } from './aiuti/schermo';

/**
 * R12-014 — La rotta «applica» del lavoro sul catalogo può rispondere con un `avviso` e con più
 * prodotti saltati, ciascuno col suo motivo. La pagina non leggeva l'avviso e mostrava solo i
 * primi tre motivi: il negoziante non sapeva perché il lavoro non si poteva ripetere.
 */
const avvisi = vi.hoisted(() => ({ errori: [] as string[], warning: [] as string[], tutti: [] as string[] }));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
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
vi.mock('sonner', () => ({
  toast: {
    success: () => {},
    info: () => {},
    error: (m: string) => { avvisi.errori.push(String(m)); avvisi.tutti.push(String(m)); },
    warning: (m: string) => { avvisi.warning.push(String(m)); avvisi.tutti.push(String(m)); },
  },
}));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: () => {} }));

let rispostaApplica: Record<string, unknown> = {};
const lavoro = {
  id: 'job-1', operation: 'improve', status: 'ready', total: 2, targetLang: null, error: null,
  results: [{ product_id: 'p1', patch: { name: 'Nome nuovo 1' } }, { product_id: 'p2', patch: { name: 'Nome nuovo 2' } }],
  counts: { total: 2, withChanges: 2 },
};

async function aspetta() {
  for (let i = 0; i < 15; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const pulsante = (testo: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim().includes(testo)) as HTMLButtonElement | undefined;
const clic = (b: HTMLButtonElement) => b.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  avvisi.errori.length = 0; avvisi.warning.length = 0; avvisi.tutti.length = 0;
  try { window.localStorage.clear(); } catch { /* niente memoria */ }
  vi.stubGlobal('fetch', async (percorso: string) => {
    if (percorso.startsWith('/api/ai/catalog-batch/status')) return json(lavoro);
    if (percorso === '/api/ai/catalog-batch/apply') return json(rispostaApplica);
    throw new Error(`chiamata inattesa: ${percorso}`);
  });
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

async function applicaIlLavoro() {
  const { default: Pagina } = await import('@/app/seller/products/ai-batch/page');
  const s = accendi(Pagina as ComponentType);
  await aspetta();
  s.agisci(() => clic(pulsante('Catalogo AI')!));
  await aspetta();
  s.agisci(() => clic(pulsante('Applica a tutti')!));
  await aspetta();
  s.smonta();
}

describe('R12-014 — la pagina dice l\'avviso della rotta e tutti i motivi', () => {
  it('l\'avviso della rotta arriva al negoziante', async () => {
    rispostaApplica = {
      ok: true, applied: 1, saltati: 1, ripetibile: false,
      esiti: [{ productId: 'p2', esito: 'saltato', motivo: 'Prodotto non più disponibile' }],
      avviso: 'Il lavoro resta chiuso: non si può rimettere in coda.',
    };
    await applicaIlLavoro();
    expect(avvisi.tutti.join(' | ')).toContain('Il lavoro resta chiuso: non si può rimettere in coda.');
  });

  it('un avviso senza prodotti saltati si legge lo stesso', async () => {
    rispostaApplica = { ok: true, applied: 2, saltati: 0, ripetibile: false, esiti: [], avviso: 'Avviso senza saltati.' };
    await applicaIlLavoro();
    expect(avvisi.tutti.join(' | ')).toContain('Avviso senza saltati.');
  });

  it('con cinque motivi diversi si leggono tutti e cinque', async () => {
    rispostaApplica = {
      ok: true, applied: 0, saltati: 5, ripetibile: true,
      esiti: ['uno', 'due', 'tre', 'quattro', 'cinque'].map((m, i) => ({ productId: `p${i}`, esito: 'saltato', motivo: `Motivo ${m}` })),
    };
    await applicaIlLavoro();
    const t = avvisi.errori.join(' | ');
    for (const m of ['uno', 'due', 'tre', 'quattro', 'cinque']) expect(t, `manca «Motivo ${m}»`).toContain(`Motivo ${m}`);
  });
});
