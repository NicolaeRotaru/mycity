import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkTitolare } from '@/lib/health/titolare-check';

/**
 * 30/8/2026 (R192) — CINQUE INDIRIZZI CHE, SE MANCANO, FANNO SPARIRE PEZZI DI
 * CONTRATTO SENZA DIRLO A NESSUNO.
 *
 * Le Condizioni d'uso promettono al cliente cinque caselle: dove mandare un
 * reso, dove reclamare, dove scrivere all'ufficio legale, dove segnalare un
 * problema di sicurezza, dove segnalare un contenuto illecito. Ognuna di quelle
 * righe e' scritta cosi': se la variabile non c'e', la riga non si stampa. La
 * pagina esce senza errori, piu' corta, e sembra a posto.
 *
 * Le cinque variabili non erano nemmeno elencate in `.env.example`, quindi non
 * c'era un posto dove accorgersi che mancavano; e hanno il prefisso
 * `NEXT_PUBLIC_`, cioe' entrano nel sito quando lo si COMPILA: metterle dopo
 * su Vercel non basta, bisogna ricompilare. Il controllo di salute guardava
 * solo indirizzo, partita IVA, PEC e denominazione: delle cinque caselle non
 * diceva niente.
 *
 * Adesso il controllo le nomina una per una, cosi' «mancano» smette di essere
 * una cosa che si scopre dal cliente che non trova dove scrivere.
 */

const CINQUE = {
  NEXT_PUBLIC_TITOLARE_EMAIL_RESI: 'resi@mycity.it',
  NEXT_PUBLIC_TITOLARE_EMAIL_RECLAMI: 'reclami@mycity.it',
  NEXT_PUBLIC_TITOLARE_EMAIL_LEGALE: 'legale@mycity.it',
  NEXT_PUBLIC_TITOLARE_EMAIL_SICUREZZA: 'sicurezza@mycity.it',
  NEXT_PUBLIC_TITOLARE_EMAIL_SEGNALAZIONI: 'segnalazioni@mycity.it',
};

const ANAGRAFICA = {
  NEXT_PUBLIC_TITOLARE_NOME: 'MyCity S.r.l.',
  NEXT_PUBLIC_TITOLARE_INDIRIZZO: 'Via Roma 3, 29121 Piacenza (PC)',
  NEXT_PUBLIC_TITOLARE_PIVA: 'IT01987654321',
  NEXT_PUBLIC_TITOLARE_PEC: 'mycity@pec.example',
};

const TUTTE = { ...CINQUE, ...ANAGRAFICA };
const originali: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of Object.keys(TUTTE)) {
    originali[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(originali)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('la salute dei dati del titolare', () => {
  it('dice quali caselle di posta promesse dalle Condizioni non esistono', () => {
    for (const [k, v] of Object.entries(ANAGRAFICA)) process.env[k] = v;

    const esito = checkTitolare();

    expect(esito.status, 'senza le caselle di posta promesse il sito si dichiara a posto').not.toBe('operational');
    for (const parola of ['resi', 'reclami', 'legale', 'sicurezza', 'segnalazioni']) {
      expect(
        (esito.detail ?? '').toLowerCase(),
        `nessuno sa che manca la casella «${parola}»: nelle Condizioni quella riga sparisce e basta`,
      ).toContain(parola);
    }
  });

  it('quando ci sono tutte non si lamenta di niente', () => {
    for (const [k, v] of Object.entries(TUTTE)) process.env[k] = v;
    const esito = checkTitolare();
    expect(esito.status, `si lamenta ancora: ${esito.detail}`).toBe('operational');
    expect(esito.detail).toBeNull();
  });

  it('continua a chiedere anche i dati di identita del titolare', () => {
    for (const [k, v] of Object.entries(CINQUE)) process.env[k] = v;
    const esito = checkTitolare();
    expect(esito.status).not.toBe('operational');
    expect((esito.detail ?? '').toLowerCase()).toContain('partita iva');
  });
});
