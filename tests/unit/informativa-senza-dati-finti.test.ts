import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eSegnaposto, frameTitolare, titolare } from '@/lib/legal/titolare';

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
      emailPrivacy: 'privacy@mycity.it',
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
      emailPrivacy: 'privacy@mycity.it',
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
