import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R22-019 — nelle due pagine di R22 nessuna etichetta maiuscola usa una spaziatura diversa da
// tracking-label o tracking-wide (che nel config valgono entrambe 0.04em).
const pagine = ['app/messages/page.tsx', 'app/notifications/page.tsx'];

describe('R22-019 · una sola spaziatura per le etichette maiuscole', () => {
  for (const file of pagine) {
    it(`${file}: le etichette uppercase usano tracking-label o tracking-wide`, () => {
      const righe = readFileSync(file, 'utf8').split('\n').filter((r) => /\buppercase\b/.test(r) && /tracking-/.test(r));
      expect(righe.length, 'la pagina non ha più etichette maiuscole con spaziatura: la prova non misura niente').toBeGreaterThan(0);
      for (const r of righe) {
        const classi = [...r.matchAll(/tracking-(?:\[[^\]]+\]|[a-z]+)/g)].map((m) => m[0]);
        for (const c of classi) expect(['tracking-label', 'tracking-wide'], `${file}: ${r.trim()}`).toContain(c);
      }
    });
  }
});
