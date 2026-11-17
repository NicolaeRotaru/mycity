import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R30-003 — Chi chiede la cancellazione dell'account non risulta «avvisato» del carrello.
 *
 * Alla richiesta di cancellazione (app/api/account/delete) il carrello mai avvisato si chiude
 * perché non parta più il promemoria. Lo si chiudeva con l'ora di adesso, cioè lo stesso segno di
 * un'email spedita: il conto della campagna (lib/carrelli-abbandonati.ts) lo contava fra i
 * promemoria inviati. Ora porta il segno «senza email» del giro dei carrelli: la sua ultima attività.
 */

const UTENTE = { id: 'u-1', email: 'anna@example.com' };
const ULTIMA = '2026-11-17T06:12:34.567891+00:00';
type Scrittura = { tabella: string; valori: Record<string, unknown>; filtri: Array<[string, string, unknown]> };
const stato = vi.hoisted(() => ({
  carrello: null as { last_activity: string } | null,
  scritture: [] as Scrittura[],
  righeToccate: 1,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (handler: (ctx: { user: typeof UTENTE }) => unknown) => () => handler({ user: UTENTE }),
  withAuthRateLimit: (_o: unknown, handler: (ctx: { user: typeof UTENTE }) => unknown) => () => handler({ user: UTENTE }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true, id: 'e' }) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: (lavoro: () => Promise<void>) => { void lavoro(); } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from(tabella: string) {
      const filtri: Array<[string, string, unknown]> = [];
      let valori: Record<string, unknown> | null = null;
      let colonne = '';
      const q: Record<string, unknown> = {};
      q.select = (c: string) => { colonne = c; return q; };
      q.eq = (c: string, v: unknown) => { filtri.push(['eq', c, v]); return q; };
      q.is = (c: string, v: unknown) => { filtri.push(['is', c, v]); return q; };
      q.in = (c: string, v: unknown) => { filtri.push(['in', c, v]); return q; };
      q.update = (v: Record<string, unknown>) => { valori = v; return q; };
      q.single = async () => ({ data: { deletion_requested_at: null }, error: null });
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (valori) {
          stato.scritture.push({ tabella, valori, filtri: [...filtri] });
          const data = tabella === 'abandoned_carts' && colonne === 'user_id' ? Array.from({ length: stato.righeToccate }, () => ({ user_id: UTENTE.id })) : null;
          return Promise.resolve({ data, error: null }).then(ok, ko);
        }
        if (tabella === 'abandoned_carts') return Promise.resolve({ data: stato.carrello ? [stato.carrello] : [], error: null }).then(ok, ko);
        return Promise.resolve({ data: [], error: null }).then(ok, ko);
      };
      return q;
    },
  }),
}));

import { POST } from '@/app/api/account/delete/route';

beforeEach(() => {
  stato.carrello = { last_activity: ULTIMA };
  stato.scritture = [];
  stato.righeToccate = 1;
});

const segni = () =>
  stato.scritture.filter((s) => s.tabella === 'abandoned_carts').map((s) => ({ segno: s.valori.recovery_email_sent_at, filtri: s.filtri }));

describe('R30-003 — la richiesta di cancellazione chiude il carrello senza dire «avvisato»', () => {
  it('il carrello mai avvisato prende come segno la sua ultima attività, solo se è ancora quello letto', async () => {
    await (POST as unknown as () => Promise<Response>)();
    const s = segni();
    expect(s).toHaveLength(1);
    expect(s[0].segno).toBe(ULTIMA);
    expect(s[0].filtri).toEqual(expect.arrayContaining([['eq', 'last_activity', ULTIMA], ['is', 'recovery_email_sent_at', null]]));
  });

  it('se il carrello è cambiato nel frattempo si chiude lo stesso, come prima: il promemoria non deve partire', async () => {
    stato.righeToccate = 0;
    await (POST as unknown as () => Promise<Response>)();
    const s = segni();
    expect(s).toHaveLength(2);
    expect(s[1].segno).not.toBe(ULTIMA);
    expect(typeof s[1].segno).toBe('string');
  });
});
