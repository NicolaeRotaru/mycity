import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * R04-005 — Un lotto AI partito ma non agganciato restava «in invio» per
 * sempre, e la pagina non mostrava ne' rotella ne' pulsante. Adesso lo stato
 * chiude come fallito un invio scaduto, interroga un invio gia' agganciato, e
 * la pagina ha un testo e un'azione per ogni stato.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

let riga: Record<string, unknown> = {};
const aggiornamenti: Record<string, unknown>[] = [];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const catena: Record<string, unknown> = {};
      const fine = { single: () => Promise.resolve({ data: riga, error: null }) };
      catena.select = () => ({ eq: () => fine });
      catena.update = (v: Record<string, unknown>) => {
        aggiornamenti.push(v);
        const eq: { eq: () => typeof eq; then: (r: (x: unknown) => void) => void } = {
          eq: () => eq,
          then: (r) => r({ error: null }),
        };
        return eq;
      };
      return catena;
    },
  }),
}));
const pollMock = vi.fn(async () => ({ id: 'b1', processingStatus: 'in_progress', counts: {}, resultsUrl: null }));
vi.mock('@/lib/ai/batch', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/batch')>();
  return { ...actual, pollBatch: (...a: unknown[]) => pollMock(...(a as [])) };
});

import { GET } from '@/app/api/ai/catalog-batch/status/route';
import { INVIO_SENZA_RISPOSTA } from '@/lib/ai/batch';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { puoAvviareLavoro, lavoroInCorso, lavoroChiuso, testoStatoLavoro } from '@/lib/ai/statoLavoroCatalogo';

const chiedi = () => GET(new Request('http://localhost/api/ai/catalog-batch/status?jobId=job-1') as never);

describe('un lavoro «in invio» non resta cosi\' per sempre', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('in invio da un\'ora, senza lotto: chiuso come fallito con il motivo', async () => {
    riga = {
      id: 'job-1', seller_id: 'seller-1', operation: 'improve', status: 'submitting', batch_id: null,
      target_lang: null, total: 12, results: [], created_at: '2026-11-12T11:00:00Z', error: null,
    };
    const res = await chiedi();
    const corpo = (await res.json()) as { status: string; error: string };
    expect(corpo.status).toBe('failed');
    expect(corpo.error).toMatch(/invio non confermato/);
    expect(aggiornamenti).toContainEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('in invio da un minuto: si aspetta, non si chiude', async () => {
    riga = { ...riga, created_at: '2026-11-12T11:59:00Z' };
    const corpo = (await (await chiedi()).json()) as { status: string };
    expect(corpo.status).toBe('submitting');
    expect(aggiornamenti).toHaveLength(0);
  });

  it('invio SENZA RISPOSTA da un\'ora: resta aperto (potrebbe essere partito), non si chiude', async () => {
    riga = { ...riga, batch_id: null, created_at: '2026-11-12T11:00:00Z', error: INVIO_SENZA_RISPOSTA };
    const corpo = (await (await chiedi()).json()) as { status: string };
    expect(corpo.status).toBe('submitting');
    expect(aggiornamenti).toHaveLength(0);
  });

  it('invio senza risposta da 25 ore: chiuso, dicendo di controllare prima di ripartire', async () => {
    riga = { ...riga, batch_id: null, created_at: '2026-11-11T11:00:00Z', error: INVIO_SENZA_RISPOSTA };
    const corpo = (await (await chiedi()).json()) as { status: string; error: string };
    expect(corpo.status).toBe('failed');
    expect(corpo.error).toMatch(/assistenza/);
    riga = { ...riga, error: null };
  });

  it('in invio ma con il lotto agganciato: si interroga Anthropic come uno in corso', async () => {
    riga = { ...riga, batch_id: 'b1', created_at: '2026-11-12T11:00:00Z' };
    await chiedi();
    expect(pollMock).toHaveBeenCalledWith('b1');
  });
});

describe('un lavoro «in corso» che non finisce mai non chiude il negozio per sempre (R04-025, K02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aggiornamenti.length = 0;
    __resetRateLimitBuckets();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const inCorso = (creato: string) => ({
    id: 'job-1', seller_id: 'seller-1', operation: 'improve', status: 'processing', batch_id: 'b9',
    target_lang: null, total: 12, results: [], created_at: creato, error: null,
  });

  it('in corso da 30 ore e il fornitore non lo dà finito: chiuso come fallito, si puo\' ripartire', async () => {
    riga = inCorso('2026-11-11T06:00:00Z');
    const corpo = (await (await chiedi()).json()) as { status: string; error: string };
    expect(corpo.status).toBe('failed');
    expect(aggiornamenti).toContainEqual(expect.objectContaining({ status: 'failed' }));
    expect(puoAvviareLavoro(corpo)).toBe(true);
  });

  it('in corso da 30 ore e il fornitore non risponde: chiuso lo stesso', async () => {
    riga = inCorso('2026-11-11T06:00:00Z');
    pollMock.mockRejectedValueOnce(new Error('giu'));
    const corpo = (await (await chiedi()).json()) as { status: string };
    expect(corpo.status).toBe('failed');
  });

  it('in corso da 2 ore: resta in corso', async () => {
    riga = inCorso('2026-11-12T10:00:00Z');
    const corpo = (await (await chiedi()).json()) as { status: string };
    expect(corpo.status).toBe('processing');
    expect(aggiornamenti).toHaveLength(0);
  });
});

describe('la pagina ha un posto per ogni stato', () => {
  it('fallito: si dimentica, si spiega e si puo\' ripartire', () => {
    expect(lavoroChiuso('failed')).toBe(true);
    expect(puoAvviareLavoro({ status: 'failed' })).toBe(true);
    expect(testoStatoLavoro({ status: 'failed', total: 3, error: 'x' })).toMatch(/non è andato a buon fine/);
  });
  it('in invio: rotella e niente pulsante', () => {
    expect(lavoroInCorso('submitting')).toBe(true);
    expect(puoAvviareLavoro({ status: 'submitting' })).toBe(false);
    expect(testoStatoLavoro({ status: 'submitting', total: 3 })).toMatch(/non riavviarlo/);
  });
  it('pronto: niente pulsante finche\' non si applica o scarta', () => {
    expect(puoAvviareLavoro({ status: 'ready' })).toBe(false);
  });
});
