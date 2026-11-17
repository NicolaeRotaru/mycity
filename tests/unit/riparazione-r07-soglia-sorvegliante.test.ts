import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esitoBattiti, SOGLIE_VISTE_DA_FUORI, SOGLIA_SORVEGLIANTE_MIN } from '@/lib/cron-health';

/**
 * R07-006 — Il sorvegliante (operational-alerts) gira ogni 5 minuti da R29-002, ma la sua soglia di
 * morte era rimasta 120 minuti, tarata su otto giri saltati alla cadenza vecchia di 15 minuti: con la
 * cadenza nuova erano 24 giri, e da fuori un sorvegliante morto si vedeva solo dopo due ore.
 */
const ROOT = process.cwd();
const ADESSO = new Date('2026-11-17T21:00:00Z');

/** La cadenza in minuti del sorvegliante, letta da vercel.json («*\/N * * * *»). */
function cadenzaSorvegliante(): number {
  const conf = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
    crons: { path: string; schedule: string }[];
  };
  const riga = conf.crons.find((c) => c.path === '/api/cron/operational-alerts');
  const m = riga?.schedule.match(/^\*\/(\d+) \* \* \* \*$/);
  expect(m, 'operational-alerts deve avere una cadenza «*/N * * * *» in vercel.json').toBeTruthy();
  return Number(m![1]);
}

function battiti(sorveglianteMinutiFa: number) {
  const fresco = new Date(ADESSO.getTime() - 60_000).toISOString();
  return Object.keys(SOGLIE_VISTE_DA_FUORI).map((name) => ({
    name,
    last_run_at:
      name === 'operational-alerts'
        ? new Date(ADESSO.getTime() - sorveglianteMinutiFa * 60_000).toISOString()
        : fresco,
  }));
}

describe('R07-006 · la soglia del sorvegliante segue la sua cadenza di 5 minuti', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ADESSO);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('un sorvegliante fermo da un\'ora (dodici giri saltati) si vede dalle porte di salute', () => {
    const esito = esitoBattiti(battiti(60), Date.now(), SOGLIE_VISTE_DA_FUORI);
    expect(esito.stato).toBe('fermi');
    expect(esito.ok).toBe(false);
    expect(esito.error ?? '').toContain('operational-alerts');
  });

  it('un sorvegliante che ha saltato un paio di giri non fa scattare niente', () => {
    const esito = esitoBattiti(battiti(12), Date.now(), SOGLIE_VISTE_DA_FUORI);
    expect(esito.stato).toBe('ok');
  });

  it('la soglia vale al massimo otto giri della cadenza scritta in vercel.json', () => {
    const cadenza = cadenzaSorvegliante();
    expect(cadenza).toBe(5);
    expect(SOGLIA_SORVEGLIANTE_MIN).toBeLessThanOrEqual(8 * cadenza);
    expect(SOGLIE_VISTE_DA_FUORI['operational-alerts']).toBe(SOGLIA_SORVEGLIANTE_MIN);
  });

  it('il commento della soglia dice la cadenza vera', () => {
    const sorgente = readFileSync(join(ROOT, 'lib', 'cron-health.ts'), 'utf8');
    expect(sorgente).toContain(`\`operational-alerts\` gira ogni ${cadenzaSorvegliante()} minuti`);
    expect(sorgente).not.toContain('`operational-alerts` gira ogni 15 minuti');
  });
});
