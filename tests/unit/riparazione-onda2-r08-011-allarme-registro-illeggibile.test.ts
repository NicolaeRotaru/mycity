/**
 * R08-011 (onda 2) — SE IL REGISTRO DEGLI INVII NON SI LEGGE, L'ALLARME NON DICE «NON PARTITA».
 *
 * Il giro notturno delle cancellazioni (app/api/cron/process-deletions) non tenta l'email di una
 * spiegazione se il registro degli invii (`audit_logs`) non si legge: senza registro la spedirebbe
 * ogni notte. lib/privacy/avvisi-a-chi-aspetta.ts lo segna già (`registroIlleggibile`, R25-005), ma
 * la rotta che scrive l'allarme agli amministratori non lo leggeva: l'allarme diceva «non è partita
 * per email, e non è un intoppo di una notte sola» anche alla PRIMA notte, e per un'email che una
 * notte prima poteva essere già arrivata. Qui gira la rotta vera, con il database finto in memoria
 * (aiuti/finto-giro-notturno.ts) e il registro rotto dalla prima notte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoGiroNotturno } from './aiuti/finto-giro-notturno';

type Esito = { ok: boolean; motivo?: string; errore?: string; fileRimossi: number; erroriFile: string[] };

const stato = vi.hoisted(() => ({ mondo: null as unknown as { admin: unknown } }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.mondo.admin, getCurrentUser: async () => null }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: async (): Promise<Esito> => ({
    ok: false,
    motivo: 'cassa_da_versare',
    errore: 'Cancellazione rinviata: risultano 120,00 € di contanti incassati alle consegne e non ancora versati.',
    fileRimossi: 0,
    erroriFile: [],
  }),
}));
const inviaEmail = vi.hoisted(() => vi.fn(async (_x: unknown) => ({ ok: true })));
vi.mock('@/lib/email/client', () => ({ sendEmail: (x: unknown) => inviaEmail(x) }));

import { POST as notte } from '@/app/api/cron/process-deletions/route';

const SEGRETO = 'segreto-della-notte-di-prova';
const giorniFa = (g: number) => new Date(Date.now() - g * 86_400_000).toISOString();

function laNotte(registroRotto: boolean) {
  const chiesta = giorniFa(8);
  const mondo = fintoGiroNotturno({
    indirizzi: { 'rider-1': 'rider@example.com' },
    rpc: { process_expired_deletions: { data: [{ user_id: 'rider-1', deleted_at: chiesta }], error: null } },
    tabelle: {
      notifications: [],
      profiles: [
        { id: 'rider-1', role: 'rider', deletion_requested_at: chiesta },
        { id: 'admin-1', role: 'admin' },
      ],
    },
    guasti: registroRotto
      ? (['select', 'insert'] as const).map((azione) => ({ tabella: 'audit_logs', azione, messaggio: 'permission denied for table audit_logs' }))
      : [],
  });
  stato.mondo = mondo;
  return mondo;
}

const unGiro = () =>
  notte(new Request('http://localhost/api/cron/process-deletions', {
    method: 'POST',
    headers: { authorization: `Bearer ${SEGRETO}` },
  }) as never);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-28T03:00:00Z'));
  process.env.CRON_SECRET = SEGRETO;
  inviaEmail.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R08-011 · registro degli invii illeggibile: l allarme dice che non si sa', () => {
  it('IL CASO CHE ROMPEVA — prima notte, registro rotto: l allarme non dice «non è partita, non è un intoppo di una notte sola»', async () => {
    const mondo = laNotte(true);
    await unGiro();

    expect(inviaEmail, 'senza registro l email non si tenta').not.toHaveBeenCalled();
    const allarmi = mondo.notifiche().filter((n) => String(n.title).includes('email'));
    expect(allarmi, 'nessun amministratore sa che la spiegazione è ferma').toHaveLength(1);
    const testo = String(allarmi[0].body);
    expect(testo, 'alla prima notte l allarme dice che non è un intoppo di una notte sola').not.toContain('non è un intoppo di una notte sola');
    expect(testo, 'dice «non è partita» per un email di cui non si sa niente').not.toContain('non è partita per email');
    expect(testo).toContain('Non si sa');
    expect(testo).toContain('registro degli invii');
    // Il resto dell'allarme resta: chi aspetta e cosa fare.
    expect(testo).toContain("Chi aspetta: l'utente rider-1.");
    expect(testo).toContain('scrivile tu');
  });

  it('controprova: col registro che si legge e la posta che parte, nessun allarme', async () => {
    const mondo = laNotte(false);
    await unGiro();
    expect(inviaEmail).toHaveBeenCalledTimes(1);
    expect(mondo.notifiche().filter((n) => String(n.title).includes('email'))).toEqual([]);
  });
});
