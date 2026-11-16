/**
 * R14 · il giro notturno delle cancellazioni account
 * (`app/api/cron/process-deletions`), con la pipeline vera di cancellazione
 * (`lib/account/cancellazione.ts`) sopra il finto database del giro
 * (tests/unit/aiuti/finto-giro-notturno.ts, usato com'è).
 *
 * R14-015 — Il lavoro entra da due porte (il calendario di Vercel e il cron
 * esterno): due giri partiti insieme prendono lo stesso account scaduto. Uno lo
 * cancella, l'altro riceve dal servizio di accesso «utente non trovato» e lo
 * contava come cancellazione fallita: l'account era sparito, ma la notte finiva
 * rossa e agli amministratori arrivava «Cancellazioni account non eseguite».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));

import { POST } from '@/app/api/cron/process-deletions/route';

const MARIA = '00000000-0000-4000-8000-0000000000a1';
const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

/** «Utente non trovato», come lo dice il servizio di accesso di Supabase. */
const UTENTE_NON_TROVATO = { message: 'User not found', status: 404, code: 'user_not_found' };

/**
 * Il finto database del giro, con il servizio di accesso vero nel modo che
 * conta qui: l'account si chiude una volta, e chiuso porta via il profilo
 * (ON DELETE CASCADE). Chi arriva dopo trova «utente non trovato».
 */
function laNotteDiMaria() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        { id: MARIA, role: 'buyer', deletion_requested_at: giorniFa(8) },
      ],
      notifications: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: {
      process_expired_deletions: { data: [{ user_id: MARIA, deleted_at: giorniFa(8) }], error: null },
    },
  });
  let chiuso = false;
  let chiusure = 0;
  mondo.admin = {
    ...giro.admin,
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: chiuso ? null : { email: 'maria@example.it' } }, error: null }),
        deleteUser: async (id: string) => {
          const giaChiuso = chiuso;
          chiuso = true;
          await new Promise((r) => setTimeout(r, 2));
          if (giaChiuso) return { error: UTENTE_NON_TROVATO };
          chiusure++;
          giro.db.profiles = (giro.db.profiles ?? []).filter((p) => p.id !== id);
          return { error: null };
        },
      },
    },
  };
  return { giro, chiusure: () => chiusure };
}

function unGiro() {
  return POST(
    new Request('http://localhost/api/cron/process-deletions', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
}

const segretoSalvato = process.env.CRON_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  process.env.CRON_SECRET = segretoSalvato;
});

describe('R14-015 — due giri della cancellazione partiti insieme', () => {
  it("l'account sparisce una volta e nessuno riceve un falso allarme di cancellazione fallita", async () => {
    const { giro, chiusure } = laNotteDiMaria();

    const [a, b] = await Promise.all([unGiro(), unGiro()]);
    const corpi = [await a.json(), await b.json()];

    expect(chiusure()).toBe(1);
    expect(giro.righe('profiles').some((p) => p.id === MARIA)).toBe(false);
    const sveglie = giro.notifiche().filter((n) => n.title === 'Cancellazioni account non eseguite');
    expect(sveglie, 'falso allarme: la cancellazione e riuscita').toHaveLength(0);
    expect(corpi.map((c) => c.failed), 'il secondo giro conta come fallita una cancellazione riuscita').toEqual([0, 0]);
    expect([a.status, b.status], 'la notte finisce rossa per niente').toEqual([200, 200]);
  });

  it('una cancellazione che fallisce davvero sveglia ancora qualcuno', async () => {
    const { giro } = laNotteDiMaria();
    mondo.admin = {
      ...(mondo.admin as object),
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { email: 'maria@example.it' } }, error: null }),
          deleteUser: async () => ({ error: { message: 'Database error deleting user', status: 500 } }),
        },
      },
    };

    const res = await unGiro();

    expect(res.status).toBe(500);
    expect((await res.json()).failed).toBe(1);
    expect(giro.notifiche().filter((n) => n.title === 'Cancellazioni account non eseguite')).toHaveLength(1);
  });
});
