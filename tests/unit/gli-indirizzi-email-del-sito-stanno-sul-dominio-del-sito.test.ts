/**
 * 8/9/2026 — IL SITO MANDAVA LA GENTE A SCRIVERE SU UN DOMINIO CHE NON È IL SUO.
 *
 * Quattordici indirizzi su `@mycity.it` scritti a mano dentro le pagine, tre su
 * `@mycity-marketplace.com`, e i primi due nella STESSA pagina Contatti. Non
 * sono due modi di scrivere la stessa cosa: sono due caselle di posta diverse,
 * su due fornitori diversi. Verificato da qui l'8/9/2026:
 *
 *   mycity.it              → mx.zoho.com, mx2.zoho.com, mx3.zoho.com
 *   mycity-marketplace.com → mail.mycity-marketplace.com
 *
 * Chi si candida a `lavora@mycity.it` o chiede la cancellazione dei suoi dati a
 * `privacy@mycity.it` (art. 15 e 17 GDPR) scrive in una casella che non è quella
 * del sito, e nessuno di noi la apre. Nella direzione opposta è peggio: se la
 * posta PARTE da un dominio che non c'entra con il sito, i filtri antispam la
 * mettono da parte — e non lo dice nessun log, perché la email risulta consegnata.
 *
 * QUESTA PROVA DIFENDE DUE COSE. ① Gli indirizzi nascono tutti dallo stesso
 * dominio del sito, e si spostano insieme. ② Nessuna pagina se ne scrive uno per
 * conto suo — il modo in cui il difetto è nato la prima volta, e l'unico modo in
 * cui può tornare.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHIAVI_CONTATTO,
  DOMINIO_MYCITY,
  contattiPubblici,
  dominioDeiContatti,
  dominioDelMittente,
  indirizzoContatto,
  mailtoContatto,
  mittenteFuoriDominio,
  ripulisciDominio,
} from '@/lib/contatti-pubblici';
import { DOMINIO_PUBBLICO } from '@/lib/env';
import { titolare } from '@/lib/legal/titolare';

const RADICE = join(__dirname, '..', '..');
const leggi = (f: string) => readFileSync(join(RADICE, f), 'utf8');

/** Via i commenti: la storia di un difetto cita gli indirizzi vecchi apposta. */
const senzaCommenti = (testo: string) =>
  testo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const UN_INDIRIZZO = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

