/**
 * Il segreto di bordo con l'«a capo» in fondo, nel registro delle visite.
 *
 * Su Vercel un valore incollato porta spesso un «a capo» finale. Il segreto delle rotte interne
 * (`withInternalAuth`) e quello del bordo per l'indirizzo (`getClientIp`) si ripuliscono già con
 * `.trim()`; il registro delle visite (/api/track) leggeva lo stesso EDGE_TRUST_SECRET senza
 * ripulirlo. L'intestazione `x-edge-token` arriva già senza spazi in fondo, quindi i due non
 * combaciavano mai: il paese e la città di Cloudflare restavano ignorati anche col gettone giusto.
 *
 * La regola è la stessa delle altre due porte: un «a capo» in fondo non cambia il segreto, un
 * segreto di soli spazi vale come assente, e niente passa con un gettone diverso o vuoto.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/analytics/posthog', () => ({ track: async () => {} }));

const scritte: Record<string, unknown>[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => null,
  getAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
      insert: async (riga: Record<string, unknown>) => {
        scritte.push(riga);
        return { error: null };
      },
    }),
  }),
}));

import { POST } from '@/app/api/track/route';
import { __riaccendiRegistrazione } from '@/lib/activity';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const BORDO = 'segreto-di-bordo-lungo';

/** Una disconnessione (accettata anche senza sessione) con le righe di Cloudflare e di Vercel. */
async function paeseRegistrato(gettone: string | null): Promise<unknown> {
  scritte.length = 0;
  __resetRateLimitBuckets();
  await POST(
    new Request('https://mycity.test/api/track', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(gettone === null ? {} : { 'x-edge-token': gettone }),
        'cf-ipcountry': 'FR',
        'cf-ipcity': 'Lione',
        'x-vercel-ip-country': 'IT',
        'x-vercel-ip-city': 'Piacenza',
      },
      body: JSON.stringify({ event_type: 'logout' }),
    }),
  );
  expect(scritte, 'la disconnessione non ha scritto la sua riga').toHaveLength(1);
  return scritte[0]?.country;
}

beforeEach(() => {
  __riaccendiRegistrazione();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il registro delle visite, con EDGE_TRUST_SECRET che finisce con un «a capo»', () => {
  it('col gettone di bordo giusto valgono paese e città di Cloudflare', async () => {
    vi.stubEnv('EDGE_TRUST_SECRET', `${BORDO}\n`);
    expect(await paeseRegistrato(BORDO), 'il bordo fidato non combacia mai').toBe('FR');
    expect(scritte[0]?.city).toBe('Lione');
  });

  it('anche con «\\r\\n» in fondo (incollato da Windows) il gettone giusto vale', async () => {
    vi.stubEnv('EDGE_TRUST_SECRET', `${BORDO}\r\n`);
    expect(await paeseRegistrato(BORDO)).toBe('FR');
  });

  it('senza gettone, o con uno sbagliato, resta solo quello che scrive Vercel', async () => {
    vi.stubEnv('EDGE_TRUST_SECRET', `${BORDO}\n`);
    for (const gettone of [null, '', 'segreto-sbagliato', 'segreto-di-bordo-lung', `${BORDO} x`]) {
      expect(await paeseRegistrato(gettone), `crede a Cloudflare con ${JSON.stringify(gettone)}`).toBe('IT');
    }
  });

  it('senza segreto, o con un segreto fatto solo di spazi, nessun gettone fa credere a Cloudflare', async () => {
    for (const vuoto of [undefined, '', '\n', '   ', ' \r\n\t']) {
      vi.stubEnv('EDGE_TRUST_SECRET', vuoto);
      for (const gettone of [null, '', ' ', vuoto ?? 'x', BORDO]) {
        expect(
          await paeseRegistrato(gettone),
          `segreto ${JSON.stringify(vuoto)}, gettone ${JSON.stringify(gettone)}`,
        ).toBe('IT');
      }
    }
  });
});
