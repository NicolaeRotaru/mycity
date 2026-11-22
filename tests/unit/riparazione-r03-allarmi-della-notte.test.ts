/**
 * R03-004 — I DUE ALLARMI DEL GIRO DELLE CANCELLAZIONI NON SI RIPETONO OGNI NOTTE.
 *
 * «Dati vecchi non cancellati» (una pulizia della ritenzione rifiutata) e «Persone non avvisate»
 * (la spiegazione dell'attesa non scritta nel pannello) chiamavano l'avviso agli amministratori
 * senza chiave: una riga nuova ogni notte, a ogni amministratore, finché il guasto restava. Un
 * permesso negato non si aggiusta da solo, quindi erano sette allarmi uguali a settimana.
 * Adesso ogni allarme ha un identificativo ricavato dal suo stato: stesso guasto, nessuna riga
 * nuova; guasto diverso, un allarme nuovo. La notte resta rossa: lo dice il 500, non le copie.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno, type Guasto } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => ({
    ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [],
  })),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const PERSONA = '00000000-0000-4000-8000-000000000001';
const DATI_VECCHI = 'Dati vecchi non cancellati';
const NON_AVVISATE = 'Persone non avvisate del rinvio della cancellazione';

/** `errori` resta lo stesso oggetto per tutto il giro: una prova lo cambia fra una notte e l'altra. */
function laNotte(opzioni: { persone?: string[]; errori: Record<string, string> }) {
  const persone = opzioni.persone ?? [];
  const guasti: Guasto[] = [{
    tabella: 'notifications',
    azione: 'insert',
    messaggio: 'permission denied for table notifications',
    seRiga: (r) => persone.includes(String(r.user_id)),
  }];
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'admin-2', role: 'admin' }],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc: { process_expired_deletions: { data: persone.map((p) => ({ user_id: p, deleted_at: CHIESTA_IL })), error: null } },
    indirizzi: Object.fromEntries(persone.map((p) => [p, `${p.slice(-2)}@example.it`])),
    errori: opzioni.errori,
    guasti,
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

const allarmi = (giro: ReturnType<typeof laNotte>, titolo: string, amministratore: string) =>
  giro.notifiche().filter((n) => n.title === titolo && n.user_id === amministratore);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-004 · «Dati vecchi non cancellati» è uno per stato', () => {
  it('la stessa pulizia rifiutata per tre notti: un allarme per amministratore, e la notte resta rossa', async () => {
    const giro = laNotte({ errori: { activity_events: 'permission denied for table activity_events' } });
    for (let n = 0; n < 3; n++) {
      const { status, corpo } = await unaNotte(n);
      expect(corpo.retentionFallite, 'la pulizia rifiutata non c è: la prova non prova niente').toBeGreaterThan(0);
      expect(status, 'il guasto resta un guasto anche senza allarme nuovo').toBe(500);
    }
    expect(allarmi(giro, DATI_VECCHI, 'admin-1'), 'lo stesso allarme si riscrive ogni notte').toHaveLength(1);
    expect(allarmi(giro, DATI_VECCHI, 'admin-2')).toHaveLength(1);
  });

  it('un guasto diverso la notte dopo: un allarme nuovo', async () => {
    const errori: Record<string, string> = { activity_events: 'permission denied for table activity_events' };
    const giro = laNotte({ errori });
    await unaNotte(0);
    errori.contact_messages = 'permission denied for table contact_messages';
    await unaNotte(1);
    await unaNotte(2);
    expect(allarmi(giro, DATI_VECCHI, 'admin-1'), 'il guasto nuovo non lo sa nessuno').toHaveLength(2);
  });
});

describe('R03-004 · i due allarmi insieme non si moltiplicano', () => {
  it('pulizia rifiutata e persona non avvisata per tre notti: un allarme di ciascuno per amministratore', async () => {
    const giro = laNotte({ persone: [PERSONA], errori: { activity_events: 'permission denied for table activity_events' } });
    for (let n = 0; n < 3; n++) {
      const { corpo } = await unaNotte(n);
      expect(corpo.avvisiFalliti).toBe(1);
    }
    for (const a of ['admin-1', 'admin-2']) {
      expect(allarmi(giro, DATI_VECCHI, a)).toHaveLength(1);
      expect(allarmi(giro, NON_AVVISATE, a)).toHaveLength(1);
    }
  });
});
