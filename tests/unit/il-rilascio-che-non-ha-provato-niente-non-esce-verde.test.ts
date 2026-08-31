import { describe, it, expect } from 'vitest';
import { passiDelLavoro, passo, esegui } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 31/8/2026 (collaudo del rilascio, difetto ③) — VENTIDUE ESECUZIONI SU VENTIDUE VERDI, E NON AVEVANO
 * PROVATO NIENTE.
 *
 * Senza i segreti di Vercel il lavoro salta ogni passo — Checkout compreso — e
 * finisce verde in cinque secondi. Fuori si vede la stessa spunta di un
 * rilascio controllato: la prova di fumo e il ritorno indietro non erano mai
 * girati nemmeno una volta, e intanto la produzione usciva da un altra strada.
 * Zero controlli fatti non e un successo: e un «non lo so», e va detto.
 */
describe('un rilascio che non ha provato niente non puo finire verde', () => {
  it('c e un passo che gira sempre, anche quando tutti gli altri saltano', () => {
    const sempre = passiDelLavoro().filter((p) => (p.se ?? '').includes('always()') && p.run);
    expect(
      sempre.map((p) => p.nome),
      'Nessun passo di questo lavoro gira comunque: se i segreti mancano si salta tutto e la spunta verde dice una cosa che non e successa',
    ).toContain('Il verdetto — cosa ho provato davvero');
  });

  it('quando mancano le chiavi lo dice e non finisce verde', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'false', INDIRIZZO: '', CODICE_FUMO: '', TORNATO: '' },
    });

    expect(esito.uscita, 'Un lavoro che non ha guardato niente non puo mostrare la stessa spunta di uno che ha guardato').not.toBe(0);
    expect(esito.riepilogo).toMatch(/non ho provato niente/i);
  });

  it('quando ha pubblicato ma non e riuscito a provare il sito, non finisce verde', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: '', CODICE_FUMO: '', TORNATO: '' },
    });

    expect(esito.uscita).not.toBe(0);
    expect(esito.riepilogo).toMatch(/non ho provato niente/i);
  });

  it('quando il sito ha risposto davvero, allora si che e verde', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '0', TORNATO: '' },
    });

    expect(esito.uscita, `Riepilogo: ${esito.riepilogo}`).toBe(0);
    expect(esito.riepilogo).toMatch(/risponde/i);
  });

  it('con un indirizzo storto dice che della produzione non sa niente, e non dichiara ritorni indietro', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'Updateavailable59.10.0->62.0.1', CODICE_FUMO: '3', TORNATO: '' },
    });

    expect(esito.uscita).not.toBe(0);
    expect(esito.riepilogo).not.toMatch(/sono tornata/i);
    expect(esito.riepilogo).toMatch(/non so/i);
  });

  it('se il sito era rotto e nessuno e tornato indietro, il riepilogo lo grida', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '1', TORNATO: '' },
    });

    expect(esito.uscita).not.toBe(0);
    expect(esito.riepilogo).not.toMatch(/sono tornata/i);
    expect(esito.riepilogo).toMatch(/a mano/i);
  });

  it('anche un ritorno indietro riuscito resta rosso: qualcosa e andato storto lo stesso', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '1', TORNATO: 'si' },
    });

    expect(esito.uscita, 'Un rilascio annullato non e un rilascio riuscito: se qui fosse verde nessuno andrebbe a vedere cosa e caduto').not.toBe(0);
    expect(esito.riepilogo).toMatch(/sono tornata/i);
  });

  it('dice che la produzione esce anche da un altra strada, finche Vercel pubblica da solo', () => {
    const esito = esegui(passo('Il verdetto — cosa ho provato davvero'), {
      env: { PRONTO: 'true', INDIRIZZO: 'https://mycity-abc.vercel.app', CODICE_FUMO: '0', TORNATO: '' },
    });

    // vercel.json tiene ancora acceso il rilascio automatico su main: finche' e'
    // cosi', questo lavoro non e' l'unica porta verso la produzione, e dirlo e'
    // l'unico modo perche' il verde non venga letto per piu' di quello che vale.
    expect(esito.riepilogo, 'Se Vercel pubblica ancora da solo a ogni unione, un verde qui non copre la strada da cui la produzione esce davvero').toMatch(/da solo/i);
  });
});
