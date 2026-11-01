import { describe, it, expect, beforeEach } from 'vitest';
import { firmaSegnoRecupero, verificaSegnoRecupero, sessioneDelGettone, DURATA_RECUPERO_SECONDI } from '@/lib/auth/segno-recupero';

/**
 * 1/11/2026 — Il segno del rientro col link di recupero: lo firma il server
 * dopo un verifyOtp di tipo recovery, vale per UNA sessione e per un'ora, e
 * senza il segreto non si fabbrica.
 */
beforeEach(() => {
  process.env.RECUPERO_PASSWORD_SECRET = 'segreto-di-prova';
});

function gettoneCon(sessione: string): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b({ sub: 'u1', session_id: sessione })}.firma`;
}

describe('il segno del recupero', () => {
  const ADESSO = Date.UTC(2026, 10, 1, 12, 0, 0);

  it('legge la sessione dal gettone', () => {
    expect(sessioneDelGettone(gettoneCon('s-1'))).toBe('s-1');
    expect(sessioneDelGettone('non-un-gettone')).toBeNull();
  });

  it('firmato per una sessione vale per quella, entro l\'ora', () => {
    const segno = firmaSegnoRecupero('s-1', ADESSO)!;
    expect(verificaSegnoRecupero(segno, 's-1', ADESSO + 1000)).toBe(true);
    expect(verificaSegnoRecupero(segno, 's-2', ADESSO + 1000)).toBe(false);
    expect(verificaSegnoRecupero(segno, 's-1', ADESSO + (DURATA_RECUPERO_SECONDI + 5) * 1000)).toBe(false);
  });

  it('scritto a mano o con un altro segreto non vale', () => {
    const scade = Math.floor(ADESSO / 1000) + 600;
    expect(verificaSegnoRecupero(`s-1.${scade}.firmafinta`, 's-1', ADESSO)).toBe(false);
    const segno = firmaSegnoRecupero('s-1', ADESSO)!;
    process.env.RECUPERO_PASSWORD_SECRET = 'un-altro-segreto';
    expect(verificaSegnoRecupero(segno, 's-1', ADESSO)).toBe(false);
  });

  it('senza nessun segreto non si firma e non si verifica niente', () => {
    delete process.env.RECUPERO_PASSWORD_SECRET;
    const servizio = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(firmaSegnoRecupero('s-1', ADESSO)).toBeNull();
    expect(verificaSegnoRecupero('s-1.1.x', 's-1', ADESSO)).toBe(false);
    if (servizio !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = servizio;
  });
});
