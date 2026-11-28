/**
 * 28/11/2026 (R08-008, onda 2) — «L'EMAIL È PARTITA?» LO DICE LA LIBRERIA DEGLI AVVISI, NON UNA COPIA.
 *
 * Passato il tetto delle email, il giro notturno conta le spiegazioni la cui email non risulta partita
 * (R03-008). Per saperlo rileggeva da sé il registro degli invii cercando il segno «partita», copiato a
 * mano da una costante PRIVATA di lib/privacy/avvisi-a-chi-aspetta.ts. Il giorno in cui la libreria
 * cambia il segno o il registro, la copia smette di vederlo senza dirlo, e l'allarme dice «non partite»
 * email già arrivate. La libreria esporta già la domanda (`emailRisultaPartita`, R14-002): il giro deve
 * chiedere a lei.
 *
 * Qui la libreria è quella vera, tranne la risposta a quella domanda, che la prova decide: il registro
 * finto degli invii è vuoto, come se il segno fosse cambiato. Chi rilegge il registro da sé conta tutte
 * le email «non partite»; chi chiede alla libreria conta quello che la libreria dice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

const mondo = vi.hoisted(() => ({ admin: null as unknown, durata: 140_000, partite: true }));
const emailRisultaPartita = vi.hoisted(() => vi.fn(async (_admin: unknown, _id: string) => mondo.partite));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => mondo.admin }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    vi.setSystemTime(Date.now() + mondo.durata);
    return { ok: false, motivo: 'cassa_da_versare', errore: 'contanti da versare', fileRimossi: 0, erroriFile: [] };
  }),
}));
vi.mock('@/lib/privacy/avvisi-a-chi-aspetta', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  emailRisultaPartita,
}));

import { POST } from '@/app/api/cron/process-deletions/route';

const ADESSO = new Date('2026-11-21T04:00:00+01:00').getTime();
const GIORNO = 86_400_000;
const CHIESTA_IL = new Date(ADESSO - 8 * GIORNO).toISOString();
const PRIMA = '00000000-0000-4000-8000-000000000001';
const SECONDA = '00000000-0000-4000-8000-000000000002';

function laNotte() {
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
    indirizzi: { [PRIMA]: '01@example.it', [SECONDA]: '02@example.it' },
    chiaviUniche: true,
  });
  mondo.admin = giro.admin;
  return giro;
}

const unaNotte = async () => {
  const r = await POST(
    new Request('http://localhost/api/cron/process-deletions?a_mano=1&cancella=1', {
      method: 'POST',
      headers: { authorization: 'Bearer segreto-dei-lavori' },
    }) as never,
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.durata = 140_000;
  emailRisultaPartita.mockClear();
  process.env.CRON_SECRET = 'segreto-dei-lavori';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R08-008 · a tempo finito, «partita o no» lo dice la libreria degli avvisi', () => {
  it('la libreria dice «partite»: nessuna spiegazione contata fra le non partite, anche col registro senza il vecchio segno', async () => {
    mondo.partite = true;
    laNotte();
    const { corpo } = await unaNotte();
    expect(emailRisultaPartita, 'il giro non chiede alla libreria: rilegge da sé il registro col segno copiato').toHaveBeenCalled();
    expect(corpo.avvisiEmailSenzaTempo, 'contate «non partite» email che la libreria dice partite').toBe(0);
  });

  it('la libreria dice «non partite»: si contano tutte e due', async () => {
    mondo.partite = false;
    laNotte();
    const { status, corpo } = await unaNotte();
    expect(emailRisultaPartita).toHaveBeenCalledTimes(2);
    expect(corpo.avvisiEmailSenzaTempo).toBe(2);
    expect(status).toBe(500);
  });
});
