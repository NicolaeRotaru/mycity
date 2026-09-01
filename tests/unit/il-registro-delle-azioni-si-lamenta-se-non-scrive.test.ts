import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R023) — IL REGISTRO DELLE AZIONI POTEVA RESTARE VUOTO IN SILENZIO.
 *
 * `writeAudit` e' la traccia di chi ha approvato un venditore, chi ha
 * rimborsato un ordine, chi ha sospeso un account: e' la cosa che si va a
 * leggere quando qualcosa e' andato storto e bisogna sapere chi l'ha fatto.
 *
 * Scriveva con due `insert` e non guardava mai la risposta. Il client Supabase,
 * quando la scrittura viene rifiutata — permessi, colonna mancante, tabella
 * piena — non lancia niente: restituisce `{ data: null, error }`. Quindi il
 * `try/catch` intorno non scattava, il `console.error` del catch non veniva mai
 * raggiunto, e nessuno sapeva che il registro non stava registrando. Il giorno
 * in cui serviva, era vuoto.
 *
 * Adesso l'errore delle due scritture si legge e finisce nel logger — quindi
 * anche a Sentry, mentre `console.error` in produzione si perde.
 */

const insertMock = vi.fn<(arg: Record<string, unknown>) => Promise<{ data: null; error: null | { message: string; code?: string } }>>(
  () => Promise.resolve({ data: null, error: null }),
);

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({ from: vi.fn(() => ({ insert: insertMock })) })),
}));

// Il finto logger nasce con `vi.hoisted` perche' la fabbrica di `vi.mock` viene
// spostata in cima al file: una costante normale li' non esiste ancora.
const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

import { writeAudit } from '@/lib/audit';

describe('il registro delle azioni amministrative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ data: null, error: null });
  });

  it('quando il database rifiuta la riga, qualcuno lo viene a sapere', async () => {
    insertMock.mockResolvedValue({ data: null, error: { message: 'permission denied for table audit_logs', code: '42501' } });

    await writeAudit({ actorId: 'admin-1', action: 'user.suspend', targetTable: 'profiles', targetId: 'u-9' });

    expect(
      loggerError.mock.calls.length,
      'il registro non ha scritto niente e non se ne e lamentato: la traccia di chi ha sospeso un account e persa',
    ).toBeGreaterThan(0);
    const contesto = JSON.stringify(loggerError.mock.calls);
    expect(contesto, 'nel racconto del guasto manca quale azione non e stata registrata').toContain('user.suspend');
    expect(contesto, 'nel racconto del guasto manca il motivo dato dal database').toContain('42501');
  });

  it('quando la scrittura va a buon fine non si disturba nessuno', async () => {
    await writeAudit({ actorId: 'admin-1', action: 'user.approve' });
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(loggerError, 'una scrittura riuscita non deve sembrare un guasto').not.toHaveBeenCalled();
  });
});
