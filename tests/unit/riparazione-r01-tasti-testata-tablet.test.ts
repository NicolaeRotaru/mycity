import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R01-005 (17/11/2026) — fra 768 e 1023 px i tasti Ordini, Consegne e Admin della
 * testata mostrano solo l'icona: il nome è `sr-only lg:not-sr-only` e mancava il
 * title, quindi chi vede non aveva nessun nome (solo «Registrati» lo aveva).
 * Prova leggera sul testo della testata: ogni tasto ha il title col suo nome.
 */
const src = readFileSync('components/Navbar.tsx', 'utf8');

function aperturaDelLink(href: string): string {
  const i = src.indexOf(`<Link href="${href}"`);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf('>', i) + 1);
}

describe('R01-005 · i tasti di mestiere della testata hanno un nome anche per chi vede', () => {
  it.each([
    ['/seller/orders', 'Ordini'],
    ['/rider', 'Consegne'],
    ['/admin', 'Admin'],
  ])('%s ha title="%s" e il nome resta sr-only fino a lg', (href, nome) => {
    expect(aperturaDelLink(href)).toContain(`title="${nome}"`);
    const i = src.indexOf(`<Link href="${href}"`);
    const corpo = src.slice(i, src.indexOf('</Link>', i));
    expect(corpo).toContain(`<span className="sr-only lg:not-sr-only">${nome}</span>`);
  });
});
