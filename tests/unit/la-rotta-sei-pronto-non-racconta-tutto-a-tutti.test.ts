import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * LA ROTTA «SEI PRONTO?» NON RACCONTA TUTTO A TUTTI, E NON SI FA CAVALCARE.
 *
 * 27/8/2026 (R186) — /api/health/ready era rimasta indietro rispetto al suo
 * gemello /api/health, dove le due difese sono state messe e spiegate.
 *
 * ① Il corpo conteneva `db.error` con il messaggio grezzo di Postgres o
 *    dell'eccezione, servito a chiunque. Il messaggio d'errore del database
 *    raccontato a un estraneo è una mappa di dov'è scoperto il sito.
 * ② Nessun limite di frequenza, e ogni chiamata esegue una query VERA sul
 *    database di produzione. Chiunque poteva consumare connessioni a raffica da
 *    un indirizzo solo — proprio quando il database è già in difficoltà, che è
 *    il momento in cui questa rotta viene interrogata.
 *
 * Quello che NON deve cambiare è il codice HTTP: il monitor esterno guarda
 * quello. 200 pronto, 503 no.
 */

const limitMock = vi.fn<() => Promise<{ error: null | { message: string } }>>(
  () => Promise.resolve({ error: null }),
);
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: vi.fn(() => ({ select: vi.fn(() => ({ limit: limitMock })) })),
  })),
}));

import { GET } from '@/app/api/health/ready/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

/** Un indirizzo diverso per ogni caso, così il freno non trascina fra le prove. */
let contatore = 0;
function chiamata(headers: Record<string, string> = {}): never {
  contatore++;
  return new Request('https://mycity.test/api/health/ready', {
    headers: { 'x-forwarded-for': `10.1.0.${contatore % 250}`, ...headers },
  }) as never;
}

/** `NODE_ENV` e' dichiarato di sola lettura nei tipi: qui va scritto davvero. */
const env = () => process.env as Record<string, string | undefined>;
const salvato = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  limitMock.mockResolvedValue({ error: null });
  process.env.CRON_SECRET = 'cron_test';
});

afterEach(() => { process.env = { ...salvato }; });

describe('quello che la rotta racconta a uno sconosciuto', () => {
  it('IL CASO CHE ROMPEVA — in produzione il motivo del guasto non esce', async () => {
    env().NODE_ENV = 'production';
    limitMock.mockResolvedValueOnce({ error: { message: 'FATAL: password authentication failed for user "postgres"' } });

    const res = await GET(chiamata());
    const corpo = await res.json();

    expect(res.status, 'il monitor esterno deve continuare a vedere 503').toBe(503);
    expect(corpo.status).toBe('not_ready');
    expect(
      JSON.stringify(corpo),
      'il messaggio del database esce a chiunque: è una mappa di dov è scoperto il sito',
    ).not.toContain('password authentication failed');
  });

  it('con il segreto dei lavori periodici il motivo si legge, perché serve a ripararlo', async () => {
    env().NODE_ENV = 'production';
    limitMock.mockResolvedValueOnce({ error: { message: 'connection refused' } });

    const res = await GET(chiamata({ authorization: 'Bearer cron_test' }));
    const corpo = await res.json();

    expect(res.status).toBe(503);
    expect(corpo.db?.error).toBe('connection refused');
  });

  it('un segreto sbagliato non apre niente', async () => {
    env().NODE_ENV = 'production';
    limitMock.mockResolvedValueOnce({ error: { message: 'connection refused' } });

    const corpo = await (await GET(chiamata({ authorization: 'Bearer sbagliato__' }))).json();
    expect(corpo.db).toBeUndefined();
  });
});

describe('il freno sulle chiamate', () => {
  it('IL CASO CHE ROMPEVA — a raffica dallo stesso indirizzo il database smette di essere interrogato', async () => {
    const indirizzo = { 'x-forwarded-for': '203.0.113.7' };
    for (let i = 0; i < 601; i++) {
      await GET(new Request('https://mycity.test/api/health/ready', { headers: indirizzo }) as never);
    }
    const primeQuery = limitMock.mock.calls.length;

    const res = await GET(new Request('https://mycity.test/api/health/ready', { headers: indirizzo }) as never);
    const corpo = await res.json();

    expect(
      limitMock.mock.calls.length,
      'ogni chiamata continua a costare una query vera sul database di produzione',
    ).toBe(primeQuery);
    expect(corpo.throttled).toBe(true);
    expect(
      res.status,
      'sopra soglia un 429 farebbe concludere al monitor che il sito è caduto, su un sito vivo',
    ).toBe(200);
  });

  it('le sonde interne, che non mandano l indirizzo di rete, non passano dal freno', async () => {
    for (let i = 0; i < 700; i++) {
      await GET(new Request('https://mycity.test/api/health/ready') as never);
    }
    const res = await GET(new Request('https://mycity.test/api/health/ready') as never);
    expect((await res.json()).throttled).toBeUndefined();
    expect(res.status).toBe(200);
  });
});
