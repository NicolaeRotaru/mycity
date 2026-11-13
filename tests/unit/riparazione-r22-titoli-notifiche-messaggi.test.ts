import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R22-006 — Su notifiche e messaggi i titoli saltavano dal titolo principale (h1) al terzo livello (h3).
// Prova leggera: dopo un h1 non viene un h3 senza un h2 in mezzo.
const pagine = ['app/notifications/page.tsx', 'app/messages/page.tsx', 'app/messages/[id]/page.tsx'];

describe('R22-006 · i titoli non saltano un livello', () => {
  for (const file of pagine) {
    it(`${file}: dopo l'h1 non c'è un h3 senza h2`, () => {
      const src = readFileSync(file, 'utf8');
      const livelli = [...src.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      let precedente = 0;
      for (const l of livelli) {
        if (precedente > 0) expect(l).toBeLessThanOrEqual(precedente + 1);
        precedente = l;
      }
    });
  }

  it('le righe di notifiche e conversazioni usano h2', () => {
    expect(readFileSync('app/notifications/page.tsx', 'utf8')).toMatch(/<h2 className=\{`font-semibold text-lg leading-snug \$\{n\.is_read/);
    expect(readFileSync('app/messages/page.tsx', 'utf8')).toMatch(/<h2 className=\{`font-semibold text-lg leading-snug truncate/);
  });
});
