/**
 * R14-024 — la rotta che registra le visite non va in errore del server se riceve un corpo
 * vuoto o rotto, o un cookie dei consensi storto.
 *
 * Corpo vuoto / JSON rotto / non un oggetto -> 400 (prima: TypeError su null -> 500).
 * Cookie dei consensi con una sequenza % storta -> «nessun consenso» (prima: URIError -> 500).
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
function chiama(corpo: string | undefined, cookie?: string) {
  n++;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': `93.50.20.${n % 250}`,
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  };
  if (cookie) headers.cookie = cookie;
  // Un'eccezione che esce dalla rotta è un guasto del server: la si legge come 500.
  return POST(new Request('https://mycity.test/api/track', { method: 'POST', headers, body: corpo }))
    .catch(() => new Response(null, { status: 500 }));
}

beforeEach(() => {
  scritte.length = 0;
  __resetRateLimitBuckets();
});

describe('R14-024 corpo vuoto o rotto', () => {
  it.each([
    ['vuoto', ''],
    ['JSON rotto', '{"event_type":'],
    ['null', 'null'],
    ['un numero', '5'],
    ['una lista', '[1,2]'],
  ])('%s -> 400, non un guasto', async (_nome, corpo) => {
    const res = await chiama(corpo);
    expect(res.status).toBe(400);
    expect(scritte).toHaveLength(0);
  });

  it('un corpo buono continua a passare', async () => {
    const res = await chiama(
      JSON.stringify({ event_type: 'page_view', path: '/' }),
      `${CONSENT_COOKIE}=${CONSENT_VERSION}%3A111`,
    );
    expect(res.status).toBe(204);
    expect(scritte).toHaveLength(1);
  });
});

describe('R14-024 cookie dei consensi storto', () => {
  it('il lettore del cookie con % storto dice «nessun consenso»', () => {
    const leggi = (v: string) => {
      try { return parseConsentCookie(v); } catch (e) { return `ERRORE ${(e as Error).name}`; }
    };
    const niente = { functional: false, analytics: false, marketing: false };
    expect(leggi('%E0%A4%A')).toEqual(niente);
    expect(leggi('%')).toEqual(niente);
  });

  it('la rotta con cookie storto non va in errore e non registra la visita', async () => {
    const res = await chiama(
      JSON.stringify({ event_type: 'page_view', path: '/' }),
      // %25 = un «%» che la rotta decodifica una volta, e il lettore del cookie ritrova storto
      `${CONSENT_COOKIE}=%25E0%25A4%25A`,
    );
    expect(res.status).toBe(204);
    expect(scritte).toHaveLength(0);
  });
});
