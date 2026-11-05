import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MYCITY_SELLER_ID } from '@/lib/products/mycitySeller';

/**
 * S05 · schede 583 e 2484 — «Nuovo prodotto» del pannello.
 */

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const inseriti: unknown[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: () => b,
        // Il negozio di sistema «MyCity» non c'è: il seed non è stato lanciato.
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        insert: (v: unknown) => { inseriti.push([t, v]); return b; },
      });
      return b;
    },
  }),
}));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (c: unknown) => unknown) => async (req: Request) =>
    req.headers.get('x-ruolo') === 'admin' ? h({ req, user: { id: 'admin-1' } }) : new Response('Solo admin', { status: 403 }),
}));

describe('nuovo prodotto dal pannello', () => {
  it('583: il server non accetta l’id del negozio MyCity se quel profilo non esiste; chi non è admin è rifiutato', async () => {
    const { POST } = await import('@/app/api/admin/products/route');
    const manda = (ruolo: string) => (POST as unknown as (r: Request) => Promise<Response>)(new Request('http://x', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ruolo': ruolo },
      body: JSON.stringify({ seller_id: MYCITY_SELLER_ID, name: 'Focaccia', price: 3 }),
    }));
    expect((await manda('seller')).status).toBe(403);
    const r = await manda('admin');
    expect(r.status).toBe(400);
    expect(inseriti).toEqual([]);
  });

  it('583: la tendina parte vuota con «— scegli il negozio —» (lettura del sorgente)', () => {
    const src = readFileSync('app/admin/products/new/page.tsx', 'utf8');
    expect(src).toMatch(/useState<string>\(''\)/);
    expect(src).toContain('— scegli il negozio —');
  });

  it('2484: con l’AI per i negozi spenta, niente importazione da link', () => {
    const src = readFileSync('app/admin/products/new/page.tsx', 'utf8');
    expect(src).toMatch(/\{AI_NEGOZI_ACCESA && \(\s*<ImportFromUrlBox/);
  });
});
