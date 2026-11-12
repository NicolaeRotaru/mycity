import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// R09-003 — Sul telefono sei bersagli della testata stavano sotto i 44 px: la pausa della striscia
// (32 di altezza), il logo (20), il CAP (28) e le tre voci delle categorie (42). Il CAP l'aveva già
// sistemato il 5/11. Prova leggera sulle classi; la misura vera è nel referto (Chromium, 390 e 1280 px).
const navbar = readFileSync('components/Navbar.tsx', 'utf8');
const striscia = readFileSync('components/PromoTicker.tsx', 'utf8');
const categorie = readFileSync('components/CategoryBar.tsx', 'utf8');

describe('R09-003 · i bersagli della testata arrivano a 44 px', () => {
  it('il logo, sul computer e sul telefono, ha un’area di tocco invisibile alta almeno 44', () => {
    const loghi = navbar.match(/<Link href="\/" className="[^"]*"/g) ?? [];
    expect(loghi).toHaveLength(2);
    for (const l of loghi) expect(l).toContain("relative before:absolute before:inset-x-0 before:-inset-y-3 before:content-['']");
  });

  it('la pausa della striscia scende di 12 px sotto, e la striscia non la taglia', () => {
    expect(striscia).toContain("before:absolute before:inset-x-0 before:top-0 before:-bottom-3 before:content-['']");
    expect(striscia).toMatch(/<div className="relative flex items-center border-b border-ink-800/);
    expect(striscia).toContain('<div className="min-w-0 flex-1 overflow-hidden">');
  });

  it('le voci delle categorie sono alte almeno 44 px', () => {
    expect((categorie.match(/border-b-2 px-3 py-2\.5 min-h-11/g) ?? []).length).toBe(2);
  });
});
