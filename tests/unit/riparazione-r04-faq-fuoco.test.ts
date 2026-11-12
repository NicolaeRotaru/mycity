import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-004 (prova leggera, stile) — In fondo alle FAQ il bottone «Contattaci»
 * sta su un riquadro terracotta: l'anello di fuoco terracotta non si vedeva.
 * Il Link del riquadro deve avere l'anello bianco.
 */
describe('FAQ: «Contattaci» ha un anello di fuoco visibile', () => {
  it('il bottone del riquadro terracotta porta focus-visible:outline-white', () => {
    const src = readFileSync('app/faq/page.tsx', 'utf8');
    const riquadro = src.slice(src.indexOf('Non hai trovato la risposta?'));
    const link = riquadro.match(/<Link href="\/contact"[^>]*>/);
    expect(link?.[0]).toBeDefined();
    expect(link?.[0]).toContain('focus-visible:outline-white');
  });
});
