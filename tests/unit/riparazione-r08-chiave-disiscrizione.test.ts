import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { firmaDisiscrizione, verificaDisiscrizione } from '@/lib/email/unsubscribe';

/**
 * R08-001 — la chiave che cifra il link di disiscrizione si ricavava con lo
 * stesso calcolo delle firme dei gettoni v1: HMAC(segreto, testo). Reggeva solo
 * perché «cifratura» non è un ambito valido. Qui si prova che la chiave dei
 * gettoni nuovi non è più un HMAC del segreto, e che tutti i link già spediti
 * (v2 cifrati con la chiave di prima, v1 firmati) si aprono ancora: chi clicca
 * «smetti» su una email vecchia deve poter smettere.
 */
const SEGRETO = process.env.UNSUBSCRIBE_SECRET || 'mycity-dev';
const EMAIL = 'lucia.bianchi@example.it';

/** La chiave di prima: lo stesso calcolo di una firma v1, su un testo fisso. */
const chiaveComeUnaFirma = (testo: string) => crypto.createHmac('sha256', SEGRETO).update(testo).digest();

function cifra(chiave: Buffer, dato: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chiave, iv);
  const cifrato = Buffer.concat([c.update(dato, 'utf8'), c.final()]);
  return Buffer.concat([iv, cifrato, c.getAuthTag()]).toString('base64url');
}

function apri(chiave: Buffer, corpo: string): string | null {
  try {
    const t = Buffer.from(corpo, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', chiave, t.subarray(0, 12));
    d.setAuthTag(t.subarray(t.length - 16));
    return Buffer.concat([d.update(t.subarray(12, t.length - 16)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Il corpo cifrato di un gettone, senza il prefisso di versione. */
const corpo = (token: string) => token.slice(token.indexOf('.') + 1);

describe('R08-001 — la chiave di cifratura non è una firma', () => {
  it('un gettone nuovo non si apre con una chiave calcolata come le firme (HMAC del segreto)', () => {
    const t = firmaDisiscrizione(EMAIL, 'marketing');
    for (const testo of ['disiscrizione:cifratura:v2', 'disiscrizione:cifratura:v3', 'disiscrizione:cifratura']) {
      expect(
        apri(chiaveComeUnaFirma(testo), corpo(t)),
        `il gettone nuovo si apre con HMAC(segreto, '${testo}'): la chiave si ricava ancora come una firma`,
      ).toBeNull();
    }
  });

  it('un gettone nuovo si apre e dice email e ambito', () => {
    expect(verificaDisiscrizione(firmaDisiscrizione(EMAIL, 'newsletter'))).toEqual({ email: EMAIL, ambito: 'newsletter' });
    expect(verificaDisiscrizione(firmaDisiscrizione(`  ${EMAIL.toUpperCase()} `, 'marketing'))).toEqual({ email: EMAIL, ambito: 'marketing' });
  });

  it('un gettone v2 già spedito, cifrato con la chiave di prima, si apre ancora', () => {
    const v2 = `v2.${cifra(chiaveComeUnaFirma('disiscrizione:cifratura:v2'), `${EMAIL}:marketing`)}`;
    expect(verificaDisiscrizione(v2)).toEqual({ email: EMAIL, ambito: 'marketing' });
  });

  it('un gettone v1 firmato vale come prima', () => {
    const dato = `${EMAIL}:newsletter`;
    const firma = crypto.createHmac('sha256', SEGRETO).update(dato).digest('base64url');
    expect(verificaDisiscrizione(`${Buffer.from(dato).toString('base64url')}.${firma}`)).toEqual({ email: EMAIL, ambito: 'newsletter' });
    expect(verificaDisiscrizione(`${Buffer.from(dato).toString('base64url')}.${firma.slice(1)}x`)).toBeNull();
  });

  it('un gettone nuovo manomesso non si apre, e non si apre spacciato per v2', () => {
    const t = firmaDisiscrizione(EMAIL, 'marketing');
    const prefisso = t.slice(0, t.indexOf('.') + 1);
    const pezzi = Buffer.from(corpo(t), 'base64url');
    pezzi[14] ^= 0x01;
    expect(verificaDisiscrizione(`${prefisso}${pezzi.toString('base64url')}`)).toBeNull();
    if (prefisso !== 'v2.') expect(verificaDisiscrizione(`v2.${corpo(t)}`)).toBeNull();
  });
});
