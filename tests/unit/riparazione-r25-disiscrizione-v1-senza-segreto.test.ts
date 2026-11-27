import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'node:crypto';

/**
 * R25-002 (26/11/2026) — Un link di disiscrizione vecchio (v1, `base64url(email:ambito).firma`)
 * aperto in produzione senza UNSUBSCRIBE_SECRET: il segreto si calcolava fuori da un try, la
 * verifica lanciava e la rotta rispondeva 500. Adesso, come per i link cifrati, vale «link non
 * valido». Vale anche per qualunque gettone con un punto che non comincia per v2./v3.
 */
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => { throw new Error('il database non serve qui'); } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '203.0.113.9',
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { verificaDisiscrizione } from '@/lib/email/unsubscribe';
import { GET } from '@/app/api/unsubscribe/route';

const SEGRETO = 'un-segreto-di-prova';
const EMAIL = 'lucia.bianchi@example.it';

/** Un gettone v1 come lo firmava il codice di prima del 12/11/2026. */
const gettoneV1 = (dato: string) =>
  `${Buffer.from(dato, 'utf8').toString('base64url')}.${crypto.createHmac('sha256', SEGRETO).update(dato).digest('base64url')}`;

const senzaSegretoInProduzione = () => {
  vi.stubEnv('UNSUBSCRIBE_SECRET', '');
  vi.stubEnv('NODE_ENV', 'production');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('R25-002 — il link v1 senza segreto non è valido, non è un errore', () => {
  it('col segreto il link v1 si apre ancora', () => {
    vi.stubEnv('UNSUBSCRIBE_SECRET', SEGRETO);
    expect(verificaDisiscrizione(gettoneV1(`${EMAIL}:newsletter`))).toEqual({ email: EMAIL, ambito: 'newsletter' });
  });

  it.each([
    ['un link v1 vero', gettoneV1(`${EMAIL}:marketing`)],
    ['un gettone qualunque con un punto', 'abc.def'],
  ])('in produzione senza segreto %s dà null senza lanciare', (_nome, gettone) => {
    senzaSegretoInProduzione();
    expect(() => verificaDisiscrizione(gettone)).not.toThrow();
    expect(verificaDisiscrizione(gettone)).toBeNull();
  });

  it('la rotta porta a «link non valido» invece di rispondere 500', async () => {
    senzaSegretoInProduzione();
    const token = encodeURIComponent(gettoneV1(`${EMAIL}:newsletter`));
    const res = await GET(new Request(`https://mycity.test/api/unsubscribe?token=${token}`));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://mycity.test/disiscrizione?disiscrizione=link-non-valido');
  });
});
