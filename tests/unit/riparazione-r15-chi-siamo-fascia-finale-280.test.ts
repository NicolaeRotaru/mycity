/**
 * R15-006 — a 280 px col testo al 200% i due pulsanti della fascia scura finale di «Chi siamo»
 * uscivano dalla fascia. Prova leggera sulle classi che lo evitano.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const leggi = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('R15-006 · la fascia scura finale di «Chi siamo» tiene i pulsanti dentro', () => {
  const src = leggi('app', 'about', 'page.tsx');
  const fascia = src.slice(src.indexOf('CTA band scura'));
  const riga = (re: RegExp) => (fascia.match(re) ?? [''])[0];

  it('il padding si riduce sotto sm', () => {
    expect(riga(/className="bg-ink-900[^"]*"/)).toMatch(/max-sm:p-\d/);
  });

  it('i due pulsanti possono stringersi e andare a capo', () => {
    for (const href of ['/lavora-con-noi', '/sell']) {
      const i = fascia.indexOf(`href="${href}"`);
      const classi = fascia.slice(i, fascia.indexOf('>', fascia.indexOf('className=', i)));
      expect(classi, href).toContain('min-w-0');
      expect(classi, href).toMatch(/(^|[\s"])max-w-full/);
      expect(classi, href).toContain('[overflow-wrap:anywhere]');
    }
  });
});
