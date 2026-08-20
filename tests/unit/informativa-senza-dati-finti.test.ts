import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { eSegnaposto, frameTitolare, rigaIdentita, titolare } from '@/lib/legal/titolare';

/**
 * L'informativa non deve dichiarare cose false su chi risponde dei dati.
 *
 * Cosa c'era scritto prima, in chiaro nella pagina pubblicata:
 * «Il titolare del trattamento è MyCity S.r.l., con sede in Via Roma 1,
 * 29121 Piacenza (PC), P.IVA IT00000000000» — una partita IVA di soli zeri — e
 * un responsabile della protezione dei dati (DPO) all'indirizzo dpo@mycity.it,
 * mai nominato. Su una pagina legale un segnaposto non è un lavoro da finire:
 * è una dichiarazione falsa già pubblicata.
 */

function leggiPagina(file: string): string {
  return readFileSync(path.join(process.cwd(), file), 'utf8');
}

describe('riconoscere un dato finto', () => {
  it('una partita IVA di soli zeri è un segnaposto', () => {
    expect(eSegnaposto('IT00000000000')).toBe(true);
    expect(eSegnaposto('00000000000')).toBe(true);
    expect(eSegnaposto('IT12345678901')).toBe(true);
    expect(eSegnaposto('')).toBe(true);
    expect(eSegnaposto(undefined)).toBe(true);
    expect(eSegnaposto('XXXX-XXXX')).toBe(true);
    expect(eSegnaposto('da definire')).toBe(true);
  });

  it('una partita IVA vera passa', () => {
    expect(eSegnaposto('IT01234567891')).toBe(false);
  });
});

describe('la pagina della privacy', () => {
  const pagina = leggiPagina('app/privacy/page.tsx');

  it('non contiene una partita IVA inventata', () => {
    expect(pagina).not.toMatch(/IT0{5,}/);
  });

  it('non nomina un responsabile della protezione dei dati per default', () => {
    // Va nominato solo se esiste davvero: l'indirizzo arriva da una variabile
    // d'ambiente, non è più scritto dentro la pagina.
    expect(pagina).not.toMatch(/mailto:dpo@/);
  });

  it('dichiara i tre trattamenti che il codice usa davvero', () => {
    // Erano assenti dall'elenco dei responsabili benché presenti nel codice:
    // la registrazione delle sessioni è quella che pesa di più.
    expect(pagina).toContain('PostHog');
    expect(pagina).toContain('Sentry');
    expect(pagina).toContain('Google Ireland');
  });
});

describe('la frase sul titolare', () => {
  it('senza dati reali dice solo il nome, non inventa una sede', () => {
    const frase = frameTitolare({
      denominazione: 'MyCity',
      indirizzo: null,
      partitaIva: null,
      rea: null,
      pec: null,
      capitale: null,
      emailPrivacy: 'privacy@mycity.it',
      referentePrivacy: 'Nicolae Rotaru',
      emailDpo: null,
    });
    expect(frase).toBe('MyCity.');
    expect(frase).not.toMatch(/Via Roma/);
    expect(frase).not.toMatch(/P\.IVA/);
  });

  it('coi dati reali li mostra', () => {
    const frase = frameTitolare({
      denominazione: 'MyCity S.r.l.',
      indirizzo: 'Via Garibaldi 3, 29121 Piacenza (PC)',
      partitaIva: 'IT01234567891',
      rea: 'PC-123456',
      pec: 'mycity@pec.it',
      capitale: '10.000 € i.v.',
      emailPrivacy: 'privacy@mycity.it',
      referentePrivacy: 'Nicolae Rotaru',
      emailDpo: null,
    });
    expect(frase).toContain('IT01234567891');
    expect(frase).toContain('Via Garibaldi 3');
  });

  it('senza variabili d\'ambiente non produce nessun dato finto', () => {
    const t = titolare();
    expect(eSegnaposto(t.partitaIva)).toBe(true);   // assente, non inventata
    expect(t.emailDpo).toBeNull();                   // nessun DPO dichiarato
  });
});


/**
 * LA LEZIONE: un guardiano che sorveglia una porta sola non serve.
 *
 * Questo file esisteva gia' e controllava SOLO `app/privacy/page.tsx`. Intanto
 * la stessa partita IVA finta stava in altri quattro punti — il piè di pagina
 * (che sta su OGNI pagina del sito), i Termini, i Contatti — e un responsabile
 * privacy mai nominato su Cookie. La radiografia del 18 agosto li ha trovati
 * tutti e quattro; il guardiano, nessuno.
 *
 * Adesso guarda ogni pagina pubblica insieme al piè di pagina.
 */
