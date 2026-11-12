/**
 * R06-008 (12/11/2026) — LA SCELTA FRA TRE E DIECI SECONDI, PROVATA DA SOLA.
 *
 * Prima stava in linea nel middleware e nessuna prova la esercitava. Ora e'
 * `tettoPerGetUser` nel modulo: dieci secondi solo se la tessera va rinnovata.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tettoPerGetUser, TETTO_RINNOVO_MS } from '@/lib/auth/cookie-di-sessione';
import { TETTO_PORTIERE_MS } from '@/lib/auth/decisione-portiere';

const NOME = 'sb-progetto-auth-token';
const ADESSO = Date.UTC(2026, 10, 12, 10, 0, 0);
function tessera(scadeFraSecondi: number): string {
  const s = { access_token: 'a', refresh_token: 'r', expires_at: Math.floor(ADESSO / 1000) + scadeFraSecondi };
  return `base64-${Buffer.from(JSON.stringify(s)).toString('base64url')}`;
}

describe('R06-008 · tettoPerGetUser', () => {
  it('tessera buona per un\'ora: tre secondi (e\' una lettura)', () => {
    expect(tettoPerGetUser([{ name: NOME, value: tessera(3600) }], ADESSO)).toBe(TETTO_PORTIERE_MS);
  });
  it('tessera in scadenza: dieci secondi (getUser la rinnova)', () => {
    expect(tettoPerGetUser([{ name: NOME, value: tessera(30) }], ADESSO)).toBe(TETTO_RINNOVO_MS);
  });
  it('tessera gia\' scaduta: dieci secondi', () => {
    expect(tettoPerGetUser([{ name: NOME, value: tessera(-60) }], ADESSO)).toBe(TETTO_RINNOVO_MS);
  });
  it('nessuna tessera: tre secondi', () => {
    expect(tettoPerGetUser([{ name: 'altro', value: 'x' }], ADESSO)).toBe(TETTO_PORTIERE_MS);
  });
  it('il middleware usa la funzione del modulo, non una scelta scritta in linea', () => {
    const sorgente = readFileSync(path.resolve(__dirname, '../../middleware.ts'), 'utf8');
    expect(sorgente).toContain('tettoPerGetUser(req.cookies.getAll(), Date.now())');
    expect(sorgente).not.toMatch(/staRinnovando \? TETTO_RINNOVO_MS : TETTO_PORTIERE_MS/);
  });
});
