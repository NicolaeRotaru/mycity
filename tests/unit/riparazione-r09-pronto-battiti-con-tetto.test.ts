import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * La lettura dei battiti della rotta «sei pronto» ha un tetto di tempo: con un database che non
 * risponde alla seconda domanda la rotta risponde lo stesso, con l'esito dei battiti non letti.
 */
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (tabella: string) => {
      if (tabella === 'cron_heartbeats') {
        return { select: () => new Promise(() => {}) };
      }
      return { select: () => ({ limit: () => Promise.resolve({ error: null }) }) };
    },
  })),
}));

import { GET } from '@/app/api/health/ready/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

describe('«sei pronto»: tetto di tempo sui battiti', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    __resetRateLimitBuckets();
  });
  afterEach(() => vi.useRealTimers());

  it('risponde entro il tetto quando la lettura dei battiti non risponde', async () => {
    const p = GET(new Request('http://localhost/api/health/ready') as never);
    let finito = false;
    p.then(() => { finito = true; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(finito).toBe(false);
    await vi.advanceTimersByTimeAsync(7000);
    // Senza tetto la rotta resta appesa: qui lo si vede come risposta mancata, non come attesa infinita.
    expect(finito).toBe(true);
    const res = await p;
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.degraded).toBe(true);
    expect(body.cron.ok).toBe(false);
  });
});
