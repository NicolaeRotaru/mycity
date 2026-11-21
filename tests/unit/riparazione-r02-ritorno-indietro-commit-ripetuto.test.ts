import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { rilascioDaTornare } from '@/scripts/prova-di-fumo.mjs';

/**
 * R02-008 (21/11/2026) — Col dominio che non si legge, il ritorno indietro sceglieva l'unico
 * altro commit dell'elenco anche quando il commit che esce era gia' stato rilasciato piu' volte:
 * Y uscito, riportato a X perche' rotto, Y di nuovo fuori. L'elenco dice [Y, Y, X] e X puo'
 * essere proprio il rilascio gia' tolto: dove siano i clienti non si sa piu'. Adesso la regola
 * dell'elenco vale solo se il commit che esce compare al piu' una volta fra i rilasci di
 * produzione pronti, e se compare e' il primo; altrimenti nessun indirizzo (ritorno a mano).
 * La scena di ogni giorno [Y, X] resta com'era: si torna a X.
 *
 * In piu' il messaggio di `--rilascio-di-adesso` diceva sempre «il dominio non ha risposto»,
 * anche quando aveva risposto.
 */
const Y = '3333333333333333333333333333333333333333';
const X = '1111111111111111111111111111111111111111';
const rilascio = (commit: string, nome: string) => ({
  uid: `dpl_${nome}`,
  url: `mycity-${nome}.vercel.app`,
  target: 'production',
  state: 'READY',
  meta: { githubCommitSha: commit },
});
const Y_Y_X = { deployments: [rilascio(Y, 'y-esce'), rilascio(Y, 'y-prima-volta'), rilascio(X, 'x-forse-tolto')] };

// Le risposte del dominio che non dicono quale rilascio di produzione pronto lo serve.
const DOMINI_NON_LETTI: Array<[string, unknown]> = [
  ['nessuna risposta', null],
  ['un errore', { error: { code: 'not_found', message: 'The deployment could not be found.' } }],
  ['pronto ma senza target', { uid: 'dpl_d', url: 'mycity-d.vercel.app', readyState: 'READY', meta: { githubCommitSha: X } }],
  ['ancora in costruzione', { uid: 'dpl_d', url: 'mycity-d.vercel.app', target: 'production', readyState: 'BUILDING', meta: { githubCommitSha: X } }],
];

function rilascioDiAdesso(elenco: unknown, env: Record<string, string>) {
  return spawnSync(process.execPath, [join(process.cwd(), 'scripts/prova-di-fumo.mjs'), '--rilascio-di-adesso'], {
    input: JSON.stringify(elenco),
    // Le due variabili del lavoro di rilascio partono vuote: le dice solo il caso.
    env: { ...process.env, COMMIT_CHE_ESCE: '', RILASCIO_SUL_DOMINIO: '', ...env },
    encoding: 'utf8',
  });
}

describe('R02-008 · col dominio non letto, il commit che esce gia\' rilasciato piu\' volte non porta a X', () => {
  for (const [come, sulDominio] of DOMINI_NON_LETTI) {
    it(`[Y, Y, X] e il dominio da\' ${come}: nessun indirizzo`, () => {
      expect(rilascioDaTornare(Y_Y_X, { commitCheEsce: Y, sulDominio })).toBeNull();
    });
  }

  it('[X, Y] col dominio non letto: il commit che esce non e\' il primo, nessun indirizzo', () => {
    const elenco = { deployments: [rilascio(X, 'x'), rilascio(Y, 'y-esce')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: Y })).toBeNull();
  });

  it('[Y, X] col dominio non letto (la scena di ogni giorno): si torna a X, come prima', () => {
    const elenco = { deployments: [rilascio(Y, 'y-esce'), rilascio(X, 'x-prima')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: Y })).toBe('https://mycity-x-prima.vercel.app');
    expect(rilascioDaTornare(elenco, { commitCheEsce: Y, sulDominio: { error: { code: 'forbidden' } } })).toBe(
      'https://mycity-x-prima.vercel.app',
    );
  });

  it('da riga di comando, [Y, Y, X] senza dominio: nessun indirizzo e il messaggio dice che il dominio non ha detto chi serve', () => {
    const esito = rilascioDiAdesso(Y_Y_X, { COMMIT_CHE_ESCE: Y });
    expect(esito.status).not.toBe(0);
    expect(esito.stdout.trim()).toBe('');
    expect(esito.stderr).toMatch(/il dominio non ha risposto con un rilascio di produzione pronto/);
    expect(esito.stderr).toMatch(/gia' stato rilasciato piu' volte/);
  });

  it('da riga di comando, il dominio ha risposto col commit che esce: il messaggio non dice «non ha risposto»', () => {
    const esito = rilascioDiAdesso(
      { deployments: [rilascio(Y, 'y-esce'), rilascio(X, 'x-prima')] },
      { COMMIT_CHE_ESCE: Y, RILASCIO_SUL_DOMINIO: JSON.stringify({ ...rilascio(Y, 'sul-dominio'), readyState: 'READY' }) },
    );
    expect(esito.status).not.toBe(0);
    expect(esito.stdout.trim()).toBe('');
    expect(esito.stderr).not.toMatch(/non ha risposto/);
    expect(esito.stderr).toMatch(/il dominio ha risposto/);
  });
});
