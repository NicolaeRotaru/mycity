import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { firmaDisiscrizione, verificaDisiscrizione, linkDisiscrizione } from '@/lib/email/unsubscribe';

/**
 * R08-020 — il gettone del link per disiscriversi portava l'indirizzo email
 * leggibile (base64url), e il gettone sta nell'indirizzo web: finiva nei log.
 * (La prima metà della voce — aprire il link non disiscrive, serve la conferma —
 * era già riparata: app/api/unsubscribe/route.ts, GET → /disiscrizione.)
 */
const EMAIL = 'maria.rossi@example.it';

/** Tutto quello che si legge decodificando ogni pezzo del gettone. */
function decodificato(token: string): string {
  return token.split('.').map((p) => Buffer.from(p, 'base64url').toString('latin1')).join(' ');
}

describe('R08-020 — il gettone non mostra l’email', () => {
  it('decodificando il gettone (e il link intero) l’indirizzo non si legge', () => {
    const t = firmaDisiscrizione(EMAIL, 'marketing');
    expect(decodificato(t)).not.toContain('maria.rossi');
    expect(decodificato(t)).not.toContain('example.it');
    const link = linkDisiscrizione(EMAIL, 'newsletter');
    expect(decodificato(decodeURIComponent(link.split('token=')[1]))).not.toContain('maria.rossi');
  });

  it('il gettone nuovo si verifica e restituisce email e ambito', () => {
    expect(verificaDisiscrizione(firmaDisiscrizione(EMAIL, 'newsletter'))).toEqual({ email: EMAIL, ambito: 'newsletter' });
  });

  it('un gettone del formato vecchio, già spedito nelle email, vale ancora', () => {
    const dato = `${EMAIL}:marketing`;
    const firma = crypto.createHmac('sha256', process.env.UNSUBSCRIBE_SECRET || 'mycity-dev').update(dato).digest('base64url');
    expect(verificaDisiscrizione(`${Buffer.from(dato).toString('base64url')}.${firma}`)).toEqual({ email: EMAIL, ambito: 'marketing' });
  });

  it('un gettone nuovo manomesso non si apre', () => {
    const t = firmaDisiscrizione(EMAIL, 'marketing');
    const pezzi = Buffer.from(t.slice(3), 'base64url');
    pezzi[14] ^= 0x01;
    expect(verificaDisiscrizione(`v2.${pezzi.toString('base64url')}`)).toBeNull();
    expect(verificaDisiscrizione('v2.')).toBeNull();
    expect(verificaDisiscrizione('v2.corto')).toBeNull();
  });
});
