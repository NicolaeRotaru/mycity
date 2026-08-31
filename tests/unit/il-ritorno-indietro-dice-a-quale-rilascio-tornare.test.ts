import { describe, it, expect } from 'vitest';
import { passo, esegui, USCITA_VERA_DEL_DEPLOY, RISPOSTA_DEI_RILASCI, INDIRIZZO_DI_PRIMA, SEGRETI_FINTI } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 31/8/2026 (collaudo del rilascio, difetto ①) — IL RITORNO INDIETRO NON TORNAVA INDIETRO.
 *
 * Il passo lanciava `vercel rollback --yes --token=…` senza dire A QUALE
 * rilascio tornare. Nel sorgente della 59.10.0 il primo argomento posizionale
 * vale «status» quando manca: senza indirizzo il comando non annulla niente,
 * stampa «No deployment rollback in progress» ed esce 0. Misura del collaudo
 * del 31/8: uscita 0, rilascio rotto ancora vivo in produzione, passo verde e
 * nel riepilogo la frase «sono tornata alla versione di prima». Una bugia.
 *
 * Il ritorno indietro ha bisogno di un indirizzo, e quell'indirizzo si prende
 * PRIMA di pubblicare: dopo, il rilascio in produzione e' gia' quello nuovo.
 */
describe('il ritorno indietro deve dire a quale rilascio tornare', () => {
  it('prima di pubblicare, il lavoro si segna qual e il rilascio vivo adesso', () => {
    const esito = esegui(passo('Rilascia in produzione'), {
      env: SEGRETI_FINTI,
      uscitaDeploy: USCITA_VERA_DEL_DEPLOY,
      rispostaApi: RISPOSTA_DEI_RILASCI,
    });

    expect(
      esito.output.precedente,
      'Senza l indirizzo del rilascio che sta in produzione adesso non c e nessun posto dove tornare, e il ritorno indietro diventa un comando che non fa niente',
    ).toBe(INDIRIZZO_DI_PRIMA);
  });

  it('non scambia per rilascio vivo quello ancora in costruzione ne un anteprima', () => {
    const esito = esegui(passo('Rilascia in produzione'), {
      env: SEGRETI_FINTI,
      uscitaDeploy: USCITA_VERA_DEL_DEPLOY,
      rispostaApi: RISPOSTA_DEI_RILASCI,
    });

    expect(esito.output.precedente).not.toContain('in-corso');
    expect(esito.output.precedente).not.toContain('anteprima');
  });

  it('se l elenco dei rilasci non risponde, pubblica lo stesso e lo dichiara invece di inventarsi un indirizzo', () => {
    const esito = esegui(passo('Rilascia in produzione'), {
      env: SEGRETI_FINTI,
      uscitaDeploy: USCITA_VERA_DEL_DEPLOY,
      rispostaApi: '<html>502 Bad Gateway</html>',
    });

    expect(esito.uscita, 'Un elenco dei rilasci che non risponde non e un buon motivo per non pubblicare').toBe(0);
    expect(esito.output.precedente, 'Meglio nessun indirizzo che un indirizzo inventato: e la differenza fra «chiedo una mano» e «annullo il rilascio sbagliato»').toBe('');
    expect(esito.stdout).toMatch(/::warning::/);
  });

  it('il comando di ritorno indietro parte con l indirizzo del rilascio a cui tornare', () => {
    const esito = esegui(passo('Torna indietro, il sito appena pubblicato non risponde'), {
      env: { ...SEGRETI_FINTI, PRECEDENTE: INDIRIZZO_DI_PRIMA },
    });

    const chiamata = esito.comandi.find((c) => c.includes(' rollback'));
    expect(chiamata, `Nessun comando di ritorno indietro e partito. Comandi visti: ${esito.comandi.join(' / ') || 'nessuno'}`).toBeTruthy();

    const pezzi = (chiamata ?? '').split(/\s+/);
    const dopoRollback = pezzi[pezzi.indexOf('rollback') + 1];
    expect(
      dopoRollback,
      `Il comando partito e' «${chiamata}». Senza l indirizzo subito dopo «rollback» la CLI 59.10.0 va nel ramo «status»: stampa che non c e nessun ritorno in corso, esce 0, e il rilascio rotto resta vivo.`,
    ).toBe(INDIRIZZO_DI_PRIMA);
  });

  it('se non sa a quale rilascio tornare non dice di essere tornata: chiede una mano', () => {
    const esito = esegui(passo('Torna indietro, il sito appena pubblicato non risponde'), {
      env: { ...SEGRETI_FINTI, PRECEDENTE: '' },
    });

    expect(esito.riepilogo, 'Dichiarare un ritorno indietro che non e avvenuto e il modo piu rapido per far credere che la produzione sia a posto').not.toMatch(/sono tornata/i);
    expect(esito.uscita, 'Il sito e rotto e nessuno e tornato indietro: questo passo non puo finire verde').not.toBe(0);
  });

  it('se il comando di ritorno indietro fallisce, il riepilogo non canta vittoria', () => {
    const esito = esegui(passo('Torna indietro, il sito appena pubblicato non risponde'), {
      env: { ...SEGRETI_FINTI, PRECEDENTE: INDIRIZZO_DI_PRIMA },
      esitoRollback: 1,
    });

    expect(esito.uscita).not.toBe(0);
    expect(esito.riepilogo).not.toMatch(/sono tornata/i);
  });
});
