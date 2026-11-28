import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R09-003 — Nessun commento e nessun titolo di prova dice che la bozza della cassa scade.
 *
 * La scadenza della bozza (`scadeIl`, `BOZZA_VALE_MS`) è stata tolta da lib/bozza-checkout.ts:
 * `bozzaDaSalvare` segna solo quando la fascia è stata scelta (`sceltaIl`). Ma il titolo di una
 * prova diceva ancora «il salvataggio passa da bozzaDaSalvare (con la scadenza)»: chi legge la
 * prova verde crede che una bozza vecchia si butti via da sola, e non è così.
 */

const radice = join(__dirname, '..', '..');

function file(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(join(radice, dir))) {
    if (nome === 'node_modules' || nome.startsWith('.')) continue;
    const rel = join(dir, nome);
    if (statSync(join(radice, rel)).isDirectory()) file(rel, out);
    else if (/\.(ts|tsx)$/.test(nome)) out.push(rel);
  }
  return out;
}

/** Una riga che lega la bozza della cassa a una scadenza, senza dire che non c'è. */
function promette(riga: string): boolean {
  if (!/bozza/i.test(riga) || !/scaden|scade\b|scadeIl|BOZZA_VALE_MS/i.test(riga)) return false;
  if (/sessione (?:è )?scad/i.test(riga)) return false; // la sessione dell'accesso, non la bozza
  return !/senza scadenza|non ha (?:una |nessuna )?scadenza|non scade|nessuna scadenza|non promette|tolt[aei]|not\.toMatch/i.test(riga);
}

describe('R09-003 — la bozza della cassa non scade, e nessuno lo promette', () => {
  it('nessuna riga di app, lib, components o delle prove lega la bozza a una scadenza', () => {
    const trovate: string[] = [];
    for (const f of ['app', 'lib', 'components', 'tests/unit'].flatMap((d) => file(d))) {
      if (f.endsWith('riparazione-onda2-r09-003-la-bozza-non-promette-scadenza.test.ts')) continue;
      readFileSync(join(radice, f), 'utf8').split('\n').forEach((riga, i) => {
        if (promette(riga)) trovate.push(`${f}:${i + 1}: ${riga.trim().slice(0, 140)}`);
      });
    }
    expect(trovate).toEqual([]);
  });

  it('il controllo vede il titolo di prima e lascia passare quelli veri', () => {
    expect(promette("it('il salvataggio passa da bozzaDaSalvare (con la scadenza) ed è lo stesso di «Ordina»'")).toBe(true);
    expect(promette('// la bozza porta anche la scadenza')).toBe(true);
    expect(promette("it('il salvataggio passa da bozzaDaSalvare (che segna quando è stata scelta, senza scadenza)'")).toBe(false);
    expect(promette('// Passa da `bozzaDaSalvare`, che segna quando e\' stata scelta: la bozza non ha una scadenza.')).toBe(false);
    expect(promette('Con la sessione scaduta da sola la bozza si tiene come prima.')).toBe(false);
    expect(promette('LA BOZZA DEL RECLAMO, SE LA SESSIONE SCADE MENTRE LO SCRIVI.')).toBe(false);
  });

  it('lib/bozza-checkout.ts non ha più il campo né le funzioni della scadenza', () => {
    expect(readFileSync(join(radice, 'lib/bozza-checkout.ts'), 'utf8')).not.toMatch(/scadeIl|BOZZA_VALE_MS|scadenzaDellaBozzaValida/);
  });
});
