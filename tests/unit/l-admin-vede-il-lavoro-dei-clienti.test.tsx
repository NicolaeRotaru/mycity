/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 — L'AMMINISTRATORE VEDE IL LAVORO DEI CLIENTI, IN SOLA LETTURA.
 * Nicola: «dammi modo di accedere all'account Caffè di Piacenza» → «vederlo da Admin». L'account del Caffè ha
 * ancora l'email di sistema: invece di toccarlo, la pagina Admin mostra le sue voci dei servizi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const stato = vi.hoisted(() => ({ ruolo: 'admin' as string, erroreNomi: null as null | { message: string } }));

vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
// Portiere finto delle rotte admin: chi non è admin riceve 403. Il portiere vero (withAdminAuth) lo prova middleware.test.ts.
vi.mock('@/lib/api/middleware', async () => {
  const { ApiErrors } = await import('@/lib/api/responses');
  return {
    withAdminAuth: (gestore: (ctx: Record<string, unknown>) => unknown) => (req: Request) =>
      stato.ruolo !== 'admin' ? ApiErrors.forbidden('Solo admin') : gestore({ req, user: { id: 'admin-1' }, profile: { role: stato.ruolo } }),
  };
});
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => ({
      select: () => ({
        in: (_c: string, ids: string[]) => {
          if (t !== 'profiles') throw new Error(`tabella inattesa ${t}`);
          if (stato.erroreNomi) return Promise.resolve({ data: null, error: stato.erroreNomi });
          const nomi: Record<string, string> = { '429d0e22-4b3f-40db-8f81-ab331701fb81': 'Caffè di Piacenza', '11111111-1111-1111-1111-5d9000000001': 'SDG Agenzia' };
          return Promise.resolve({ data: ids.map((id) => ({ id, store_name: nomi[id] ?? null })), error: null });
        },
      }),
    }),
  }),
}));

import { GET } from '@/app/api/admin/lavoro-consegnato/route';
import { CAFFE_DI_PIACENZA_ID } from '@/lib/agenzia/lavoro-consegnato/siti';
import LavoroDeiClienti from '@/app/admin/lavoro-consegnato/page';

const chiama = async () => (GET as unknown as (r: Request) => Promise<Response>)(new Request('https://mycity.example/api/admin/lavoro-consegnato'));

describe('la rotta del lavoro dei clienti', () => {
  afterEach(() => { stato.ruolo = 'admin'; stato.erroreNomi = null; });

  it('chi non è amministratore non legge niente, nemmeno un venditore', async () => {
    stato.ruolo = 'seller';
    const r = await chiama();
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).not.toContain('Caffè di Piacenza');
  });

  it("l'amministratore vede il Caffè di Piacenza col suo sito Business", async () => {
    const r = await chiama();
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { negozi: Array<{ negozioId: string; nome: string; lavoro: { fascia: string; sito?: { titolo: string } } }> } };
    const caffe = corpo.data.negozi.find((n) => n.negozioId === CAFFE_DI_PIACENZA_ID);
    expect(caffe?.nome).toBe('Caffè di Piacenza');
    expect(caffe?.lavoro.fascia).toBe('business');
    expect(caffe?.lavoro.sito?.titolo).toContain('Caffè di Piacenza');
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });

  it('se i nomi non si leggono, la pagina resta utile con gli id', async () => {
    stato.erroreNomi = { message: 'giù' };
    const corpo = (await (await chiama()).json()) as { data: { negozi: Array<{ negozioId: string; nome: string }> } };
    expect(corpo.data.negozi.find((n) => n.negozioId === CAFFE_DI_PIACENZA_ID)?.nome).toBe(CAFFE_DI_PIACENZA_ID);
  });
});

describe('la pagina Admin «Lavoro dei clienti»', () => {
  let root: Root | null = null;
  let box: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); box?.remove(); root = null; box = null; vi.unstubAllGlobals(); });

  it('scelto il Caffè, mostra la sua voce «Sito web» come la vede lui', async () => {
    const risposta = await (await chiama()).json();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(risposta), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, createElement(LavoroDeiClienti))); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const bottone = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Caffè di Piacenza'));
    expect(bottone?.textContent).toContain('Business');
    await act(async () => { bottone!.click(); });
    expect(box.textContent).toContain('Il sito del Caffè di Piacenza');
    expect(box.textContent).toContain('Cosa ha di Business');
    // Il Caffè ha solo il sito: niente bottoni per social e analisi.
    const voci = [...box.querySelectorAll('[aria-label="Scegli la voce"] button')].map((b) => b.textContent);
    expect(voci).toEqual(['Sito web']);
  });
});
