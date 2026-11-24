/**
 * R06-005 — Il README nominava la variabile di Google Analytics con il nome vecchio
 * (NEXT_PUBLIC_GA_ID): chi lo seguiva impostava una variabile che il codice non legge e GA4 restava spento.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const leggi = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('R06-005 · il README usa il nome della variabile che il codice legge', () => {
  it('il nome letto da components/GoogleAnalytics.tsx compare nel README, quello vecchio no', () => {
    const nome = leggi('components/GoogleAnalytics.tsx').match(/process\.env\.(NEXT_PUBLIC_GA\w*)/)?.[1];
    expect(nome).toBeTruthy();
    const readme = leggi('README.md');
    expect(readme).toContain(nome!);
    expect(readme).not.toMatch(/NEXT_PUBLIC_GA_ID\b/);
  });
});
