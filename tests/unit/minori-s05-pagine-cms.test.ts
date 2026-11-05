import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S05 · schede 40 e 225 (pagine e vetrina):
 * ① un solo blocco non più valido non svuota la pagina nell'editor (il primo
 *   salvataggio cancellava il resto): si tolgono solo i blocchi rotti e si dicono;
 * ② home, aspetto del sito e pagine lasciano una riga nel registro delle azioni;
 * ③ chi non è admin riceve ancora il rifiuto.
 */

let riga: unknown = null;
const audit = vi.fn(async (_e: unknown) => {});
const catena = () => {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b,
    maybeSingle: async () => ({ data: riga, error: null }),
    upsert: async () => ({ error: null }),
  });
  return b;
};
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: catena }) }));
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    req.headers.get('x-ruolo') === 'admin'
      ? h({ req, user: { id: 'admin-1' }, params: { slug: 'about' } })
      : new Response('Solo admin', { status: 403 }),
}));

const BUONO = { id: 'b1', type: 'richText', enabled: true, config: { body: '<p>Ciao</p>' } };
const ROTTO = { id: 'b2', type: 'banner', enabled: true, config: { heading: 42 } };

function req(ruolo: string, metodo = 'GET', corpo?: unknown) {
  return new Request('http://x/api', {
    method: metodo, headers: { 'content-type': 'application/json', 'x-ruolo': ruolo },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}
type H = (r: Request) => Promise<Response>;

beforeEach(() => { audit.mockClear(); riga = null; });

describe('pagine a blocchi', () => {
  it('40: un blocco rotto si toglie, i buoni restano, e lo si dice', async () => {
    riga = { title: 'Chi siamo', status: 'published', sections: [BUONO, ROTTO] };
    const { GET } = await import('@/app/api/admin/cms/[slug]/route');
    const res = await (GET as unknown as H)(req('admin'));
    const j = (await res.json()) as { data: { page: { title: string; sections: unknown[] }; scartati: unknown[] } };
    expect(j.data.page.title).toBe('Chi siamo');
    expect(j.data.page.sections).toHaveLength(1);
    expect(j.data.scartati).toHaveLength(1);
  });

  it('chi non è admin non legge né scrive le pagine', async () => {
    const { GET, PUT } = await import('@/app/api/admin/cms/[slug]/route');
    expect((await (GET as unknown as H)(req('buyer'))).status).toBe(403);
    expect((await (PUT as unknown as H)(req('seller', 'PUT', { page: { title: '', status: 'draft', sections: [] } }))).status).toBe(403);
    expect(audit).not.toHaveBeenCalled();
  });

  it('225: pubblicare una pagina lascia la riga nel registro', async () => {
    const { PUT } = await import('@/app/api/admin/cms/[slug]/route');
    const res = await (PUT as unknown as H)(req('admin', 'PUT', { page: { title: 'Chi siamo', status: 'published', sections: [BUONO] } }));
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cms.update', targetId: 'about', actorId: 'admin-1' }));
  });

  it('225: salvare l’aspetto del sito lascia la riga nel registro, e un buyer è rifiutato', async () => {
    const { PUT } = await import('@/app/api/admin/branding/route');
    const { normalizeBranding } = await import('@/lib/site-branding');
    expect((await (PUT as unknown as H)(req('buyer', 'PUT', { branding: normalizeBranding(null) }))).status).toBe(403);
    const res = await (PUT as unknown as H)(req('admin', 'PUT', { branding: normalizeBranding(null) }));
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'branding.update' }));
  });

  it('225: salvare la home lascia la riga nel registro', async () => {
    const { PUT } = await import('@/app/api/admin/home/route');
    const { defaultHomeSite } = await import('@/lib/home-site');
    const res = await (PUT as unknown as H)(req('admin', 'PUT', { site: defaultHomeSite() }));
    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'home.update' }));
  });
});
