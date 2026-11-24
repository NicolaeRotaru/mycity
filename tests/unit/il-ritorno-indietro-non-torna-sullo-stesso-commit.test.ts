import { describe, it, expect } from 'vitest';
import { rilascioDaTornare } from '@/scripts/prova-di-fumo.mjs';
import { passo, esegui, cli, USCITA_VERA_DEL_DEPLOY, SEGRETI_FINTI } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 31/10/2026 (ondata 1, difetto «il ritorno indietro va all'ultimo rilascio
 * costruito e non a quello che usavano i clienti»).
 *
 * Con `"main": true` in vercel.json Vercel pubblica da solo ogni unione su main
 * entro pochi secondi. Quando il lavoro di rilascio parte, dopo la CI, il primo
 * rilascio pronto in produzione nell'elenco e' gia' lo STESSO commit che sta
 * uscendo. Prima il ritorno indietro andava li': rimetteva online il codice
 * rotto e il riepilogo diceva «annullato».
 *
 * La scena qui sotto e' quella vera di ogni giorno: in cima all'elenco il
 * rilascio automatico del commit nuovo, sotto quello del commit di prima.
 */
const COMMIT_CHE_ESCE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const COMMIT_DI_PRIMA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const ELENCO = {
  deployments: [
    { uid: 'dpl_auto', url: 'mycity-stesso-commit.vercel.app', target: 'production', state: 'READY', meta: { githubCommitSha: COMMIT_CHE_ESCE } },
    { uid: 'dpl_prima', url: 'mycity-commit-di-prima.vercel.app', target: 'production', state: 'READY', meta: { githubCommitSha: COMMIT_DI_PRIMA } },
  ],
};

describe('il ritorno indietro non torna sullo stesso commit che sta uscendo', () => {
  it('il passo di rilascio si segna come posto dove tornare il rilascio del commit di prima', () => {
    const esito = esegui(passo('Rilascia in produzione'), {
      env: { ...SEGRETI_FINTI, COMMIT: COMMIT_CHE_ESCE },
      uscitaDeploy: USCITA_VERA_DEL_DEPLOY,
      rispostaApi: JSON.stringify(ELENCO),
    });

    expect(
      esito.output.precedente,
      'Il primo rilascio pronto e il rilascio automatico dello stesso commit: tornarci vorrebbe dire rimettere online il codice rotto',
    ).toBe('https://mycity-commit-di-prima.vercel.app');
  });

  it('se in produzione c e solo il commit che esce, non inventa un posto dove tornare', () => {
    const soloLui = { deployments: [ELENCO.deployments[0]] };
    expect(rilascioDaTornare(soloLui, { commitCheEsce: COMMIT_CHE_ESCE })).toBeNull();

    const esito = cli(['--rilascio-di-adesso'], {
      stdin: JSON.stringify(soloLui),
      env: { COMMIT_CHE_ESCE: COMMIT_CHE_ESCE.toUpperCase() },
    });
    expect(esito.uscita).not.toBe(0);
    expect(esito.stdout.trim()).toBe('');
  });

  it('un rilascio di cui l elenco non dice il commit resta un posto buono, come prima', () => {
    const senzaCommit = { deployments: [{ url: 'mycity-senza-commit.vercel.app', target: 'production', readyState: 'READY' }] };
    expect(rilascioDaTornare(senzaCommit, { commitCheEsce: COMMIT_CHE_ESCE })).toBe('https://mycity-senza-commit.vercel.app');
  });
});
