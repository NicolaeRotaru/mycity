import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ApiErrors } from '@/lib/api/responses';

/**
 * S10 (5/11/2026, scheda 548) — gli errori dei moduli non rimandano al browser
 * l'elenco interno dei controlli né il testo grezzo di altre librerie.
 */

const corpo = async (r: Response) => (await r.json()) as { error: { details?: unknown } };

describe('i dettagli di un 400 sono leggibili (548)', () => {
  it('un ZodError diventa il primo problema, { campo, messaggio }', async () => {
    const esito = z.object({ quantita: z.number().min(1, 'Almeno 1') }).safeParse({ quantita: 0 });
    const e = esito.success ? null : esito.error;
    const r = ApiErrors.invalidRequest('Dati non validi', e instanceof Error ? e.message : undefined);
    expect((await corpo(r)).error.details).toEqual({ campo: 'quantita', messaggio: 'Almeno 1' });
  });
  it('un testo grezzo (es. di Stripe) non esce', async () => {
    const r = ApiErrors.invalidRequest('Rimborso non riuscito', 'No such charge: ch_3Q...; request-id req_abc');
    expect((await corpo(r)).error.details).toBeUndefined();
  });
  it('un oggetto costruito dalla rotta passa com\'è', async () => {
    const r = ApiErrors.invalidRequest('x', { rifiutati: ['prezzo'] });
    expect((await corpo(r)).error.details).toEqual({ rifiutati: ['prezzo'] });
  });
});
