import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/** S03 — scheda 302: la Permissions-Policy lascia il microfono al sito stesso (dettatura del prodotto). */
describe('intestazioni di sicurezza', () => {
  it('microphone=(self), non microphone=()', async () => {
    const config = createRequire(import.meta.url)('../../next.config.js');
    const regole = await config.headers();
    const valori = regole.flatMap((r: { headers: Array<{ key: string; value: string }> }) => r.headers)
      .filter((h: { key: string }) => h.key === 'Permissions-Policy')
      .map((h: { value: string }) => h.value);
    expect(valori.length).toBeGreaterThan(0);
    for (const v of valori) {
      expect(v).toMatch(/microphone=\(self\)/);
      expect(v).not.toMatch(/microphone=\(\)/);
    }
  });
});
