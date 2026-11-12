import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R09-022 — Il riquadro in fondo all'aiuto dei negozi prometteva un'«academy con video tutorial»
// che nessun piano prevede.
const pagina = readFileSync('app/seller/help/page.tsx', 'utf8');

describe('R09-022 · l’aiuto dei negozi non promette un’academy', () => {
  it('niente «academy» né «prossimamente»', () => {
    expect(pagina).not.toMatch(/academy|prossimamente/i);
    expect(pagina).toContain('scrivi all&apos;assistenza');
  });
});