describe('gli indirizzi email che il sito pubblica', () => {
  const salvato = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_CONTATTI_DOMINIO;
    delete process.env.NEXT_PUBLIC_TITOLARE_EMAIL_PRIVACY;
  });
  afterEach(() => {
    process.env = { ...salvato };
  });

  it('stanno tutti sullo stesso dominio, e sul dominio con cui il sito si presenta', () => {
    const dominioDelSito = DOMINIO_PUBBLICO.replace(/^https?:\/\//, '');
    const tutti = Object.values(contattiPubblici(dominioDeiContatti()));

    expect(tutti.length).toBe(CHIAVI_CONTATTO.length);
    for (const indirizzo of tutti) {
      expect(
        indirizzo.split('@')[1],
        `«${indirizzo}» sta su un dominio diverso da quello dove vive il sito: chi scrive li non trova nessuno`,
      ).toBe(dominioDelSito);
    }
    expect(dominioDelSito).toBe(DOMINIO_MYCITY);
  });

  it('IL CASO CHE ROMPEVA — nessuna pagina se ne scrive uno per conto suo', () => {
    // Sono gli otto punti della radiografia del 3/9: piè di pagina, Contatti,
    // Aiuto, FAQ, centro venditori, Lavora con noi, Accessibilità, e i due file
    // di libreria che tenevano un indirizzo di ripiego.
    const sorvegliati = [
      'components/Footer.tsx',
      'app/contact/page.tsx',
      'app/help/page.tsx',
      'app/faq/page.tsx',
      'app/seller/help/page.tsx',
      'app/lavora-con-noi/page.tsx',
      'app/accessibility/page.tsx',
      'lib/legal/titolare.ts',
      'lib/env.ts',
    ];
    for (const file of sorvegliati) {
      const scritti = senzaCommenti(leggi(file)).match(UN_INDIRIZZO) ?? [];
      expect(
        scritti,
        `${file} scrive un indirizzo a mano: e cosi che il sito ha finito per averne diciassette su due domini`,
      ).toEqual([]);
    }
  });

  it('e chi ne mostra uno lo prende dal posto unico', () => {
    const mostrano = [
      'components/Footer.tsx',
      'app/contact/page.tsx',
      'app/help/page.tsx',
      'app/seller/help/page.tsx',
      'app/lavora-con-noi/page.tsx',
      'app/accessibility/page.tsx',
      'lib/legal/titolare.ts',
      'lib/env.ts',
    ];
    for (const file of mostrano) {
      expect(leggi(file), `${file} non legge da lib/contatti-pubblici`).toContain('contatti-pubblici');
    }
  });

  it('spostare il dominio in un posto solo li sposta tutti', () => {
    process.env.NEXT_PUBLIC_CONTATTI_DOMINIO = 'mycity.it';
    const dopo = contattiPubblici(dominioDeiContatti());
    expect(Object.values(dopo).every((i) => i.endsWith('@mycity.it'))).toBe(true);
    expect(dopo.lavoro).toBe('lavora@mycity.it');
    expect(dopo.privacy).toBe('privacy@mycity.it');
  });

  it('e il titolare del trattamento si sposta con loro', () => {
    expect(titolare().emailPrivacy).toBe(indirizzoContatto('privacy'));
    expect(titolare().emailPrivacy.endsWith(`@${DOMINIO_MYCITY}`)).toBe(true);
  });

  it('un dominio che non puo ricevere posta non finisce mai in una pagina', () => {
    for (const brutto of [
      'localhost',
      'localhost:3000',
      'http://localhost:3000',
      'mycity-git-branch.vercel.app',
      'example.com',
      'mycity',
      '  ',
      '',
    ]) {
      process.env.NEXT_PUBLIC_CONTATTI_DOMINIO = brutto;
      expect(
        dominioDeiContatti(),
        `«${brutto}» diventa un indirizzo pubblicato: info@${brutto} stampato su una pagina vera`,
      ).toBe(DOMINIO_MYCITY);
    }
  });

  it('e uno scritto in modo sciatto si capisce lo stesso', () => {
    expect(ripulisciDominio('  HTTPS://MyCity.IT/  ')).toBe('mycity.it');
    expect(ripulisciDominio('mailto:info@mycity.it')).toBe('mycity.it');
    expect(ripulisciDominio('info@mycity.it')).toBe('mycity.it');
  });

  it('il mailto porta l oggetto codificato, anche con gli accenti', () => {
    expect(mailtoContatto('lavoro', 'Candidatura Account negozi')).toBe(
      `mailto:lavora@${DOMINIO_MYCITY}?subject=Candidatura%20Account%20negozi`,
    );
    // Prima erano codificati a mano: un titolo con un accento avrebbe prodotto
    // un collegamento rotto, e non se ne accorgeva nessuno.
    expect(mailtoContatto('lavoro', 'Candidatura città')).toContain('citt%C3%A0');
    expect(mailtoContatto('info')).toBe(`mailto:info@${DOMINIO_MYCITY}`);
  });
});

describe('il sensore sul mittente della posta', () => {
  it('IL CASO CHE ROMPEVA — la posta che parte da un dominio estraneo si vede', () => {
    const scollamento = mittenteFuoriDominio('MyCity <no-reply@mycity.it>', DOMINIO_MYCITY);
    expect(scollamento, 'nessuno si accorge che le email partono da fuori casa').not.toBeNull();
    expect(scollamento?.mittente).toBe('mycity.it');
    expect(scollamento?.riga).toContain('RESEND_FROM');
  });

  it('tace quando il mittente sta sul dominio giusto, in tutte le forme in cui si scrive', () => {
    expect(mittenteFuoriDominio(`MyCity <no-reply@${DOMINIO_MYCITY}>`, DOMINIO_MYCITY)).toBeNull();
    expect(mittenteFuoriDominio(`no-reply@${DOMINIO_MYCITY}`, DOMINIO_MYCITY)).toBeNull();
    expect(mittenteFuoriDominio(`MyCity <NO-REPLY@${DOMINIO_MYCITY.toUpperCase()}>`, DOMINIO_MYCITY)).toBeNull();
  });

  it('e tace anche quando il mittente non c e: quel guasto lo dicono gia in due', () => {
    // `lib/email/client.ts` si ferma prima di spedire e /api/health passa a
    // «degradato»: un terzo allarme per lo stesso guasto e solo rumore.
    expect(mittenteFuoriDominio(undefined, DOMINIO_MYCITY)).toBeNull();
    expect(mittenteFuoriDominio('', DOMINIO_MYCITY)).toBeNull();
    expect(dominioDelMittente(undefined)).toBeNull();
  });
});
