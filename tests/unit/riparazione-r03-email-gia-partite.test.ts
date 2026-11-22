/**
 * R03-008 — QUANDO LA NOTTE FINISCE IL TEMPO DELLE EMAIL, LE SPIEGAZIONI GIÀ ARRIVATE NON CONTANO.
 *
 * Passato il tetto delle email (240 s dall'inizio del giro) la notte non tenta più email: conta le
 * spiegazioni rimaste e lo dice agli amministratori («non sono partite per email»), e la notte è
 * rossa. Ma le rimaste sono TUTTE le spiegazioni dovute, anche quelle la cui email era già arrivata
 * in una notte prima: l'allarme diceva «2 spiegazioni non partite» quando non ne mancava nessuna.
 *
 * L'orologio è finto: ogni cancellazione «dura» `mondo.durata`. La prima notte è veloce e la posta
 * va (la libreria vera segna «partita» nel registro degli invii); la seconda è lenta e tocca il tetto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, durata: 1_000, email: 0 }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => {
    mondo.email++;
    return { ok: true };
  }),
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    vi.setSystemTime(Date.now() + mondo.durata);
    return { ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [] };
  }),
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const PRIMA = '00000000-0000-4000-8000-000000000001';
const SECONDA = '00000000-0000-4000-8000-000000000002';

/** `conIndirizzo`: chi ha una casella. Senza, la sua email non parte mai. */
function laNotte(conIndirizzo: string[]) {
  const giro = fintoGiroNotturno({
    tabelle: {
      profiles: [{ id: 'admin-1', role: 'admin' }],
      notifications: [],
      audit_logs: [],
      cron_heartbeats: [],
    },
    rpc: {
      process_expired_deletions: {
        data: [PRIMA, SECONDA].map((p) => ({ user_id: p, deleted_at: CHIESTA_IL })),
        error: null,
      },
    },
    indirizzi: Object.fromEntries(conIndirizzo.map((p) => [p, `${p.slice(-2)}@example.it`])),
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

const allarmiSenzaTempo = (giro: ReturnType<typeof laNotte>) =>
  giro.notifiche().filter((n) => /email/i.test(String(n.title)) && /tempo/.test(String(n.title)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.durata = 1_000;
  mondo.email = 0;
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R03-008 · finito il tempo delle email, si contano solo quelle davvero non partite', () => {
  it('le due email sono arrivate ieri: stanotte, a tempo finito, nessuna «non partita» e nessun allarme', async () => {
    const giro = laNotte([PRIMA, SECONDA]);
    await unaNotte(0);
    expect(mondo.email, 'la prima notte le email non sono partite: la prova non prova niente').toBe(2);

    mondo.durata = 140_000;
    const { status, corpo } = await unaNotte(1);
    expect(corpo.avvisiEmailSenzaTempo, 'conta come non partite le email già arrivate').toBe(0);
    expect(allarmiSenzaTempo(giro), 'allarme per email che le persone hanno già ricevuto').toHaveLength(0);
    expect(status).toBe(200);
  });

  it('una arrivata ieri e una mai partita: il conto e l allarme dicono una', async () => {
    const giro = laNotte([PRIMA]);
    await unaNotte(0);
    expect(mondo.email).toBe(1);

    mondo.durata = 140_000;
    const { status, corpo } = await unaNotte(1);
    expect(corpo.avvisiEmailSenzaTempo).toBe(1);
    const allarmi = allarmiSenzaTempo(giro);
    expect(allarmi).toHaveLength(1);
    expect(String(allarmi[0].body), 'il numero comprende la spiegazione già arrivata').toMatch(/Stanotte 1 spiegazione/);
    expect(status, 'una spiegazione davvero non partita resta un guasto della notte').toBe(500);
  });
});
