import { describe, it, expect, vi, beforeEach } from 'vitest';

/** S03 — il semaforo col database lento (scheda 13) e il ripiego della 148 (scheda 2524). */
const stato = vi.hoisted(() => ({ battitiLetti: 0, dbErrore: true }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) =>
      t === 'cron_heartbeats'
        ? { select: () => { stato.battitiLetti++; return new Promise(() => {}); } }
        : { select: () => ({ limit: async () => ({ error: stato.dbErrore ? { message: 'timeout' } : null }) }) },
  }),
}));

import { GET } from '@/app/api/health/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { colonnaNonTrovata, scriviAncheSeMancaUnaColonnaNuova } from '@/lib/db/migrazione-148';

beforeEach(() => { stato.battitiLetti = 0; __resetRateLimitBuckets(); });

describe('semaforo', () => {
  it('13 — col database che non risponde non legge i battiti e risponde subito', async () => {
    const r = await Promise.race([
      GET(new Request('https://mycity.test/api/health', { headers: { 'x-forwarded-for': '10.9.9.9' } }) as never),
      new Promise<'appeso'>((ok) => setTimeout(() => ok('appeso'), 2000)),
    ]);
    expect(r).not.toBe('appeso');
    expect(stato.battitiLetti).toBe(0);
  });
});

describe('ripiego della 148', () => {
  it('2524 — un PGRST204 su una colonna scritta male non passa per schema indietro', async () => {
    const errato = { code: 'PGRST204', message: "Could not find the 'recoverd_at' column of 'abandoned_carts' in the schema cache" };
    expect(colonnaNonTrovata(errato, ['recovered_at'])).toBe(false);
    const giusto = { code: 'PGRST204', message: "Could not find the 'recovered_at' column of 'abandoned_carts' in the schema cache" };
    expect(colonnaNonTrovata(giusto, ['recovered_at'])).toBe(true);
    const scritture: Array<Record<string, unknown>> = [];
    const esito = await scriviAncheSeMancaUnaColonnaNuova('prova', { recoverd_at: 'x' }, ['recovered_at'], async (c) => {
      scritture.push(c);
      return { error: errato };
    });
    expect(esito.riuscita).toBe(false);
    expect(scritture).toHaveLength(1);
  });
});