function pagineDaControllare(): string[] {
  const trovate: string[] = ['components/Footer.tsx'];
  const gira = (dir: string) => {
    for (const voce of readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const relativo = `${dir}/${voce.name}`;
      if (voce.isDirectory()) gira(relativo);
      else if (voce.name === 'page.tsx') trovate.push(relativo);
    }
  };
  gira('app');
  return trovate;
}

/**
 * Il suggerimento dentro un campo del modulo NON e' una dichiarazione.
 *
 * `app/profile/addresses/page.tsx` scrive `placeholder="Via Roma 1"` nel campo
 * dove il cliente mette il PROPRIO indirizzo: e' un esempio, e va benissimo.
 * Il primo giro di questo controllo l'ha accusato, ed e' esattamente il modo in
 * cui un guardiano si guadagna di essere spento. Qui i suggerimenti si tolgono
 * prima di guardare, cosi' resta solo il testo che il sito AFFERMA.
 */
function senzaSuggerimentiDiForm(sorgente: string): string {
  return sorgente
    .replace(/placeholder=\{?["'`][^"'`]*["'`]\}?/g, ' ')
    .replace(/placeholder=\{`[^`]*`\}/g, ' ');
}

describe('nessuna pagina pubblica porta un dato legale inventato', () => {
  const SEGNAPOSTI: Array<[string, RegExp]> = [
    ['partita IVA di soli zeri', /IT0{5,}/],
    ['numero REA inventato',     /REA\s*PC-0{4,}/],
    ['PEC inventata',            /mycity@pec\.it/],
    ['DPO mai nominato',         /dpo@mycity\.it/],
    ['sede inventata',           /Via Roma 1/],
  ];

  for (const [nome, forma] of SEGNAPOSTI) {
    it(`nessuna pagina contiene: ${nome}`, () => {
      const colpevoli = pagineDaControllare().filter((f) =>
        forma.test(senzaSuggerimentiDiForm(readFileSync(path.join(process.cwd(), f), 'utf8'))),
      );
      expect(colpevoli).toEqual([]);
    });
  }
});

describe('la riga di identita in fondo alle pagine', () => {
  it('senza partita IVA non stampa niente, invece di stampare zeri', () => {
    expect(rigaIdentita({
      denominazione: 'MyCity',
      indirizzo: null, partitaIva: null, rea: null, pec: null, capitale: null,
      emailPrivacy: 'privacy@mycity.it', referentePrivacy: 'Nicolae Rotaru', emailDpo: null,
    })).toBe('');
  });

  it('coi dati veri li mette tutti in fila', () => {
    const riga = rigaIdentita({
      denominazione: 'MyCity S.r.l.',
      indirizzo: 'Via Garibaldi 3, 29121 Piacenza (PC)',
      partitaIva: 'IT01234567891',
      rea: 'PC-123456',
      pec: 'mycity@pec-vera.it',
      capitale: '10.000 € i.v.',
      emailPrivacy: 'privacy@mycity.it', referentePrivacy: 'Nicolae Rotaru', emailDpo: null,
    });
    expect(riga).toContain('IT01234567891');
    expect(riga).toContain('PC-123456');
    expect(riga).toContain('10.000 € i.v.');
  });

  it('un segnaposto non passa nemmeno se qualcuno lo mette nelle variabili', () => {
    expect(rigaIdentita({
      denominazione: 'MyCity',
      indirizzo: null, partitaIva: null, rea: null, pec: null, capitale: null,
      emailPrivacy: 'privacy@mycity.it', referentePrivacy: null, emailDpo: null,
    })).toBe('');
    expect(eSegnaposto('IT00000000000')).toBe(true);
  });
});

describe('chi risponde della privacy', () => {
  it('e una persona con un nome, e NON un DPO formale', () => {
    const t = titolare();
    // Nicola, 20/8/2026: «per il responsabile di privacy sono io: Nicolae Rotaru».
    expect(t.referentePrivacy).toBeTruthy();
    // Un DPO e' una nomina formale: dichiararlo senza averla fatta e' falso.
    expect(t.emailDpo).toBeNull();
  });
});
