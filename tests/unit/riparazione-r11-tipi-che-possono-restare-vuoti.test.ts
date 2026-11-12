import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * R11-009 — I tipi generati dal database sbagliavano su 7 colonne che possono
 * restare vuote (e una che non può). Il generatore decideva «mai vuota» solo
 * dalla CREATE TABLE: non leggeva gli ALTER COLUMN … DROP/SET NOT NULL dopo, e
 * perdeva il NOT NULL di «numeric(10, 2) DEFAULT 0 NOT NULL» per la virgola
 * dentro le parentesi. Controllato a mano contro il database ricostruito dalle
 * migrazioni (tests/sql/harness/apply.sh): le 780 colonne coincidono.
 */

/** Il generatore gira davvero, in una cartella a parte: si provano i tipi che PRODUCE, non il file salvato. */
function tipiGenerati(): string {
  const cartella = mkdtempSync(join(tmpdir(), 'tipi-r11-'));
  try {
    mkdirSync(join(cartella, 'scripts'));
    mkdirSync(join(cartella, 'lib'));
    copyFileSync(join(process.cwd(), 'scripts/gen-db-types.mjs'), join(cartella, 'scripts/gen-db-types.mjs'));
    symlinkSync(join(process.cwd(), 'migrations'), join(cartella, 'migrations'));
    execFileSync(process.execPath, [join(cartella, 'scripts/gen-db-types.mjs')], { stdio: 'pipe' });
    return readFileSync(join(cartella, 'lib/database.types.ts'), 'utf8');
  } finally {
    rmSync(cartella, { recursive: true, force: true });
  }
}
const tipi = tipiGenerati();
function riga(tabella: string, colonna: string): string {
  const inizio = tipi.indexOf(`\n      ${tabella}: {\n        Row: {`);
  expect(inizio, `la tabella ${tabella} non è nei tipi`).toBeGreaterThan(-1);
  const fine = tipi.indexOf('        };', inizio);
  const m = tipi.slice(inizio, fine).match(new RegExp(`\\n {10}${colonna}: ([^;]+);`));
  expect(m, `${tabella}.${colonna} non è nei tipi`).toBeTruthy();
  return m![1];
}

describe('R11-009 — le colonne che possono restare vuote', () => {
  it.each([
    ['conversations', 'buyer_id'],
    ['conversations', 'seller_id'],
    ['disputes', 'opener_id'],
    ['referrals', 'referred_id'],
    ['returns', 'buyer_id'],
    ['returns', 'seller_id'],
  ])('%s.%s può essere vuota (ALTER … DROP NOT NULL)', (t, c) => {
    expect(riga(t, c), 'il tipo dice «sempre pieno» ma la colonna può essere vuota').toMatch(/\| null$/);
  });

  it('orders.shipping_cost è obbligatoria', () => {
    expect(riga('orders', 'shipping_cost')).toBe('number');
  });

  it('il file salvato è quello che il generatore produce', () => {
    expect(readFileSync(join(process.cwd(), 'lib/database.types.ts'), 'utf8')).toBe(tipi);
  });

});
