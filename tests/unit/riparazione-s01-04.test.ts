/**
 * S01-04 — L'aggiornamento delle righe già scritte nella migrazione 997.
 *
 *   npx vitest run tests/unit/riparazione-s01-04.test.ts
 *
 * L'UPDATE in fondo alla 997 riscrive solo i nomi che cambiano per gli spazi
 * (profiles_nome_spazi), non quelli che hanno soltanto selettori di variante:
 * la condizione si prova in tests/sql/rls/riparazione-s01-04.test.sql (⑬), qui
 * che l'UPDATE usi proprio quella.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(join(process.cwd(), 'migrations/997_profili_nome_spazi_unicode.sql'), 'utf8');
const senzaCommenti = sql.replace(/--[^\n]*/g, '');

describe('S01-04 — righe già scritte', () => {
  it('l\'UPDATE delle righe già scritte usa la condizione degli spazi', () => {
    const update = senzaCommenti.match(/UPDATE\s+public\.profiles\s+SET\s+full_name\s*=\s*full_name\s+WHERE\s+([^;]+);/i);
    expect(update).not.toBeNull();
    expect(update![1].replace(/\s+/g, ' ').trim()).toBe('full_name IS DISTINCT FROM public.profiles_nome_spazi(full_name)');
  });

  it('c\'è un solo UPDATE su profiles', () => {
    expect(senzaCommenti.match(/UPDATE\s+public\.profiles\b/gi)).toHaveLength(1);
  });
});
