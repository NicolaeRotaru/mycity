import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { rilascioDaTornare } from '@/scripts/prova-di-fumo.mjs';

/**
 * R06-008 — Il ritorno indietro poteva ancora scegliere il rilascio sbagliato in due casi rari.
 *  · A: il dominio non si legge e fra i 20 rilasci letti c'e' un solo altro commit. Veniva scelto,
 *    anche quando era il rilascio rotto gia' tolto (X rotto, riportato a W che sta fuori dai 20;
 *    esce Y, e l'elenco dice [Y, X]).
 *  · E: il dominio risponde ma non porta lo sha. Senza il commit che esce veniva preso per buono,
 *    anche quando ci stava gia' il rilascio che esce.
 * Decisione della regia: in tutti e due la risposta e' «nessuno», e il ritorno indietro si fa a mano
 * (la strada che c'e' gia'). Elenchi di rilasci finti, nessuna rete: nessuna chiamata a Vercel.
 */
const Y = '3333333333333333333333333333333333333333'; // il commit che esce
const X = '1111111111111111111111111111111111111111'; // l'unico altro commit dell'elenco
const W = '2222222222222222222222222222222222222222';

const rilascio = (commit: string | null, nome: string) => ({
  uid: `dpl_${nome}`,
  url: `mycity-${nome}.vercel.app`,
  target: 'production',
  readyState: 'READY',
  meta: commit ? { githubCommitSha: commit } : {},
});
const Y_X = { deployments: [rilascio(Y, 'y-esce'), rilascio(X, 'x-forse-tolto')] };

function rilascioDiAdesso(elenco: unknown, env: Record<string, string>) {
  return spawnSync(process.execPath, [join(process.cwd(), 'scripts/prova-di-fumo.mjs'), '--rilascio-di-adesso'], {
    input: JSON.stringify(elenco),
    env: { ...process.env, COMMIT_CHE_ESCE: '', RILASCIO_SUL_DOMINIO: '', ...env },
    encoding: 'utf8',
  });
}

afterEach(() => vi.restoreAllMocks());

describe('R06-008 · A: il dominio non si legge e nell\'elenco c\'e\' un solo altro commit', () => {
  const nonLetti: Array<[string, unknown]> = [
    ['nessuna risposta', null],
    ['un errore', { error: { code: 'forbidden', message: 'Not authorized' } }],
    ['ancora in costruzione', { ...rilascio(W, 'sul-dominio'), readyState: 'BUILDING' }],
  ];
  for (const [come, sulDominio] of nonLetti) {
    it(`[Y, X] col dominio che da' ${come}: nessun indirizzo, X puo' essere il rilascio gia' tolto`, () => {
      const fetchFinto = vi.spyOn(globalThis, 'fetch');
      expect(rilascioDaTornare(Y_X, { commitCheEsce: Y, sulDominio })).toBeNull();
      expect(fetchFinto).not.toHaveBeenCalled();
    });
  }

  it('[X, X, X] senza il commit che esce nell\'elenco: nessun indirizzo nemmeno qui', () => {
    const soloX = { deployments: [rilascio(X, 'x1'), rilascio(X, 'x2'), rilascio(X, 'x3')] };
    expect(rilascioDaTornare(soloX, { commitCheEsce: Y })).toBeNull();
  });

  it('da riga di comando: nessun indirizzo, uscita non zero, e il messaggio dice perche\'', () => {
    const esito = rilascioDiAdesso(Y_X, { COMMIT_CHE_ESCE: Y });
    expect(esito.stdout.trim(), 'il lavoro di rilascio si segnerebbe X come posto dove tornare').toBe('');
    expect(esito.status).not.toBe(0);
    expect(esito.stderr).toMatch(/il dominio non ha risposto/);
  });
});

describe('R06-008 · E: il dominio risponde ma non dice il suo commit', () => {
  const senzaSha = { ...rilascio(null, 'sul-dominio') };

  it('senza il commit che esce: nessun indirizzo (poteva essere proprio il rilascio che esce)', () => {
    expect(rilascioDaTornare(Y_X, { sulDominio: senzaSha })).toBeNull();
    expect(rilascioDaTornare({ deployments: [] }, { sulDominio: senzaSha })).toBeNull();
  });

  it('col commit che esce: nessun indirizzo, come gia\' prima', () => {
    expect(rilascioDaTornare(Y_X, { commitCheEsce: Y, sulDominio: senzaSha })).toBeNull();
  });

  it('da riga di comando, senza COMMIT_CHE_ESCE: nessun indirizzo e il messaggio dice che il dominio ha risposto', () => {
    const esito = rilascioDiAdesso(Y_X, { RILASCIO_SUL_DOMINIO: JSON.stringify(senzaSha) });
    expect(esito.stdout.trim()).toBe('');
    expect(esito.status).not.toBe(0);
    expect(esito.stderr).toMatch(/il dominio ha risposto/);
  });
});

describe('R06-008 · controprove: quello che il dominio dice chiaramente non cambia', () => {
  it('il dominio dice un altro commit: si torna li\'', () => {
    expect(rilascioDaTornare(Y_X, { commitCheEsce: Y, sulDominio: rilascio(W, 'sul-dominio') })).toBe('https://mycity-sul-dominio.vercel.app');
    expect(rilascioDaTornare(Y_X, { sulDominio: rilascio(W, 'sul-dominio') })).toBe('https://mycity-sul-dominio.vercel.app');
  });

  it('il dominio dice il commit che esce: nessun indirizzo', () => {
    expect(rilascioDaTornare(Y_X, { commitCheEsce: Y, sulDominio: rilascio(Y, 'sul-dominio') })).toBeNull();
  });
});
