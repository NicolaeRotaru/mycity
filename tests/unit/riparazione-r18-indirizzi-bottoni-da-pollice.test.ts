import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** R18-006 — «Modifica» ed «Elimina» nella rubrica indirizzi: bersaglio da 44 px, più distanziati. */
describe('R18-006 rubrica indirizzi: bottoni per il pollice', () => {
  const src = readFileSync('app/profile/addresses/page.tsx', 'utf8');
  const riga = src.indexOf('mt-auto flex');
  const blocco = src.slice(riga, riga + 1800);
  it('nessun bottone size=sm nella scheda', () => {
    expect(blocco).not.toMatch(/size="sm"/);
    expect((blocco.match(/size="md"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('lo spazio tra i bottoni è almeno gap-3 e vanno a capo se stretti', () => {
    expect(src.slice(riga, riga + 60)).toMatch(/flex-wrap gap-3/);
  });
  it('size md di Button è alto 44 px', () => {
    expect(readFileSync('components/ui/Button.tsx', 'utf8')).toMatch(/md: .*min-h-\[44px\]/);
  });
});
