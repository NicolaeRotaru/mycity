import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * R01-011 — Il testo di un lavoro sul catalogo «in invio» non si contraddice.
 *
 * La riga nasce già col motivo «invio senza risposta» (app/api/ai/catalog-batch/start/route.ts,
 * insert «in invio»), e lo perde solo quando il lotto si aggancia. Quindi il motivo da solo non dice
 * se l'invio è rimasto senza risposta: un invio appena partito non deve leggere «non ha avuto
 * risposta… chiedi all'assistenza», e uno rimasto senza risposta non deve promettere «tra poco lo
 * vedi partire» per 24 ore. Qui la riga è quella che scrive la rotta di avvio, letta dalla rotta di
 * stato vera, con l'orologio finto.
 */

const NEGOZIO = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof NEGOZIO; req: Request }) => unknown) => (req: Request) =>
      h({ user: NEGOZIO, req }),
}));

let riga: Record<string, unknown> = {};
const scritture: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const catena: Record<string, unknown> = {};
      const fine = { single: () => Promise.resolve({ data: riga, error: null }) };
      catena.select = () => ({ eq: () => fine });
      catena.update = (v: Record<string, unknown>) => {
        scritture.push(v);
        const eq: { eq: () => typeof eq; then: (r: (x: unknown) => void) => void } = { eq: () => eq, then: (r) => r({ error: null }) };
        return eq;
      };
      return catena;
    },
  }),
}));

import { GET } from '@/app/api/ai/catalog-batch/status/route';
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { testoStatoLavoro } from '@/lib/ai/statoLavoroCatalogo';

const ADESSO = '2026-11-20T12:00:00.000Z';
const fa = (ms: number) => new Date(Date.parse(ADESSO) - ms).toISOString();

/** La riga come la scrive la rotta di avvio appena creato il lavoro (insert in start/route.ts). */
const appenaCreata = (createdAt: string) => ({
  id: 'job-1', seller_id: 'seller-1', operation: 'improve', status: 'submitting', batch_id: null,
  target_lang: null, total: 12, results: null, created_at: createdAt, error: INVIO_SENZA_RISPOSTA,
});

type Corpo = { status: string; total: number; error?: string | null; createdAt?: string | null };
async function comeLaVedeLaPagina(): Promise<Corpo> {
  const res = await GET(new Request('http://localhost/api/ai/catalog-batch/status?jobId=job-1') as never);
  return (await res.json()) as Corpo;
}

const CHIUSO_INCERTO =
  "invio senza risposta da 24 ore: il lotto potrebbe essere partito ed essere stato pagato; chiedi all'assistenza prima di avviarne un altro";

beforeEach(() => {
  scritture.length = 0;
  __resetRateLimitBuckets();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(ADESSO));
});
afterEach(() => vi.useRealTimers());

describe('R01-011 — con quello che la rotta di stato manda oggi alla pagina', () => {
  it('un invio appena partito (5 secondi) non dice che è rimasto senza risposta', async () => {
    riga = appenaCreata(fa(5_000));
    const corpo = await comeLaVedeLaPagina();
    expect(corpo.status, 'la riga appena nata deve restare «in invio»').toBe('submitting');
    expect(corpo.error, 'la riga nasce col motivo «invio senza risposta»').toBe(INVIO_SENZA_RISPOSTA);
    const t = testoStatoLavoro(corpo)!;
    expect(t, 'nei primi secondi la pagina dice che l invio non ha avuto risposta').not.toMatch(/^L'invio del lavoro .* non ha avuto risposta/);
    expect(t).toMatch(/^Sto inviando il lavoro su 12 prodotti/);
    expect(t).toMatch(/non riavviarlo/);
    expect(scritture).toHaveLength(0);
  });

  it('un invio senza risposta da 10 minuti non promette «tra poco lo vedi partire»', async () => {
    riga = appenaCreata(fa(10 * 60_000));
    const corpo = await comeLaVedeLaPagina();
    expect(corpo.status).toBe('submitting');
    const t = testoStatoLavoro(corpo)!;
    expect(t).not.toContain('tra poco lo vedi partire');
    expect(t).toMatch(/potrebbe essere già partito/);
    expect(t).toMatch(/assistenza/);
  });
});

describe('R01-011 — con l ora di nascita della riga (createdAt), il testo sa quale dei due casi è', () => {
  it('appena partito: «tra poco lo vedi partire», niente «non ha avuto risposta»', async () => {
    riga = appenaCreata(fa(5_000));
    const corpo = { ...(await comeLaVedeLaPagina()), createdAt: String(riga.created_at) };
    const t = testoStatoLavoro(corpo)!;
    expect(t).toContain('tra poco lo vedi partire');
    expect(t).not.toMatch(/non ha avuto risposta|assistenza/);
  });

  it('ancora dentro la vita della rotta di avvio (1 minuto e 50): è ancora un invio in corso', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INVIO_SENZA_RISPOSTA, createdAt: fa(110_000) })!;
    expect(t).toContain('tra poco lo vedi partire');
  });

  it('oltre la vita della rotta di avvio (3 minuti): non ha avuto risposta, chiedi all assistenza', () => {
    const t = testoStatoLavoro({ status: 'submitting', total: 12, error: INVIO_SENZA_RISPOSTA, createdAt: fa(3 * 60_000) })!;
    expect(t).not.toContain('tra poco lo vedi partire');
    expect(t).toMatch(/non ha avuto risposta: potrebbe essere già partito/);
    expect(t).toMatch(/assistenza/);
  });

  it('senza il motivo (lavoro appena avviato da questa pagina): dice ancora che sta per partire', () => {
    expect(testoStatoLavoro({ status: 'submitting', total: 12 })).toContain('tra poco lo vedi partire');
  });
});

describe('R01-011 — a riga chiusa', () => {
  it('col motivo dell assistenza, non dice «puoi avviarne un altro»', () => {
    const t = testoStatoLavoro({ status: 'failed', total: 12, error: CHIUSO_INCERTO })!;
    expect(t).toContain(CHIUSO_INCERTO);
    expect(t).not.toMatch(/puoi avviarne un altro/i);
  });
  it('un fallimento qualunque dice ancora «puoi avviarne un altro»', () => {
    expect(testoStatoLavoro({ status: 'error', total: 3, error: 'fornitore non raggiungibile' })).toMatch(/Puoi avviarne un altro/);
    expect(testoStatoLavoro({ status: 'canceled', total: 3 })).toMatch(/Puoi avviarne un altro/);
  });
});
