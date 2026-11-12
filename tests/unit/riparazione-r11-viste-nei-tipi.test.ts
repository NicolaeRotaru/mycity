import { describe, it, expect } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * R11-010 — Il generatore scriveva sempre «nessuna vista»: le viste che il sito
 * legge (seller_public_profiles in 14 file, cassa compresa) restavano fuori dai
 * tipi. Controllato a mano contro il database ricostruito dalle migrazioni: 10
 * viste, 83 colonne, nomi tutti uguali e 82 tipi uguali (l'ultima, una
 * sottoquery, resta Json).
 */

function tipiGenerati(): string {
  const cartella = mkdtempSync(join(tmpdir(), 'viste-r11-'));
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
const viste = tipi.slice(tipi.indexOf('    Views:'), tipi.indexOf('    Functions:'));
function colonna(vista: string, nome: string): string | undefined {
  const inizio = viste.indexOf(`\n      ${vista}: {`);
  if (inizio < 0) return undefined;
  const blocco = viste.slice(inizio, viste.indexOf('        };', inizio));
  return blocco.match(new RegExp(`\\n {10}${nome}: ([^;]+);`))?.[1];
}

describe('R11-010 — le viste nei tipi', () => {
  it('non scrive più «nessuna vista»', () => {
    expect(viste, 'Views: { [key: string]: never } lascia fuori le viste che il sito legge').not.toContain('Views: { [key: string]: never }');
  });

  it.each([
    ['seller_public_profiles', 'store_name', 'string | null'],
    ['seller_public_profiles', 'stripe_payouts_enabled', 'boolean | null'],
    ['seller_public_profiles', 'business_vat_number', 'string | null'],
    ['ordini_disponibili_rider', 'id', 'string | null'],
    ['ordini_disponibili_rider', 'articoli', 'number | null'],
    ['referral_leaderboard', 'total_referrals', 'number | null'],
    ['nomi_pubblici', 'nome', 'string | null'],
  ])('%s.%s è %s', (vista, nome, tipo) => {
    expect(colonna(vista, nome)).toBe(tipo);
  });

  it('il file salvato è quello che il generatore produce', () => {
    expect(readFileSync(join(process.cwd(), 'lib/database.types.ts'), 'utf8')).toBe(tipi);
  });
});
