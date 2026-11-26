/**
 * R09-001 — La regola contro i tipi «qualunque» è accesa nella configurazione calcolata,
 * e la rotta delle email a orario non porta più un permesso di saltare il controllo che non salta niente.
 */
import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';

const livello = (v: unknown) => {
  const x = Array.isArray(v) ? v[0] : v;
  return x === 2 || x === 'error' ? 'error' : x === 1 || x === 'warn' ? 'warn' : 'off';
};

describe('R09-001 — no-explicit-any acceso, direttive morte fuori', () => {
  it('la regola è accesa (almeno warn) su un file qualunque, e in errore su lib/shipping.ts', async () => {
    const eslint = new ESLint();
    const conf = await eslint.calculateConfigForFile('lib/shipping.ts');
    expect(livello(conf.rules?.['@typescript-eslint/no-explicit-any'])).toBe('error');
    const conf2 = await eslint.calculateConfigForFile('app/api/cron/send-emails/route.ts');
    expect(['warn', 'error']).toContain(livello(conf2.rules?.['@typescript-eslint/no-explicit-any']));
  }, 30_000);

  it('app/api/cron/send-emails/route.ts non ha direttive eslint-disable che non spengono niente', async () => {
    const eslint = new ESLint({ reportUnusedDisableDirectives: 'warn' });
    const [r] = await eslint.lintFiles(['app/api/cron/send-emails/route.ts']);
    const morte = r.messages.filter((m) => /Unused eslint-disable/.test(m.message));
    expect(morte).toEqual([]);
  }, 60_000);
});
