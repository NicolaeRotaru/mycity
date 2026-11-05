/**
 * S09 — Il registro delle visite non crede più a quello che gli detta chiunque (scheda 259).
 *  ① paese e città da `cf-ipcountry`/`cf-ipcity` valgono solo col segreto di bordo;
 *  ② un «login» senza nessuno collegato non diventa una riga;
 *  ③ una città con un `%` malformato non fa cadere la rotta.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/analytics/posthog', () => ({ track: async () => {} }));

const scritte: Record<string, unknown>[] = [];
let utente: { id: string } | null = null;

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => utente,
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

const consenso = 'mc_consent=' + encodeURIComponent(JSON.stringify({ necessary: true, analytics: true, marketing: false, v: 1, ts: Date.now() }));

function chiama(corpo: Record<string, unknown>, intestazioni: Record<string, string> = {}) {
  return POST(
    new Request('https://mycity.test/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...intestazioni },
      body: JSON.stringify(corpo),
    }),
  );
}

beforeEach(() => {
  scritte.length = 0;
  utente = null;
  __riaccendiRegistrazione();
  __resetRateLimitBuckets();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('il registro delle visite', () => {
  it('un «login» senza nessuno collegato non scrive niente', async () => {
    const r = await chiama({ event_type: 'login', session_id: 's1' });
    expect(r.status).toBe(204);
    expect(scritte.filter((s) => s.event_type === 'login')).toHaveLength(0);
  });

  it('un login vero si scrive ancora', async () => {
    utente = { id: 'u-1' };
    await chiama({ event_type: 'login', session_id: 's1' });
    expect(scritte.filter((s) => s.event_type === 'login')).toHaveLength(1);
  });

  it('la disconnessione arriva senza sessione e resta accettata', async () => {
    await chiama({ event_type: 'logout', session_id: 's1' });
    expect(scritte.filter((s) => s.event_type === 'logout')).toHaveLength(1);
  });

  it('il paese dettato con cf-ipcountry senza segreto di bordo non si crede', async () => {
    utente = { id: 'u-2' };
    await chiama(
      { event_type: 'logout' },
      { 'cf-ipcountry': 'KP', 'cf-ipcity': 'Pyongyang', 'x-vercel-ip-country': 'IT', 'x-vercel-ip-city': 'Piacenza' },
    );
    expect(scritte[0]?.country).toBe('IT');
    expect(scritte[0]?.city).toBe('Piacenza');
  });

  it('col segreto di bordo giusto Cloudflare vale', async () => {
    vi.stubEnv('EDGE_TRUST_SECRET', 'segreto-di-prova-lungo');
    await chiama(
      { event_type: 'logout' },
      { 'x-edge-token': 'segreto-di-prova-lungo', 'cf-ipcountry': 'FR', 'x-vercel-ip-country': 'IT' },
    );
    expect(scritte[0]?.country).toBe('FR');
  });

  it('una città con un % malformato non fa cadere la rotta', async () => {
    const r = await chiama({ event_type: 'logout' }, { 'x-vercel-ip-city': 'Pia%E0cenza', cookie: consenso });
    expect(r.status).toBe(204);
    expect(scritte).toHaveLength(1);
    expect(scritte[0]?.city ?? null).toBeNull();
  });
});
