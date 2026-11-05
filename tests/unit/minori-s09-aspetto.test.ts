/**
 * S09 — Prove leggere (lettura del sorgente) sulle correzioni di aspetto e di
 * accessibilità di vetrina, scheda prodotto, home e pagine pubbliche.
 * Ogni blocco nomina la scheda che difende.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const leggi = (p: string) => readFileSync(p, 'utf8');

describe('1021 — stesso passo orizzontale lungo il percorso', () => {
  it('/categorie usa la larghezza del catalogo e il passo px-4 sm:px-6', () => {
    const src = leggi('app/categorie/page.tsx');
    expect(src).not.toMatch(/max-w-5xl/);
    expect(src).toMatch(/container mx-auto px-4 sm:px-6 py-8 (space-y-6 )?max-w-7xl/);
  });
  it('la vetrina del negozio usa lo stesso passo px-4 sm:px-6', async () => {
    const { CONTENITORE_PAGINA_NEGOZIO } = await import('@/components/store-sections/misure-vetrina');
    expect(CONTENITORE_PAGINA_NEGOZIO).toContain('px-4 sm:px-6');
  });
});

describe('236/270 — il catalogo nella vetrina del negozio', () => {
  const src = leggi('components/StoreProductExplorer.tsx');
  it('236 — il pulsante Filtri ha un nome anche quando il testo è nascosto sul telefono', () => {
    const bottone = src.slice(src.indexOf('onClick={() => setShowFilters'), src.indexOf('</button>', src.indexOf('onClick={() => setShowFilters')));
    expect(bottone).toContain(": 'Filtri'}");
    expect(bottone).toContain('aria-label=');
    expect(bottone).toMatch(/<Filter [^>]*aria-hidden/);
  });
  it('270 — alla griglia arriva il termine dopo la pausa, non quello di ogni lettera', () => {
    expect(src).toMatch(/setTimeout\(\(\) => setTermine\(search\.trim\(\)\), 250\)/);
    expect(src).toMatch(/search=\{termine \|\| undefined\}/);
  });
  it('270 — la griglia conta una ricerca solo coi risultati del suo termine', () => {
    const griglia = leggi('components/ProductGrid.tsx');
    expect(griglia).toMatch(/if \(!term \|\| caricando \|\| domanda\.isPlaceholderData\) return;/);
  });
});

describe('pagina di una categoria (app/category/[slug]/page.tsx)', () => {
  const src = leggi('app/category/[slug]/page.tsx');
  it('1936 — niente più filtro col camioncino «da 30 €» della vecchia soglia', () => {
    expect(src).not.toMatch(/freeShipping/);
    expect(src).not.toMatch(/\?\s*30\s*:/);
    expect(src).not.toMatch(/\bTruck\b/);
  });
  it('284 — «Altri prodotti» legge solo la madre, senza le figlie già mostrate nelle loro file', () => {
    const altri = src.slice(src.lastIndexOf('<ProductGrid', src.indexOf('title="Altri prodotti"')), src.indexOf('title="Altri prodotti"'));
    expect(altri).toContain('categoryIds={[category.id]}');
    expect(altri).not.toMatch(/categoryId=\{category\.id\}/);
  });
  it('330 — se tutte le file dell\'hub sono vuote compare un messaggio con le vie d\'uscita', () => {
    expect(src).toMatch(/onCount=\{\(n\) => segnaConto\(s\.id, n\)\}/);
    expect(src).toMatch(/\.every\(\(fila\) => contiDelleFile\[fila\] === 0\)/);
    expect(src).toContain('href="/categorie"');
    expect(src).toContain('href="/search"');
  });
});
