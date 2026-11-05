import { describe, it, expect, vi } from 'vitest';

/** S08 (5/11/2026) — scheda 1523: «Scarica i miei dati» legge ogni tabella con un tetto, e lo dice. */

const letture: Array<{ tabella: string; tetto: number | null }> = [];
const tante = Array.from({ length: 5000 }, (_, i) => ({ id: i }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: { id: string; email: string } }) => unknown) =>
    () => handler({ user: { id: 'u-1', email: 'anna@example.com' } }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const voce = { tabella, tetto: null as number | null };
      letture.push(voce);
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'or', 'order']) q[m] = () => q;
      q.limit = (n: number) => { voce.tetto = n; return q; };
      q.single = async () => ({ data: { id: 'u-1' }, error: null });
      q.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: tabella === 'notifications' ? tante : [], error: null }).then(ok);
      return q;
    },
  }),
}));

import { GET } from '@/app/api/account/export/route';

describe('Scarica i miei dati', () => {
  it('ogni elenco ha un tetto, e una sezione arrivata al tetto rende il file «incompleto»', async () => {
    const res = await (GET as unknown as () => Promise<Response>)();
    const corpo = await res.json();
    const senzaTetto = letture.filter((l) => l.tabella !== 'profiles' && l.tetto === null).map((l) => l.tabella);
    expect(senzaTetto, 'tabelle lette intere, senza tetto').toEqual([]);
    expect(corpo.sezioni_al_tetto).toContain('notifications');
    expect(corpo.export_metadata.export_completo).toBe(false);
    expect(res.headers.get('content-disposition')).toContain('INCOMPLETO');
  });
});
