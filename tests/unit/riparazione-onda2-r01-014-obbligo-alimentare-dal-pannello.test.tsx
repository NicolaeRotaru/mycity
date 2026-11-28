// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';

/**
 * R01-014 (onda 2) — L'obbligo di dichiarare allergeni e ingredienti (Reg. UE 1169/2011) è una proprietà
 * della categoria dalla migrazione 363 (`richiede_dichiarazioni_alimentari`), ma il pannello non lo
 * lasciava accendere: una radice nuova «Gastronomia» nasceva senza obbligo, e il negozio pubblicava
 * alimenti senza allergeni. E quando il database rifiutava il cambio di slug di «Alimentari» il pannello
 * diceva «Foto non ammessa».
 */

const stato = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  righe: [] as Array<Record<string, unknown>>,
  chiamate: [] as Array<{ method: string; body: Record<string, unknown> }>,
}));

vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) => h({ req, user: { id: 'admin-1' } }),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: async () => ({ data: stato.righe, error: null }) }),
  },
}));

const rotta = await import('@/app/api/admin/categories/route');
const { default: Pagina } = await import('@/app/admin/categories/page');

const chiama = (method: 'POST' | 'PATCH', body: Record<string, unknown>) =>
  (rotta[method] as unknown as (r: Request) => Promise<Response>)(
    new Request('http://x/api/admin/categories', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );

beforeEach(() => {
  stato.db = fintoDatabase({ categories: [] });
  stato.chiamate = [];
});

describe('R01-014 · la rotta delle categorie', () => {
  it('una radice nuova si crea con l\'obbligo di allergeni e ingredienti', async () => {
    const r = await chiama('POST', { name: 'Gastronomia', slug: 'gastronomia', richiede_dichiarazioni_alimentari: true });
    expect(r.status, await r.clone().text()).toBe(200);
    expect(stato.db.tabelle.categories[0]).toMatchObject({ slug: 'gastronomia', richiede_dichiarazioni_alimentari: true });
  });

  it('l\'obbligo si accende su una categoria che c\'è già', async () => {
    stato.db.tabelle.categories = [{ id: '00000000-0000-4000-8000-0000000000c1', slug: 'gastronomia', name: 'Gastronomia', richiede_dichiarazioni_alimentari: false }];
    const r = await chiama('PATCH', { id: '00000000-0000-4000-8000-0000000000c1', richiede_dichiarazioni_alimentari: true });
    expect(r.status).toBe(200);
    expect(stato.db.tabelle.categories[0].richiede_dichiarazioni_alimentari).toBe(true);
  });

  it('il rifiuto del grilletto della 363 arriva com\'è, non come «Foto non ammessa»', async () => {
    stato.db.tabelle.categories = [{ id: '00000000-0000-4000-8000-0000000000c2', slug: 'alimentari', name: 'Alimentari', richiede_dichiarazioni_alimentari: true }];
    stato.db.guasto = () => ({ code: '23514', message: 'Lo slug di «Alimentari» non si cambia: da questa categoria dipende l\'obbligo di allergeni e ingredienti.' });
    const r = await chiama('PATCH', { id: '00000000-0000-4000-8000-0000000000c2', slug: 'cibo' });
    expect(r.status).toBe(400);
    const testo = await r.text();
    expect(testo).toContain('non si cambia');
    expect(testo).not.toContain('Foto non ammessa');
  });
});

describe('R01-014 · il pannello delle categorie', () => {
  let root: Root;
  let c: HTMLDivElement;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  async function monta() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    c = document.createElement('div');
    document.body.appendChild(c);
    root = createRoot(c);
    await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
    for (let i = 0; i < 6; i++) await pausa();
  }
  afterEach(async () => { await act(async () => root.unmount()); c.remove(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      stato.chiamate.push({ method: String(init.method), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, data: { id: 'n' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });
  const caselle = () => Array.from(c.querySelectorAll('label')).filter((l) => l.textContent?.startsWith('Alimenti: obbliga allergeni e ingredienti'))
    .map((l) => document.getElementById(l.htmlFor) as HTMLInputElement);

  it('la nuova categoria con la casella spuntata manda l\'obbligo', async () => {
    stato.righe = [];
    await monta();
    const nome = Array.from(c.querySelectorAll('label')).find((l) => l.textContent?.startsWith('Nuova categoria'))!;
    const campo = document.getElementById(nome.htmlFor) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(campo, 'Gastronomia'); campo.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(c.textContent).toContain('nasce senza l\'obbligo di allergeni e ingredienti');
    await act(async () => { caselle()[0].click(); });
    await act(async () => { (c.querySelector('form') as HTMLFormElement).requestSubmit(); });
    for (let i = 0; i < 4; i++) await pausa();
    expect(stato.chiamate.find((x) => x.method === 'POST')?.body).toMatchObject({ name: 'Gastronomia', richiede_dichiarazioni_alimentari: true });
  });

  it('su una categoria con l\'obbligo acceso la casella è spuntata e non si toglie', async () => {
    stato.righe = [{ id: 'c1', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null, sort_order: 0, featured: false, richiede_dichiarazioni_alimentari: true }];
    await monta();
    const riga = caselle().find((x) => x.closest('form') === null)!;
    expect(riga.checked).toBe(true);
    expect(riga.disabled).toBe(true);
  });
});
