import { describe, it, expect } from 'vitest';
import { rilascioDaTornare } from '@/scripts/prova-di-fumo.mjs';

/**
 * R07-011 (12/11/2026), caso B — un dominio che non dice il suo commit veniva
 * preso per «un altro commit», perché '' è diverso da qualunque sha: il ritorno
 * indietro tornava al dominio, che poteva essere proprio il rilascio rotto che
 * esce. Senza commit sul dominio si ricade nella regola dell'elenco.
 * (Il caso A, un solo altro commit negli ultimi 20 rilasci, resta aperto.)
 */
const X = '1111111111111111111111111111111111111111';
const Y = '3333333333333333333333333333333333333333';
const W = '2222222222222222222222222222222222222222';
const rilascio = (commit: string, nome: string) => ({
  uid: `dpl_${nome}`, url: `mycity-${nome}.vercel.app`, target: 'production', state: 'READY', meta: { githubCommitSha: commit },
});
const dominioSenzaCommit = { id: 'dpl_dominio', url: 'mycity-sul-dominio.vercel.app', target: 'production', readyState: 'READY', meta: {} };

describe('R07-011 · il dominio senza commit non vale come «un altro commit»', () => {
  it('esce Y, l elenco dice [Y, X], il dominio non dice il commit: si torna a X, non al dominio', () => {
    expect(
      rilascioDaTornare({ deployments: [rilascio(Y, 'y-esce'), rilascio(X, 'x-prima')] }, { commitCheEsce: Y, sulDominio: dominioSenzaCommit }),
    ).toBe('https://mycity-x-prima.vercel.app');
  });

  it('dominio senza commit e due candidati diversi: nessun indirizzo, il ritorno si fa a mano', () => {
    expect(
      rilascioDaTornare(
        { deployments: [rilascio(Y, 'y-esce'), rilascio(X, 'x-prima'), rilascio(W, 'w-ancora-prima')] },
        { commitCheEsce: Y, sulDominio: dominioSenzaCommit },
      ),
    ).toBeNull();
  });

  it('un dominio che dice un altro commit resta la risposta', () => {
    const w = rilascio(W, 'w-dei-clienti');
    expect(
      rilascioDaTornare({ deployments: [rilascio(X, 'x'), w] }, { commitCheEsce: Y, sulDominio: { ...w, readyState: 'READY' } }),
    ).toBe('https://mycity-w-dei-clienti.vercel.app');
  });
});
