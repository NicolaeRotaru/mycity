import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R15-005 (il pezzo che si chiude qui) — la pagina «non trovata» non si presenta come la home.
 *
 * Senza intestazioni sue, app/not-found.tsx prendeva titolo, descrizione e anteprima del layout
 * radice: un indirizzo sbagliato si presentava a Google e su WhatsApp come «MyCity Piacenza —
 * Marketplace dei negozi della tua città». Prova leggera sul testo della pagina.
 */
const src = readFileSync('app/not-found.tsx', 'utf8');

describe('R15-005 — la 404 ha titolo e anteprima suoi', () => {
  it('il titolo dice che la pagina non c’è', () => {
    expect(src).toContain("const TITOLO_404 = 'Pagina non trovata · MyCity'");
    expect(src).toMatch(/\n\s+title: TITOLO_404,/);
  });

  it('chiede di non essere indicizzata', () => {
    expect(src).toContain('robots: { index: false }');
  });

  it('l’anteprima (WhatsApp, social) non è quella della home', () => {
    expect(src).toContain('openGraph: { title: TITOLO_404, description: FRASE_404 }');
    expect(src).toContain('twitter: { title: TITOLO_404, description: FRASE_404 }');
  });
});
