import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * LA NEWSLETTER NON DICE «ISCRITTO» PRIMA DEL TEMPO
 * (radiografia del design, 22/8/2026).
 *
 * L'iscrizione è a doppia conferma, ed è giusto che lo sia: la rotta inserisce la
 * riga con `active: false` e un `confirm_token`, poi manda un'email col link e la
 * frase «senza conferma non ti scriveremo». Finché quel link non viene cliccato,
 * l'indirizzo non è iscritto a niente.
 *
 * Il modulo però rispondeva «Iscritto! Riceverai la newsletter ogni venerdì.» e il
 * riquadro verde «Sei iscritto. Riceverai presto le ricette di Piacenza nella tua
 * mail.» Nessuna delle due nominava l'email di conferma.
 *
 * Chi si iscriveva pensava di aver finito, non confermava mai, e non riceveva mai
 * niente — convinto di essere in lista. Il difetto non è nel backend: è che il testo
 * raccontava un fatto diverso da quello successo.
 *
 * QUESTA PROVA TIENE LEGATE LE DUE COSE. Se un giorno la rotta diventasse a conferma
 * singola, o se il testo tornasse a dire «Iscritto», una delle due asserzioni cade:
 * è il legame che mancava, non la singola frase.
 */

const RADICE = resolve(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(resolve(RADICE, f), 'utf8');
const rotta = leggi('app/api/newsletter/route.ts');

const LINGUE = ['messages/it.json', 'messages/en.json'] as const;
const testi = (f: string) => JSON.parse(leggi(f)).newsletter as Record<string, string>;

describe('il backend è a doppia conferma — è il fatto da raccontare', () => {
  it('la riga nasce NON attiva, con un gettone di conferma', () => {
    expect(rotta).toMatch(/active:\s*false/);
    expect(rotta).toMatch(/confirm_token/);
  });

  it('e parte un’email che chiede di confermare', () => {
    expect(rotta).toMatch(/Confermi.{0,20}iscrizione/i);
  });
});

describe('il testo racconta quel fatto, in tutte e due le lingue', () => {
  for (const f of LINGUE) {
    it(`${f}: manda a controllare la posta`, () => {
      const t = testi(f);
      for (const chiave of ['subscribed', 'subscribedBox'] as const) {
        expect(t[chiave]).toBeTruthy();
        expect(t[chiave]).toMatch(/email|posta|inbox/i);
      }
    });

    it(`${f}: non dichiara l’iscrizione già fatta`, () => {
      const t = testi(f);
      // Le frasi vecchie, esatte: «Iscritto! …» e «Sei iscritto. …».
      expect(t.subscribed).not.toMatch(/^Iscritto!/);
      expect(t.subscribed).not.toMatch(/^Subscribed!/);
      expect(t.subscribedBox).not.toMatch(/^Sei iscritto\./);
      expect(t.subscribedBox).not.toMatch(/^You're subscribed\./);
    });

    it(`${f}: dice che c’è un link da cliccare`, () => {
      expect(testi(f).subscribed).toMatch(/link|clicca|click/i);
    });
  }

  it('il riquadro dice anche dove cercare se l’email non si trova', () => {
    expect(testi('messages/it.json').subscribedBox).toMatch(/spam/i);
    expect(testi('messages/en.json').subscribedBox).toMatch(/spam/i);
  });

  it('le due lingue coprono le stesse chiavi: nessuna resta indietro', () => {
    const it = Object.keys(testi('messages/it.json')).sort();
    const en = Object.keys(testi('messages/en.json')).sort();
    expect(en).toEqual(it);
  });
});
