import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guardia di integrita' sui file migration (puro, niente DB).
 *
 * Storia: e' gia' successo di avere due file con lo stesso prefisso numerico
 * (doppio "052") -> ordine di applicazione ambiguo. E nomi fuori convenzione
 * sfuggono al tracking. Questo test, che gira sempre in CI, blocca quei casi.
 *
 * NB: questo NON verifica che le migration siano APPLICATE al DB (drift
 * file<->DB): quello e' coperto dai test d'integrazione (effetti delle
 * migration di sicurezza) e dallo script scripts/check-migration-drift.mjs.
 */
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');
// NNN, con suffisso-lettera opzionale per gli "slot" intermedi (es. 052b_).
const NAME_RE = /^(\d{3}[a-z]?)_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

function sqlFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

describe('integrita file migration', () => {
  it('la cartella migrations esiste e contiene file .sql', () => {
    expect(fs.existsSync(MIGRATIONS_DIR)).toBe(true);
    expect(sqlFiles().length).toBeGreaterThan(0);
  });

  it('ogni file rispetta la convenzione NNN_snake_case.sql', () => {
    const bad = sqlFiles().filter((f) => !NAME_RE.test(f));
    expect(bad, `file fuori convenzione: ${bad.join(', ')}`).toEqual([]);
  });

  it('nessun prefisso numerico duplicato (ordine di applicazione univoco)', () => {
    const byPrefix = new Map<string, string[]>();
    for (const f of sqlFiles()) {
      const m = f.match(NAME_RE);
      if (!m) continue;
      const arr = byPrefix.get(m[1]) ?? [];
      arr.push(f);
      byPrefix.set(m[1], arr);
    }
    const dups = [...byPrefix.entries()].filter(([, files]) => files.length > 1);
    expect(
      dups.map(([p, files]) => `${p}: ${files.join(' + ')}`),
      'prefissi duplicati',
    ).toEqual([]);
  });

  it('nessun file migration vuoto', () => {
    const empty = sqlFiles().filter(
      (f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8').trim().length === 0,
    );
    expect(empty, `file vuoti: ${empty.join(', ')}`).toEqual([]);
  });
});
