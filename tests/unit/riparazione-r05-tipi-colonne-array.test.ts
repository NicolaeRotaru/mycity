import { describe, expect, it } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * R05-016 — Il generatore dei tipi scriveva le colonne array (text[], uuid[]) come `string`
 * invece di `string[]`: il tipo si leggeva prima di «[]». Si fa girare lo script vero su una
 * migrazione campione, in una cartella a parte, senza database.
 */
const MIGRAZIONE = `
CREATE TABLE public.campione_array (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  etichette text[] NOT NULL DEFAULT '{}',
  prodotti uuid[],
  quantita integer[] NOT NULL DEFAULT '{}'
);
`;

function tipiGenerati(): string {
  const cartella = mkdtempSync(join(tmpdir(), 'tipi-r05-'));
  try {
    mkdirSync(join(cartella, 'scripts'));
    mkdirSync(join(cartella, 'lib'));
    mkdirSync(join(cartella, 'migrations'));
    copyFileSync(join(process.cwd(), 'scripts/gen-db-types.mjs'), join(cartella, 'scripts/gen-db-types.mjs'));
    writeFileSync(join(cartella, 'migrations/001_campione.sql'), MIGRAZIONE);
    execFileSync(process.execPath, [join(cartella, 'scripts/gen-db-types.mjs')], { stdio: 'pipe' });
    return readFileSync(join(cartella, 'lib/database.types.ts'), 'utf8');
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}
const tipi = tipiGenerati();
const riga = (colonna: string) => tipi.match(new RegExp(`\\n {10}${colonna}: ([^;]+);`))?.[1];

describe('R05-016 — le colonne array nei tipi generati', () => {
  it('text[] diventa string[]', () => expect(riga('etichette')).toBe('string[]'));
  it('uuid[] diventa string[], e può restare vuota', () => expect(riga('prodotti')).toBe('string[] | null'));
  it('integer[] diventa number[]', () => expect(riga('quantita')).toBe('number[]'));
  it('le colonne che non sono array restano come prima', () => {
    expect(riga('nome')).toBe('string');
    expect(riga('id')).toBe('string');
  });
});
