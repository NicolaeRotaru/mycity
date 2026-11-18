import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R01-003 (17/11/2026) — nel modulo «Nuova promozione» l'etichetta «Cosa scontare»
 * era un <label> senza htmlFor e senza campo dentro: il lettore di schermo non la
 * legava ai due pulsanti di scelta. Ora è la <legend> del <fieldset> che contiene
 * le scelte «Tutto il negozio» / «Una categoria specifica», come per lo Sconto.
 * Prova leggera sul testo della pagina.
 */
const src = readFileSync('app/seller/promotions/page.tsx', 'utf8');

describe('R01-003 · «Cosa scontare» dà il nome al gruppo di scelte', () => {
  it('non è più un <label> slegato', () => {
    expect(src).not.toMatch(/<label[^>]*>Cosa scontare<\/label>/);
  });

  it('è la legend di un fieldset che contiene i radio scope', () => {
    const m = src.match(/<fieldset>\s*<legend[^>]*>Cosa scontare<\/legend>([\s\S]*?)<\/fieldset>/);
    expect(m).not.toBeNull();
    const gruppo = m![1];
    expect(gruppo.match(/<input type="radio" name="scope"/g)?.length).toBe(2);
    expect(gruppo).toContain('Tutto il negozio');
    expect(gruppo).toContain('Una categoria specifica');
  });
});
