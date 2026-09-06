import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { env, DOMINIO_PUBBLICO } from '@/lib/env';

/**
 * 6/9/2026 — SENZA IL MITTENTE CONFIGURATO LE EMAIL PARTIVANO DA UN DOMINIO
 * FINTO E FALLIVANO UNA PER UNA.
 *
 * Se `RESEND_FROM` mancava, `lib/env.ts` ripiegava su
 * «MyCity <no-reply@example.com>» e `lib/email/client.ts` lo usava come
 * mittente vero. `example.com` è un dominio riservato agli esempi: Resend non
 * lo verificherà mai, quindi la conferma d'ordine al cliente e l'avviso al
 * negozio fallivano ALL'INVIO, uno alla volta, mentre il sito continuava a
 * incassare. Il guasto si scopriva una email per volta, invece che una volta
 * sola alla configurazione.
 *
 * È lo stesso errore già riparato in questo stesso file per
 * NEXT_PUBLIC_APP_URL: lì «localhost» finiva nell'HTML servito a Google, qui
 * «example.com» finiva nella busta. E la cura è la stessa che si era scelta lì:
 * se nessuno ce l'ha detto, si ripiega su un indirizzo NOSTRO — lo stesso
 * dominio con cui il sito si presenta al mondo — non su uno che non esiste.
 *
 * ⚠️ Cosa questa prova NON copre: che quel dominio sia verificato su Resend.
 * Quello si fa nel pannello di Resend e non si vede da qui. Copre che il
 * mittente di riserva sia un indirizzo nostro e non un segnaposto.
 */

const salvato = { ...process.env };

beforeEach(() => {
  process.env = { ...salvato };
});

afterEach(() => {
  process.env = { ...salvato };
});

describe('il mittente con cui MyCity spedisce la posta', () => {
  it('quando è configurato è quello, punto', () => {
    process.env.RESEND_FROM = 'MyCity <ordini@mycity-marketplace.com>';
    expect(env.resendFrom()).toBe('MyCity <ordini@mycity-marketplace.com>');
  });

  it('se manca, si ripiega sul dominio con cui il sito si presenta al mondo', () => {
    delete process.env.RESEND_FROM;
    const dominio = DOMINIO_PUBBLICO.replace(/^https?:\/\//, '');
    expect(env.resendFrom()).toContain(`@${dominio}`);
  });

  it('il ripiego non è più un dominio che non esiste', () => {
    delete process.env.RESEND_FROM;
    const mittente = env.resendFrom() ?? '';
    expect(
      mittente,
      'si riparte da un dominio riservato agli esempi: Resend lo rifiuta e ogni email fallisce all\'invio',
    ).not.toContain('example.com');
    expect(mittente).not.toContain('example.org');
    expect(mittente).not.toContain('localhost');
  });

  it('una variabile vuota o fatta di spazi vale come mancante, non come mittente', () => {
    process.env.RESEND_FROM = '   ';
    expect(env.resendFrom()).not.toBe('   ');
    expect(env.resendFrom()).toContain('@');
  });

  it("nel sorgente il segnaposto degli esempi non c'è più", () => {
    const sorgente = readFileSync('lib/env.ts', 'utf8');
    const righeVive = sorgente
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
    const conEsempio = righeVive.filter((l) => l.includes('no-reply@example.com'));
    expect(
      conEsempio,
      `il mittente finto è tornato nel codice: ${conEsempio.join(' | ')}`,
    ).toHaveLength(0);
  });
});
