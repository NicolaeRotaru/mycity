/**
 * R03-006 — CON UNA NOTTE LUNGA NON PARTIVA NESSUNA EMAIL E NON C'ERA ALLARME.
 *
 * Il tempo del giro (300 secondi) si conta dall'inizio, e le email alle persone in attesa partono
 * dopo il ciclo delle cancellazioni: senza tetto su quel ciclo, una notte lunga se lo mangiava
 * tutto, le email non partivano e nessuno lo sapeva. Adesso il ciclo si ferma al suo tetto (la
 * metà del tempo), le email partono nel tempo che resta, e quando il tetto ha tagliato del lavoro
 * c'è un errore nel registro e un avviso nel pannello degli amministratori.
 *
 * L'orologio è finto: ogni cancellazione «dura» un minuto. La prima persona ha contanti da
 * versare: il suo rinvio le si deve spiegare anche per email.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, prese: 0, emailAlle: [] as number[] }));
const errori = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: errori, warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => {
    mondo.emailAlle.push(Date.now());
    return { ok: true };
  }),
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    vi.setSystemTime(Date.now() + 60_000);
    mondo.prese++;
    return mondo.prese === 1
      ? { ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [] }
      : { ok: true, fileRimossi: 0, erroriFile: [] };
  }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const giorniFa = (g: number) => new Date(ADESSO - g * 86_400_000).toISOString();
const utente = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const SCADUTE = [1, 2, 3, 4, 5, 6].map((n) => ({ user_id: utente(n), deleted_at: giorniFa(8) }));

function laNotte() {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [
        { id: 'admin-1', role: 'admin' },
        ...SCADUTE.map((r) => ({ id: r.user_id, role: 'rider', deletion_requested_at: r.deleted_at })),
      ],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
      cod_reconciliations: [],
    },
    rpc: { process_expired_deletions: { data: SCADUTE, error: null } },
    indirizzi: Object.fromEntries(SCADUTE.map((r) => [r.user_id, `${r.user_id.slice(-1)}@example.it`])),
  });
  mondo.admin = giro.admin;
  return giro;
}

const unGiro = () =>
  POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.prese = 0;
  mondo.emailAlle = [];
  errori.mockClear();
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

const allarmiDelTetto = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => /finito il tempo/.test(String(n.title)));

describe('R03-006 · notte lunga: le email partono e il tetto che taglia suona l’allarme', () => {
  it('il tetto taglia del lavoro → errore nel registro e avviso agli amministratori', async () => {
    const giro = laNotte();
    await unGiro();

    const messaggi = errori.mock.calls.map((c) => String(c[0]));
    expect(messaggi.some((m) => /tetto di tempo/.test(m)), 'il tetto ha tagliato del lavoro senza un errore nel registro').toBe(true);
    const avvisi = allarmiDelTetto(giro);
    expect(avvisi, 'gli amministratori non sanno che stanotte delle cancellazioni sono rimaste indietro').toHaveLength(1);
    expect(String(avvisi[0].body)).toMatch(/rimandat/);
  });

  it('la spiegazione dovuta parte per email entro il tempo del giro', async () => {
    laNotte();
    await unGiro();
    expect(mondo.emailAlle.length, 'nessuna email partita').toBeGreaterThan(0);
    for (const t of mondo.emailAlle) expect(t - ADESSO).toBeLessThan(300_000);
  });

  it('controprova: una notte corta non suona l’allarme del tetto', async () => {
    const giro = fintoGiroNotturno({
      tabelle: { profiles: [{ id: 'admin-1', role: 'admin' }], notifications: [], cron_heartbeats: [] },
      rpc: { process_expired_deletions: { data: SCADUTE.slice(0, 2), error: null } },
    });
    mondo.admin = giro.admin;
    await unGiro();
    expect(allarmiDelTetto(giro)).toHaveLength(0);
    expect(errori.mock.calls.map((c) => String(c[0])).some((m) => /tetto di tempo/.test(m))).toBe(false);
  });
});
