import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 31/10/2026 — «MANCA LA CHIAVE» USCIVA COME «IL DATABASE NON RISPONDE».
 *
 * Senza SUPABASE_SERVICE_ROLE_KEY `getAdminSupabase()` lancia prima di fare
 * qualsiasi domanda. La rotta /api/health/ready lo trattava come un database
 * giu', e al monitor esterno (che non ha il segreto dei cron) diceva solo
 * «battiti non letti: il database non risponde». Chi riceve l'allarme apre la
 * pagina di stato di Supabase, la trova verde, e perde un'ora col fornitore
 * mentre bastava copiare una variabile su Vercel.
 */

const stato: { manca: boolean; erroreDb: { message: string } | null } = { manca: false, erroreDb: null };

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => {
    if (stato.manca) throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
    return {
      from: () => ({ select: () => ({ limit: () => Promise.resolve({ error: stato.erroreDb }) }) }),
    };
  }),
}));

import { GET } from '@/app/api/health/ready/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let contatore = 0;
function dalMonitorEsterno(): never {
  contatore++;
  return new Request('https://mycity.test/api/health/ready', {
    headers: { 'x-forwarded-for': `10.7.0.${contatore % 250}` },
  }) as never;
}

const env = () => process.env as Record<string, string | undefined>;
const salvato = { ...process.env };

beforeEach(() => {
  __resetRateLimitBuckets();
  stato.manca = false;
  stato.erroreDb = null;
  env().NODE_ENV = 'production';
  process.env.CRON_SECRET = 'cron_test';
});
afterEach(() => { process.env = { ...salvato }; });

describe('la porta «sei pronto?» dice perche non ha guardato', () => {
  it('IL CASO CHE ROMPEVA — chiave di servizio mancante: non dice «il database non risponde»', async () => {
    stato.manca = true;
    const res = await GET(dalMonitorEsterno());
    const corpo = await res.json();
    expect(res.status, 'senza chiave il sito resta non pronto').toBe(503);
    expect(String(corpo.cron?.error), 'manda a cercare il guasto dal fornitore del database')
      .not.toContain('il database non risponde');
    expect(String(corpo.cron?.error)).toContain('chiave di servizio');
  });

  it('e il messaggio grezzo resta per chi ha il segreto', async () => {
    stato.manca = true;
    const corpo = await (await GET(dalMonitorEsterno())).json();
    expect(JSON.stringify(corpo)).not.toContain('Service role Supabase non configurato');
    expect(corpo.db).toBeUndefined();
  });

  it('controprova: un database che rifiuta la connessione resta «il database non risponde»', async () => {
    stato.erroreDb = { message: 'connection refused' };
    const res = await GET(dalMonitorEsterno());
    const corpo = await res.json();
    expect(res.status).toBe(503);
    expect(String(corpo.cron?.error)).toContain('il database non risponde');
  });
});
