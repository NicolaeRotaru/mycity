import { describe, it, expect, vi } from 'vitest';
import { statSync } from 'node:fs';

/**
 * 5/11/2026 (S04, scheda 2582) — La prova di `senzaCommenti` importa scripts/gen-db-types.mjs, e
 * importarlo bastava a rigenerare lib/database.types.ts: dopo ogni `npm run verify` il file
 * risultava cambiato senza che nessuno avesse lanciato `db:types`. Lo script ora scrive solo quando
 * lo si lancia da riga di comando.
 */
describe('il generatore dei tipi', () => {
  it('importato non riscrive lib/database.types.ts', async () => {
    const prima = statSync('lib/database.types.ts').mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    vi.resetModules();
    const modulo = await import('@/scripts/gen-db-types.mjs');
    expect(typeof modulo.senzaCommenti).toBe('function');
    expect(statSync('lib/database.types.ts').mtimeMs).toBe(prima);
  });
});
