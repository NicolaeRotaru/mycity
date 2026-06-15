import { describe, it, expect } from 'vitest';
import { staleCrons } from '@/lib/cron-health';

/**
 * Dead-man's switch dei cron (🟠-25): la logica che decide quali cron sono
 * "fermi" è pura e deterministica → testabile senza DB.
 */
describe('staleCrons', () => {
  const now = Date.parse('2026-06-15T12:00:00Z');
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  it('segnala un cron fermo oltre la soglia', () => {
    expect(staleCrons([{ name: 'send-emails', last_run_at: minsAgo(200) }], now)).toEqual([
      { name: 'send-emails', staleMin: 200, thresholdMin: 120 },
    ]);
  });

  it('non segnala un cron entro soglia', () => {
    expect(staleCrons([{ name: 'send-emails', last_run_at: minsAgo(30) }], now)).toEqual([]);
  });

  it('ignora i cron senza alcun heartbeat (mai registrati)', () => {
    expect(staleCrons([], now)).toEqual([]);
    expect(staleCrons([{ name: 'send-emails', last_run_at: null }], now)).toEqual([]);
  });

  it('ignora i cron non monitorati (es. operational-alerts, self-watch)', () => {
    expect(staleCrons([{ name: 'operational-alerts', last_run_at: minsAgo(9999) }], now)).toEqual([]);
  });

  it('process-deletions tollera fino a 26h (gira 1×/giorno)', () => {
    expect(staleCrons([{ name: 'process-deletions', last_run_at: minsAgo(60 * 25) }], now)).toEqual([]);
    const stale = staleCrons([{ name: 'process-deletions', last_run_at: minsAgo(60 * 27) }], now);
    expect(stale[0]?.name).toBe('process-deletions');
  });
});
