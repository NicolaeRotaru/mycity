/**
 * R14-023 — Due segnali dello stesso accesso arrivati insieme: il secondo e' «gia' registrato».
 *
 * La rotta legge il registro (nessun accesso recente: il primo segnale non ha
 * ancora scritto) e poi scrive. Con la migrazione 384 il database rifiuta la
 * seconda copia con il codice della riga doppia (23505). Qui si prova la parte
 * del codice: quel rifiuto e' un «gia' registrato», cioe' una riuscita — la
 * rotta risponde come al solito e nel registro degli errori non finisce niente.
 * Un rifiuto di altro tipo, invece, resta un errore da guardare.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const stato = vi.hoisted(() => ({
  esitiScrittura: [] as Array<{ error: { code: string; message: string } | null }>,
  scritte: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'e1423000-0000-0000-0000-000000000001' }),
  getAdminSupabase: () => ({
    from: () => ({
      // Tutti e due i segnali leggono prima che l'altro abbia scritto: niente di recente.
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
      insert: async (riga: Record<string, unknown>) => {
        stato.scritte.push(riga);
        return stato.esitiScrittura.shift() ?? { error: null };
      },
    }),
  }),
}));

import { POST } from '@/app/api/track/route';
import { logger } from '@/lib/logger';
import { __riaccendiRegistrazione } from '@/lib/activity';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const segnaleDiAccesso = (ip: string) =>
  POST(
    new Request('https://mycity.test/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, 'user-agent': 'Mozilla/5.0' },
      body: JSON.stringify({ event_type: 'login', session_id: 'scheda-1', metadata: { metodo: 'password' } }),
    }),
  );

const rifiutiAnnotati = () =>
  (logger.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('[activity]'));

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  __riaccendiRegistrazione();
  stato.esitiScrittura = [];
  stato.scritte = [];
});

describe('R14-023 — il doppione dello stesso accesso e\' «gia\' registrato», non un errore', () => {
  it('due segnali insieme: il database rifiuta il secondo (23505), la rotta risponde 204 a tutti e due e non annota errori', async () => {
    stato.esitiScrittura = [
      { error: null },
      { error: { code: '23505', message: "activity_events: accesso gia' registrato per questa persona e questa sessione" } },
    ];
    const [primo, secondo] = await Promise.all([segnaleDiAccesso('93.50.20.1'), segnaleDiAccesso('93.50.20.2')]);
    expect(primo.status).toBe(204);
    expect(secondo.status, 'il doppione e\' una riuscita: «gia\' registrato»').toBe(204);
    expect(stato.scritte, 'tutti e due i segnali arrivano fino alla scrittura: e\' il database a tenerne uno').toHaveLength(2);
    expect(rifiutiAnnotati(), 'il doppione finiva nel registro come «scrittura rifiutata dal database»').toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('controprova: un rifiuto di altro tipo resta un errore da guardare', async () => {
    stato.esitiScrittura = [{ error: { code: '23503', message: 'violates foreign key constraint' } }];
    const res = await segnaleDiAccesso('93.50.20.3');
    expect(res.status).toBe(204);
    expect(rifiutiAnnotati()).toHaveLength(1);
  });
});
