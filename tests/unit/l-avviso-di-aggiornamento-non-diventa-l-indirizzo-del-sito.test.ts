import { describe, it, expect } from 'vitest';
import { passo, esegui, cli, USCITA_VERA_DEL_DEPLOY, INDIRIZZO_PUBBLICATO, RISPOSTA_DEI_RILASCI, SEGRETI_FINTI } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 31/8/2026 (collaudo del rilascio, difetto ②) — L'AVVISO DI AGGIORNAMENTO DIVENTAVA L'INDIRIZZO DEL SITO.
 *
 * L'indirizzo del rilascio appena pubblicato si prendeva con `tail -n 1` dallo
 * stdout della CLI. Con la versione bloccata alla 59.10.0 l'ultima riga non e'
 * l'indirizzo: e' l'avviso «Update available 59.10.0 -> 62.0.1», che non e'
 * l'eccezione ma lo stato normale di tutti i giorni. Il collaudo del 31/8 ha
 * misurato indirizzo='Updateavailable59.10.0->62.0.1', tre controlli su tre
 * caduti e il ritorno indietro fatto partire su un rilascio sanissimo.
 *
 * Queste righe non cercano parole dentro il file del lavoro: eseguono lo stesso
 * script di shell del passo, con `npx` e `curl` sostituiti da finti che
 * rispondono come rispondono quelli veri.
 */
describe('l avviso di aggiornamento della CLI non deve diventare l indirizzo del sito', () => {
  it('dopo aver pubblicato, il lavoro sa a quale indirizzo andare a bussare', () => {
    const esito = esegui(passo('Rilascia in produzione'), {
      env: SEGRETI_FINTI,
      uscitaDeploy: USCITA_VERA_DEL_DEPLOY,
      rispostaApi: RISPOSTA_DEI_RILASCI,
    });

    expect(
      esito.output.indirizzo,
      `Il passo di rilascio ha annotato «${esito.output.indirizzo}» come indirizzo del sito appena pubblicato. Con un indirizzo che non e' un indirizzo la prova di fumo cade sempre, e un rilascio sano viene annullato.`,
    ).toBe(INDIRIZZO_PUBBLICATO);
  });

  it('il collegamento al changelog in coda non viene scambiato per il sito', () => {
    const conChangelog = `${USCITA_VERA_DEL_DEPLOY}\n> Changelog: https://github.com/vercel/vercel/releases/tag/vercel@62.0.1`;
    const esito = cli(['--indirizzo'], { stdin: conChangelog });

    expect(esito.uscita, esito.stderr).toBe(0);
    expect(
      esito.stdout.trim(),
      'Fra le righe in coda c e anche un collegamento al changelog: e un indirizzo, ma non e il nostro sito. Andarci a bussare non dice niente sul rilascio appena fatto.',
    ).toBe(INDIRIZZO_PUBBLICATO);
  });

  it('la riga «Inspect» del pannello di Vercel non e il sito da provare', () => {
    const esito = cli(['--indirizzo'], { stdin: USCITA_VERA_DEL_DEPLOY });
    expect(esito.stdout.trim()).not.toContain('vercel.com/');
    expect(esito.stdout.trim()).toBe(INDIRIZZO_PUBBLICATO);
  });

  it('trova l indirizzo anche quando la CLI lo scrive solo in mezzo a una riga', () => {
    // Se la CLI stampasse solo la riga «Production: … [2s]» e non la riga
    // nuda, prendere solo le righe fatte di solo indirizzo non troverebbe piu'
    // niente e ogni rilascio si fermerebbe. Questa e' la forma scomoda.
    const soloInMezzo = ['Vercel CLI 59.10.0', 'Production: https://mycity-abc123-nicolaerotaru.vercel.app [2s]', '> Update available 59.10.0 -> 62.0.1'].join('\n');
    const esito = cli(['--indirizzo'], { stdin: soloInMezzo });

    expect(esito.uscita, esito.stderr).toBe(0);
    expect(esito.stdout.trim()).toBe(INDIRIZZO_PUBBLICATO);
  });

  it('se non riesce a capire dove ha pubblicato, il passo si ferma e non annota un indirizzo vuoto', () => {
    const esito = esegui(passo('Rilascia in produzione'), {
      env: SEGRETI_FINTI,
      uscitaDeploy: 'Vercel CLI 59.10.0\nError: Build failed\n> Update available 59.10.0 -> 62.0.1',
      rispostaApi: RISPOSTA_DEI_RILASCI,
    });

    expect(esito.uscita, 'Andare avanti senza sapere dove si e pubblicato vuol dire far saltare in silenzio ogni controllo che viene dopo').not.toBe(0);
    expect(esito.output.indirizzo ?? '').toBe('');
  });

  it('se nell uscita non c e nessun indirizzo il lavoro si ferma invece di andare avanti con spazzatura', () => {
    const esito = cli(['--indirizzo'], { stdin: 'Vercel CLI 59.10.0\nError: qualcosa e andato storto\n> Update available 59.10.0 -> 62.0.1' });

    expect(esito.stdout.trim(), 'Senza indirizzo non si stampa niente: una riga qualsiasi presa per indirizzo e peggio di nessun indirizzo').toBe('');
    expect(esito.uscita, 'Chi chiama deve accorgersi che l indirizzo non c e').not.toBe(0);
  });
});
