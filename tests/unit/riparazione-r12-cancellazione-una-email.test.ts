/**
 * R12-024 — Due richieste di cancellazione quasi insieme mandavano due email:
 * la seconda leggeva il campo ancora vuoto, la scrittura con `.is(null)` non
 * toccava niente, ma la rotta rispondeva «registrata» e spediva un secondo
 * avviso con date non vere. Il database finto applica il filtro come il vero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const UTENTE = { id: 'u-1', email: 'anna@example.com' };
const stato = { campo: null as string | null, email: [] as Array<Record<string, unknown>> };

vi.mock('@/lib/api/middleware', () => ({
  withAuth: (h: (c: { user: typeof UTENTE }) => unknown) => () => h({ user: UTENTE }),
  withAuthRateLimit: (_o: unknown, h: (c: { user: typeof UTENTE }) => unknown) => () => h({ user: UTENTE }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: async (l: Record<string, unknown>) => { stato.email.push(l); return { ok: true, id: 'e' }; },
}));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: (lavoro: () => Promise<void>) => { void lavoro(); } }));

/** Le due richieste hanno letto tutte e due il campo vuoto: la lettura risponde sempre «vuoto» la prima volta. */
let lettureVuote = 0;
function adminFinto() {
  return {
    from(tabella: string) {
      const filtri: Array<[string, string, unknown]> = [];
      let valori: Record<string, unknown> | null = null;
      let conSelect = false;
      const q: Record<string, unknown> = {};
      q.select = () => { conSelect = valori !== null; return q; };
      q.eq = (c: string, v: unknown) => { filtri.push(['eq', c, v]); return q; };
      q.is = (c: string, v: unknown) => { filtri.push(['is', c, v]); return q; };
      q.in = (c: string, v: unknown) => { filtri.push(['in', c, v]); return q; };
      q.update = (v: Record<string, unknown>) => { valori = v; return q; };
      q.single = async () => {
        if (tabella === 'profiles' && lettureVuote > 0) { lettureVuote -= 1; return { data: { deletion_requested_at: null }, error: null }; }
        return { data: { deletion_requested_at: stato.campo }, error: null };
      };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        if (valori && tabella === 'profiles') {
          const soloSeVuoto = filtri.some((f) => f[0] === 'is' && f[1] === 'deletion_requested_at');
          const scrive = !soloSeVuoto || stato.campo === null;
          if (scrive) stato.campo = String(valori.deletion_requested_at);
          return Promise.resolve({ data: conSelect ? (scrive ? [{ id: UTENTE.id }] : []) : null, error: null }).then(ok, ko);
        }
        return Promise.resolve({ data: [], error: null }).then(ok, ko);
      };
      return q;
    },
  };
}
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => adminFinto() }));

import { POST } from '@/app/api/account/delete/route';
const chiama = () => (POST as unknown as () => Promise<Response>)();

beforeEach(() => {
  stato.campo = null;
  stato.email = [];
  lettureVuote = 2; // tutte e due le richieste leggono «nessuna richiesta» prima di scrivere
});

describe('R12-024 due richieste di cancellazione insieme', () => {
  it('una sola email, e la seconda risposta dice la data vera della prima', async () => {
    const r1 = await chiama();
    const primaData = stato.campo;
    const r2 = await chiama();
    await new Promise((r) => setTimeout(r, 0));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(stato.email, 'due avvisi di cancellazione per una richiesta sola').toHaveLength(1);
    const corpo2 = await r2.json();
    expect(corpo2.alreadyRequested).toBe(true);
    expect(stato.campo, 'la seconda non sposta la data della prima').toBe(primaData);
  });
});
