// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, type Domanda } from './aiuti/cabina-admin';

/**
 * S05 · scheda 647 — la pagina Attività diceva «0 visitatori» anche quando il
 * registro era spento (manca la chiave di servizio) o la lettura era caduta.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); vi.unstubAllGlobals(); });

async function apri(statoRegistro: number, corpo: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(corpo), { status: statoRegistro })));
  const mod = (await import('@/app/admin/activity/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('pagina Attività: uno zero non letto non è uno zero', () => {
  it('lettura caduta → avviso «Non sono riuscito a leggere» e trattini, non «0»', async () => {
    fake.rispondi = (q: Domanda) =>
      q.tabella === 'activity_events' ? { data: null, error: { message: 'giù' } } : { data: [], error: null };
    const host = await apri(200, { ok: true, data: { acceso: true } });
    expect(host.textContent).toContain('Non sono riuscito a leggere');
    const kpi = [...host.querySelectorAll('p')].find((p) => p.textContent === 'Visitatori 24h');
    expect(kpi?.previousElementSibling?.textContent).toBe('—');
  });

  it('registro spento (503 dalla rotta) → avviso fisso «Registro visite spento»', async () => {
    fake.rispondi = () => ({ data: [], error: null });
    const host = await apri(503);
    expect(host.textContent).toContain('Registro visite spento');
  });

  it('registro acceso e lettura riuscita → nessun avviso', async () => {
    fake.rispondi = () => ({ data: [], error: null });
    const host = await apri(200, { ok: true, data: { acceso: true } });
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('GET /api/admin/registro-visite', () => {
  it('chi non è admin riceve ancora il rifiuto', async () => {
    vi.resetModules();
    vi.doMock('@/lib/api/middleware', () => ({
      withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
        req.headers.get('x-ruolo') === 'admin' ? h({ req }) : new Response('no', { status: 403 }),
    }));
    // La chiave di servizio manca, come oggi in produzione.
    vi.doMock('@/lib/env', () => ({ env: { supabaseServiceRoleKey: () => undefined } }));
    const { GET } = await import('@/app/api/admin/registro-visite/route');
    const rotta = GET as unknown as (r: Request) => Promise<Response>;
    const res = await rotta(new Request('http://x/api/admin/registro-visite', { headers: { 'x-ruolo': 'buyer' } }));
    expect(res.status).toBe(403);
    const ok = await rotta(new Request('http://x/api/admin/registro-visite', { headers: { 'x-ruolo': 'admin' } }));
    expect(((await ok.json()) as { data: { acceso: boolean } }).data.acceso).toBe(false);
    vi.doUnmock('@/lib/api/middleware');
    vi.doUnmock('@/lib/env');
  });
});
