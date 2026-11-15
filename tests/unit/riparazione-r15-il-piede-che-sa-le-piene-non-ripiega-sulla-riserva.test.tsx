import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R15-002 — il piede e le categorie, disegnato davvero sul server con un QueryClient vero.
 *
 * Due garanzie insieme:
 *  - il piede non resta mai senza categorie nell'HTML del server (il difetto chiuso il 1/11,
 *    commit dfad0263, e riaperto per un giorno da fa97898e): finché non sa quali sono piene le
 *    elenca tutte, come prima;
 *  - quando sa quali sono piene, non ne mette in mostra nessuna vuota. Nemmeno se l'elenco delle
 *    categorie è caduto o è arrivato vuoto: prima ripiegava sulle otto di riserva, che non hanno id
 *    e passavano intere, sette vuote.
 */

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'is', 'in', 'gt']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isSeller: false, isRider: false, isAuthenticated: false }),
}));
vi.mock('@/components/hooks/useBranding', async () => {
  const { defaultBranding } = await import('@/lib/site-branding');
  return { useBranding: () => defaultBranding() };
});
vi.mock('@/components/NewsletterForm', () => ({ default: () => null }));

const { default: Footer } = await import('@/components/Footer');

const ELENCO = ['categories', 'tree'];
const PIENE = ['categories', 'con-prodotti'];

// «Ferramenta» non sta nella riserva scritta nel piede: se compare, viene dall'elenco vero.
const CATEGORIE = [
  { id: 'c-ali', slug: 'alimentari', name: 'Alimentari', parent_id: null },
  { id: 'c-ele', slug: 'elettronica', name: 'Elettronica', parent_id: null },
  { id: 'c-fer', slug: 'ferramenta', name: 'Ferramenta', parent_id: null },
  { id: 'c-pasta', slug: 'pasta', name: 'Pasta', parent_id: 'c-ali' },
];

async function piedeSulServer(prepara: (qc: QueryClient) => void | Promise<void> = () => {}): Promise<string> {
  const qc = new QueryClient();
  await prepara(qc);
  return renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Footer)));
}

/** Una lettura che è caduta: la domanda resta in memoria senza dati. */
const caduta = (qc: QueryClient, chiave: string[]) =>
  qc.prefetchQuery({ queryKey: chiave, queryFn: () => Promise.reject(new Error('rete')), retry: false });

const linkDiCategoria = (html: string) => html.match(/href="\/category\/[^"]+"/g) ?? [];

describe('R15-002 — finché non sa quali sono piene, il piede non resta senza categorie', () => {
  it('con le sole categorie lette elenca le principali dell’elenco vero, Alimentari compresa', async () => {
    const html = await piedeSulServer((qc) => { qc.setQueryData(ELENCO, CATEGORIE); });
    expect(linkDiCategoria(html)).toEqual([
      'href="/category/alimentari"',
      'href="/category/elettronica"',
      'href="/category/ferramenta"',
    ]);
    expect(html).toContain('href="/categorie"');
  });

  it('senza nessuna lettura elenca la riserva, non una colonna vuota', async () => {
    const html = await piedeSulServer();
    expect(linkDiCategoria(html)).toContain('href="/category/alimentari"');
    expect(linkDiCategoria(html)).toHaveLength(8);
  });

  it('se cade la lettura delle piene elenca tutto l’elenco, come prima', async () => {
    const html = await piedeSulServer(async (qc) => {
      qc.setQueryData(ELENCO, CATEGORIE);
      await caduta(qc, PIENE);
    });
    expect(linkDiCategoria(html)).toHaveLength(3);
  });
});

describe('R15-002 — quando sa quali sono piene, nessuna categoria vuota', () => {
  it('con l’elenco e le piene lette elenca solo quelle con qualcosa dentro', async () => {
    const html = await piedeSulServer((qc) => {
      qc.setQueryData(ELENCO, CATEGORIE);
      qc.setQueryData(PIENE, ['c-ali', 'c-pasta']);
    });
    expect(linkDiCategoria(html)).toEqual(['href="/category/alimentari"']);
  });

  it('se l’elenco delle categorie è caduto non ripiega sulle otto di riserva (sette vuote)', async () => {
    const html = await piedeSulServer(async (qc) => {
      await caduta(qc, ELENCO);
      qc.setQueryData(PIENE, ['c-ali']);
    });
    expect(linkDiCategoria(html)).toEqual([]);
    expect(html).toContain('href="/categorie"');
  });

  it('se l’elenco delle categorie è arrivato vuoto non ripiega sulla riserva', async () => {
    const html = await piedeSulServer((qc) => {
      qc.setQueryData(ELENCO, []);
      qc.setQueryData(PIENE, ['c-ali']);
    });
    expect(linkDiCategoria(html)).toEqual([]);
    expect(html).toContain('href="/categorie"');
  });
});
