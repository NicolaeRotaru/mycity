/**
 * R24 — La rotta che registra le visite non va mai in errore del server:
 * corpo vuoto o rotto e cookie dei consensi storto danno 204 (ignorato / consenso assente).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const scritte: Record<string, unknown>[] = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ getCurrentUser: async () => null }));
vi.mock('@/lib/activity', () => ({
  recordActivity: async (riga: Record<string, unknown>) => { scritte.push(riga); },
  accessoGiaRegistrato: async () => false,
}));

import { POST } from '@/app/api/track/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { CONSENT_COOKIE, CONSENT_VERSION, parseConsentCookie } from '@/lib/consent';

let n = 0;
function chiama(body: string | undefined, cookie?: string) {
  n++;
  return POST(new Request('https://mycity.test/api/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      'x-forwarded-for': `93.41.20.${n % 250}`,
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    },
    body,
  })).catch(() => ({ status: 500 } as { status: number })); // un'eccezione = errore del server
}

beforeEach(() => {
  scritte.length = 0;
  __resetRateLimitBuckets();
});

describe('corpo vuoto o rotto', () => {
  it.each([
    ['vuoto', ''],
    ['senza corpo', undefined],
    ['JSON rotto', '{"event_type":'],
    ['null', 'null'],
    ['un numero', '5'],
  ])('%s: 204 e niente scritto', async (_nome, corpo) => {
    const res = await chiama(corpo as string | undefined, `${CONSENT_COOKIE}=${CONSENT_VERSION}%3A111`);
    expect(res.status).toBe(204);
    expect(scritte).toHaveLength(0);
  });
});

describe('cookie dei consensi storto', () => {
  it('parseConsentCookie: percentuale rotta = consenso assente, non eccezione', () => {
    const nessuno = { functional: false, analytics: false, marketing: false };
    const leggi = (v: string) => { try { return parseConsentCookie(v); } catch { return 'eccezione'; } };
    expect(leggi('%E0%A4%A')).toEqual(nessuno);
    expect(leggi('%E0')).toEqual(nessuno);
  });

  it('la rotta risponde 204 e, senza consenso, non registra la visita', async () => {
    // %25E0 si decodifica una volta nella rotta e una seconda in parseConsentCookie
    const res = await chiama(JSON.stringify({ event_type: 'page_view', path: '/' }), `${CONSENT_COOKIE}=%25E0`);
    expect(res.status).toBe(204);
    expect(scritte).toHaveLength(0);
  });
});
