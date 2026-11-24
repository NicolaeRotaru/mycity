/**
 * R02-002 — LO STESSO GUASTO DELLE PULIZIE CHE TORNA DOPO ESSERE STATO LETTO RIMANDA L'ALLARME.
 *
 * «Dati vecchi non cancellati» ha un identificativo ricavato da quali pulizie non riescono: con lo
 * stesso guasto la notte dopo non si scrive una riga nuova (un allarme per stato). Ma la riga non
 * se ne andava mai: una pulizia rifiutata, l'amministratore legge, il guasto si sistema; settimane
 * dopo la stessa pulizia è rifiutata di nuovo, la rotta trova la riga di allora (letta) e non
 * avvisa nessuno. Adesso la notte in cui tutte le pulizie riescono l'allarme si toglie, e se il
 * guasto torna se ne scrive uno nuovo, da leggere.
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

const ADESSO = new Date('2026-11-24T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const DATI_VECCHI = 'Dati vecchi non cancellati';
const RIFIUTO = 'permission denied for table activity_events';

function laNotte(errori: Record<string, string>) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'admin-2', role: 'admin' }],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc: { process_expired_deletions: { data: [], error: null } },
    errori,
    chiaviUniche: true,
  });
  mondo.admin = giro.admin;
  return giro;
}

const unaNotte = async (n: number) => {
  vi.setSystemTime(ADESSO + n * GIORNO);
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
};

const allarmi = (giro: ReturnType<typeof laNotte>, amministratore: string) =>
  giro.righe('notifications').filter((n) => n.title === DATI_VECCHI && n.user_id === amministratore);
const daLeggere = (giro: ReturnType<typeof laNotte>, amministratore: string) =>
  allarmi(giro, amministratore).filter((n) => n.is_read !== true);
/** Gli amministratori aprono il pannello: tutto letto. */
const leggonoTutto = (giro: ReturnType<typeof laNotte>) => {
  for (const n of giro.righe('notifications')) n.is_read = true;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R02-002 · lo stesso guasto delle pulizie che torna rimanda l allarme', () => {
  it('rifiutata, letta, sistemata, rifiutata di nuovo: ogni amministratore ha un allarme nuovo da leggere', async () => {
    const errori: Record<string, string> = { activity_events: RIFIUTO };
    const giro = laNotte(errori);

    const prima = await unaNotte(0);
    expect(prima.corpo.retentionFallite, 'la pulizia rifiutata non c è: la prova non prova niente').toBeGreaterThan(0);
    for (const a of ['admin-1', 'admin-2']) expect(daLeggere(giro, a)).toHaveLength(1);
    leggonoTutto(giro);

    delete errori.activity_events;
    const sistemata = await unaNotte(1);
    expect(sistemata.corpo.retentionFallite, 'la notte dopo le pulizie dovevano riuscire').toBe(0);

    errori.activity_events = RIFIUTO;
    const ritorno = await unaNotte(30);
    expect(ritorno.status, 'il guasto resta un guasto').toBe(500);
    for (const a of ['admin-1', 'admin-2']) {
      expect(daLeggere(giro, a), `${a} non sa che il guasto è tornato`).toHaveLength(1);
      expect(allarmi(giro, a), 'un allarme solo per lo stesso guasto').toHaveLength(1);
    }
  });

  it('controprova: lo stesso guasto che non si è mai sistemato non riscrive l allarme, anche dopo che è stato letto', async () => {
    const giro = laNotte({ activity_events: RIFIUTO });
    await unaNotte(0);
    leggonoTutto(giro);
    await unaNotte(1);
    await unaNotte(2);
    for (const a of ['admin-1', 'admin-2']) {
      expect(allarmi(giro, a), 'lo stesso guasto si riscrive ogni notte').toHaveLength(1);
      expect(daLeggere(giro, a)).toHaveLength(0);
    }
  });

  it('una notte con le pulizie riuscite non tocca gli altri avvisi degli amministratori', async () => {
    const giro = laNotte({});
    giro.db.notifications.push({ id: 'altro-1', user_id: 'admin-1', category: 'system', title: 'Cancellazioni account non eseguite', body: 'x', is_read: true });
    await unaNotte(0);
    expect(giro.righe('notifications').map((n) => n.id)).toEqual(['altro-1']);
  });
});
