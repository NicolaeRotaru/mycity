import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 24/11/2026 — Nicola: «questa zona di servizi non c'entra niente con mycity, sono servizi
 * offerti da SDG». Foto e video, social, sito web e scheda Google li vende SDG, la sua agenzia,
 * con un preventivo suo. Il marketplace non ha più il menu «Servizi», le sue pagine, la sua API
 * né il riquadro del preventivo in dashboard. Se tornano, questa prova diventa rossa.
 */
const radice = process.cwd();

describe('i servizi di SDG non stanno dentro MyCity', () => {
  it('le pagine, l API e la logica del preventivo dell agenzia non esistono più', () => {
    for (const percorso of [
      'app/seller/preventivo',
      'app/api/seller/preventivo',
      'lib/agenzia/preventivo.ts',
      'components/seller/PreventivoAgenziaCard.tsx',
    ]) {
      expect(existsSync(join(radice, percorso)), percorso).toBe(false);
    }
  });

  it('il menu del venditore non ha il gruppo «Servizi» e la dashboard non mostra il preventivo', () => {
    const menu = readFileSync(join(radice, 'components/seller/SellerShell.tsx'), 'utf8');
    expect(menu).not.toMatch(/group:\s*'Servizi'/);
    const dashboard = readFileSync(join(radice, 'app/seller/dashboard/page.tsx'), 'utf8');
    expect(dashboard).not.toMatch(/PreventivoAgenzia/);
  });
});
