import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R32-015 (la rotta) — SENZA LA CHIAVE DI SERVIZIO LA ROTTA DEL REGISTRO CADEVA, E NESSUNO LO SAPEVA.
 *
 * `getAdminSupabase()` lancia quando manca SUPABASE_SERVICE_ROLE_KEY. In /api/consent la chiamata
 * stava fuori da ogni controllo: la rotta cadeva con un errore non gestito invece di dire «non
 * disponibile», e il browser, che non guardava la risposta, non riprovava. Adesso il guasto si
 * scrive nei log col suo nome e la risposta è un 503: il browser tiene la scelta da rimandare
 * (l'altra metà della prova: riparazione-r32-consenso-che-si-rimanda).
 */

const errori: unknown[][] = [];

vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => { errori.push(a); }, warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
  getAdminSupabase: () => {
    throw new Error('Service role Supabase non configurato (SUPABASE_SERVICE_ROLE_KEY).');
  },
}));

import { POST } from '@/app/api/consent/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

let porta = 0;
function scegli(scelta: Record<string, unknown>, cookie = '') {
  porta++;
  return POST(new Request('https://mycity.test/api/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `93.40.40.${porta % 250}`, cookie },
    body: JSON.stringify(scelta),
  }));
}

beforeEach(() => {
  errori.length = 0;
  __resetRateLimitBuckets();
});

describe('R32-015 · il registro dei consensi senza la chiave di servizio', () => {
  it('IL CASO CHE ROMPEVA — risponde 503 e lo scrive nei log, invece di cadere', async () => {
    let res: Response | null = null;
    let caduta: unknown = null;
    try {
      res = await scegli({ functional: true, analytics: true, marketing: false, versione: '2' });
    } catch (e) {
      caduta = e;
    }
    expect(caduta, 'la rotta cade con un errore non gestito').toBeNull();
    expect(res!.status).toBe(503);
    expect(errori.length, 'il guasto del registro non lascia traccia nei log').toBeGreaterThan(0);
    expect(String((errori[0][1] as { message?: string })?.message)).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('anche così, il no alle statistiche toglie l\'identificativo di un anno', async () => {
    const res = await scegli({ functional: false, analytics: false, marketing: false, versione: '2' }, 'mc_vid=vecchio');
    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie().some((c) => /^mc_vid=;/.test(c) && /Max-Age=0/i.test(c))).toBe(true);
  });
});
