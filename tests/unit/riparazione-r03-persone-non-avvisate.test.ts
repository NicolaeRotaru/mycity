/**
 * R03-003 — L'ALLARME «PERSONE NON AVVISATE» È UNO PER AVVISO, E DICE CHI.
 *
 * Quando la notte non riesce a scrivere nel pannello di chi aspetta la cancellazione il motivo
 * dell'attesa, gli amministratori ricevono un allarme. Prima era una riga nuova ogni notte, a ogni
 * amministratore, col solo numero delle persone: con lo stesso guasto per una settimana, sette
 * allarmi uguali, e nessuno sapeva a chi scrivere. Gli allarmi delle email ferme questa classe
 * l'avevano già chiusa: uno per avviso, con l'identificativo ricavato dall'avviso, e il nome di chi
 * aspetta. Qui si prova lo stesso per il pannello, facendo girare la rotta vera su un finto database.
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
const PRIMA = '00000000-0000-4000-8000-000000000001';
const SECONDA = '00000000-0000-4000-8000-000000000002';
const TITOLO = 'Persone non avvisate del rinvio della cancellazione';

/** Il pannello di queste persone rifiuta la riga: la spiegazione non si scrive. */
function laNotte(persone: string[], rifiutate: string[]) {
  const guasti: Guasto[] = [{
    tabella: 'notifications',
    azione: 'insert',
    messaggio: 'permission denied for table notifications',
    seRiga: (r) => rifiutate.includes(String(r.user_id)),
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
    guasti,
    chiaviUniche: true,
  });
  mondo.admin = giro.admin;
  return giro;
}

const unGiro = async () => {
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
};

const allarmiDi = (giro: ReturnType<typeof laNotte>, amministratore: string) =>
  giro.notifiche().filter((n) => n.title === TITOLO && n.user_id === amministratore);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-003 · l allarme «persone non avvisate» è uno per avviso e dice chi', () => {
  it('lo stesso guasto per tre notti: un allarme solo per amministratore, non uno a notte', async () => {
    const giro = laNotte([PRIMA], [PRIMA]);
    for (let n = 0; n < 3; n++) {
      vi.setSystemTime(ADESSO + n * GIORNO);
      const { corpo } = await unGiro();
      expect(corpo.avvisiFalliti, 'il guasto del pannello non c è: la prova non prova niente').toBe(1);
    }
    expect(allarmiDi(giro, 'admin-1'), 'l allarme si riscrive ogni notte').toHaveLength(1);
    expect(allarmiDi(giro, 'admin-2'), 'ogni amministratore ha il suo, una volta').toHaveLength(1);
  });

  it('l allarme dice chi aspetta e quale spiegazione non è arrivata', async () => {
    const giro = laNotte([PRIMA], [PRIMA]);
    await unGiro();
    const [allarme] = allarmiDi(giro, 'admin-1');
    expect(String(allarme?.body), 'l amministratore non sa a chi scrivere').toContain(PRIMA);
    expect(String(allarme?.body)).toMatch(/rinvio/);
  });

  it('due persone non avvisate: due allarmi, ognuno col suo nome', async () => {
    const giro = laNotte([PRIMA, SECONDA], [PRIMA, SECONDA]);
    await unGiro();
    const allarmi = allarmiDi(giro, 'admin-1');
    expect(allarmi, 'un allarme solo per due persone: chi è chi?').toHaveLength(2);
    expect(allarmi.some((n) => String(n.body).includes(PRIMA))).toBe(true);
    expect(allarmi.some((n) => String(n.body).includes(SECONDA))).toBe(true);
  });

  it('controprova: chi riceve la spiegazione non fa suonare l allarme', async () => {
    const giro = laNotte([PRIMA, SECONDA], [SECONDA]);
    const { status } = await unGiro();
    const allarmi = allarmiDi(giro, 'admin-1');
    expect(allarmi).toHaveLength(1);
    expect(String(allarmi[0].body)).toContain(SECONDA);
    expect(String(allarmi[0].body)).not.toContain(PRIMA);
    expect(status, 'una persona non avvisata resta un guasto della notte').toBe(500);
  });
});
