import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lavoriFermi, CRON_MAX_STALENESS_MIN } from '@/lib/cron-health';

/**
 * R28-004 — Il giro send-push legge solo le notifiche dell'ultima ora. Se si ferma, l'allarme deve
 * suonare PRIMA che le più vecchie escano dalla finestra, non due ore dopo.
 */
afterEach(() => vi.useRealTimers());

const FINESTRA_MIN = 60;

describe('R28-004 — l\'allarme del lavoro delle notifiche arriva dentro la finestra di lettura', () => {
  it('la finestra di lettura del giro è davvero di un\'ora', () => {
    const src = readFileSync(join(process.cwd(), 'app/api/cron/send-push/route.ts'), 'utf8');
    expect(src).toMatch(/Date\.now\(\) - 60 \* 60 \* 1000/);
  });

  it('con un orologio finto: fermo da 50 minuti è già allarme, fermo da 10 no', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
    const adesso = Date.now();
    const battiti = (minutiFa: number) => [{ name: 'send-push', last_run_at: new Date(adesso - minutiFa * 60_000).toISOString() }];
    const fermi = (m: number) => lavoriFermi(battiti(m), adesso).map((s) => s.name);
    expect(fermi(10)).not.toContain('send-push');
    expect(fermi(50)).toContain('send-push');
  });

  it('la soglia è più stretta della finestra e più larga della cadenza', () => {
    expect(CRON_MAX_STALENESS_MIN['send-push']).toBeLessThan(FINESTRA_MIN);
    expect(CRON_MAX_STALENESS_MIN['send-push']).toBeGreaterThan(5);
  });
});
