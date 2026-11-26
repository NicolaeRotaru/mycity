/**
 * R17-005 — /come-funziona col testo al 200%: il titolo grande e i titoli in riga flex non devono
 * uscire dalla pagina.
 * Prova leggera sulle classi del file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sorgente = readFileSync(join(process.cwd(), 'app', 'come-funziona', 'page.tsx'), 'utf8');

function tag(inizio: string): string {
  const i = sorgente.indexOf(inizio);
  expect(i, `non trovo ${inizio}`).toBeGreaterThan(-1);
  return sorgente.slice(i, sorgente.indexOf('>', i));
}

describe('R17-005 titoli di /come-funziona', () => {
  it('il titolo grande va a capo', () => {
    expect(tag('<h1 ')).toMatch(/\bbreak-words\b/);
  });
  it('i due h3 dei pulsanti finali possono restringersi e andare a capo', () => {
    const resto = sorgente.slice(sorgente.indexOf('CTA finale'));
    const h3 = resto.match(/<h3 [^>]*>/g) ?? [];
    expect(h3).toHaveLength(2);
    for (const t of h3) expect(t).toMatch(/\bbreak-words\b/);
    expect(h3[1]).toMatch(/\bmin-w-0\b/);
    expect(resto).toMatch(/<Store [^>]*shrink-0/);
    expect((resto.match(/<div className="min-w-0">/g) ?? []).length).toBe(2);
  });
});
