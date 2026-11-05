import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { motivoLinkPasswordSenzaSessione } from '@/lib/auth/link-email';

/**
 * S10 (5/11/2026) — la pagina della nuova password.
 * 2647: un link scaduto aperto nello stesso browser non è «aprilo altrove».
 * 1679: la pagina dice di quale account si sta cambiando la password.
 */

describe('link scaduto nello stesso browser (2647)', () => {
  const q = new URLSearchParams('code=abc');
  it('scambio fallito per un motivo diverso dal verificatore → link scaduto', () => {
    expect(motivoLinkPasswordSenzaSessione(q, '', { name: 'AuthApiError', code: 'flow_state_expired' })).toBe('link-scaduto');
  });
  it('verificatore mancante → altro browser', () => {
    expect(
      motivoLinkPasswordSenzaSessione(q, '', { name: 'AuthPKCECodeVerifierMissingError', code: 'pkce_code_verifier_not_found' }),
    ).toBe('altro-browser');
  });
  it('nessun errore noto → come prima, altro browser', () => {
    expect(motivoLinkPasswordSenzaSessione(q, '')).toBe('altro-browser');
  });
  it('la pagina passa l\'errore dello scambio', () => {
    const src = readFileSync('app/reset-password/page.tsx', 'utf8');
    expect(src).toMatch(/const \{ error: erroreDelloScambio \} = await supabase\.auth\.initialize\(\)/);
    expect(src).toMatch(/erroreDelloScambio as \{ name\?: unknown; code\?: unknown \} \| null/);
  });
});

describe('di chi è la password (1679)', () => {
  it('sopra il modulo si scrive l\'email della sessione', () => {
    const src = readFileSync('app/reset-password/page.tsx', 'utf8');
    expect(src).toMatch(/Stai cambiando la password di <strong>\{emailDellaSessione\}<\/strong>/);
    expect(src).toMatch(/setEmailDellaSessione\(data\.session\?\.user\?\.email \?\? null\)/);
  });
});
