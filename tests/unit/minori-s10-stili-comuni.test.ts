import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026) — il foglio di stile comune e le pagine legali.
 * 666: il fuoco non finisce sotto la testata fissa (scroll-padding).
 * 854: l'anello del fuoco usa il token, non il colore a mano.
 * 232: i titoli dei paragrafi legali non finiscono sotto la testata.
 */
const css = readFileSync('app/globals.css', 'utf8');

describe('il fuoco non finisce sotto le barre fisse (666)', () => {
  it('da md in su scroll-padding-top alto quanto la testata; sul telefono il fondo per la barra', () => {
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*html \{ scroll-padding-top: calc\(var\(--header-height\) \+ 0\.5rem\); \}/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{\s*html \{ scroll-padding-bottom: calc\(var\(--tabbar-height\) \+ 1rem\); \}/);
  });
});

describe('l\'anello del fuoco usa il token (854)', () => {
  it(':focus-visible { outline: var(--focus-outline) }', () => {
    const blocco = css.match(/:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(blocco).toMatch(/outline: var\(--focus-outline\);/);
    expect(blocco).not.toMatch(/#C0492C/i);
  });
});

describe('i paragrafi legali si fermano sotto la testata (232)', () => {
  it('scroll-mt alto quanto la testata da md in su', () => {
    const src = readFileSync('components/ui/LegalLayout.tsx', 'utf8');
    expect(src).toMatch(/md:scroll-mt-\[calc\(var\(--header-height\)\+0\.5rem\)\]/);
  });
});
