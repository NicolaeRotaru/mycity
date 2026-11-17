import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R10-005 — Su notifiche e messaggi i titoli saltavano dal titolo principale (h1) al terzo livello (h3).
// Prova leggera sul sorgente: dopo un h1 non viene mai un titolo più di un livello sotto il precedente.
const pagine = ['app/notifications/page.tsx', 'app/messages/page.tsx'];

const livelliDi = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

describe('R10-005 · i titoli di notifiche e messaggi non saltano un livello', () => {
  for (const file of pagine) {
    it(`${file}: c'è l'h1 e nessun salto (h1 → h3)`, () => {
      const livelli = livelliDi(file);
      expect(livelli[0]).toBe(1);
      const salti = livelli.filter((l, i) => i > 0 && l > livelli[i - 1] + 1);
      expect(salti, `livelli dei titoli: ${livelli.join(' → ')}`).toEqual([]);
    });
  }
});
