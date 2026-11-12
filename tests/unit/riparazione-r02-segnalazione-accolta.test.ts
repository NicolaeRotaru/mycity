import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R02-003 (12/11/2026) — Accogliere una segnalazione su un prodotto lo toglie dalla vetrina
 * (status 'draft') e lo scrive nel registro; un altro tipo non passa da qui.
 */

const scritture: Array<{ tabella: string; patch: unknown; id?: unknown }> = [];
const audit: unknown[] = [];
let segnalazione: Record<string, unknown> | null = null;

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: async (e: unknown) => { audit.push(e); } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const voce: { tabella: string; patch: unknown; id?: unknown } = { tabella, patch: null };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (_c: string, v: unknown) => { voce.id = v; return q; };
      q.update = (p: unknown) => { voce.patch = p; scritture.push(voce); return q; };
      q.maybeSingle = async () => ({ data: segnalazione, error: null });
      q.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: voce.patch ? [{ id: voce.id }] : [], error: null }).then(ok);
      return q;
    },
  }),
}));

import { POST } from '@/app/api/admin/segnalazioni/accogli/route';

const ID = '00000000-0000-4000-8000-000000000042';
const PRODOTTO = '00000000-0000-4000-8000-0000000000aa';
const chiama = () =>
  (POST as unknown as (r: Request) => Promise<Response>)(
    new Request('http://x/api/admin/segnalazioni/accogli', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ID }),
    }),
  );

describe('R02-003 · accogliere una segnalazione su un prodotto', () => {
  beforeEach(() => { scritture.length = 0; audit.length = 0; });

  it('il prodotto esce dalla vetrina e l azione finisce nel registro', async () => {
    segnalazione = { id: ID, tipo: 'prodotto', oggetto_id: PRODOTTO };
    const res = await chiama();
    expect(res.status).toBe(200);
    expect(scritture).toEqual([{ tabella: 'products', patch: { status: 'draft' }, id: PRODOTTO }]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'product.hide', targetId: PRODOTTO });
  });

  it('una recensione non passa da qui e non si tocca nessun prodotto', async () => {
    segnalazione = { id: ID, tipo: 'recensione', oggetto_id: PRODOTTO };
    const res = await chiama();
    expect(res.status).toBe(409);
    expect(scritture).toEqual([]);
  });
});
