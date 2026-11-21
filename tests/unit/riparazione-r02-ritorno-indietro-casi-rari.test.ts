import { describe, it, expect } from 'vitest';
import { rilascioDaTornare } from '@/scripts/prova-di-fumo.mjs';

/**
 * R02-005 (21/11/2026, scelta di Nicola) — il ritorno indietro sceglieva ancora il
 * rilascio sbagliato in due casi rari: il dominio dice il commit che esce e
 * nell'elenco c'e' un solo altro commit, oppure il dominio non dice il suo commit.
 * In tutti e due chi usavano i clienti prima non si sa: nessun indirizzo, il
 * ritorno si fa a mano. Quando il dominio non si legge affatto resta la regola
 * dell'elenco (la scena di ogni giorno).
 */
const ESCE = '3333333333333333333333333333333333333333';
const ROTTO = '1111111111111111111111111111111111111111';
const PRIMA = '2222222222222222222222222222222222222222';
const rilascio = (commit: string | null, nome: string) => ({
  uid: `dpl_${nome}`,
  url: `mycity-${nome}.vercel.app`,
  target: 'production',
  state: 'READY',
  meta: commit ? { githubCommitSha: commit } : {},
});
const dominio = (commit: string | null) => ({ ...rilascio(commit, 'sul-dominio'), readyState: 'READY' });

describe('R02-005 · il ritorno indietro non tira a indovinare nei due casi rari', () => {
  it('il dominio dice il commit che esce e nell elenco c e un solo altro commit: nessun indirizzo', () => {
    const elenco = { deployments: [rilascio(ESCE, 'esce'), rilascio(ROTTO, 'forse-rotto'), rilascio(ROTTO, 'forse-rotto-2')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: ESCE, sulDominio: dominio(ESCE) })).toBeNull();
  });

  it('il dominio non dice il suo commit e nell elenco c e un solo altro commit: nessun indirizzo', () => {
    const elenco = { deployments: [rilascio(ESCE, 'esce'), rilascio(ROTTO, 'forse-rotto')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: ESCE, sulDominio: dominio(null) })).toBeNull();
  });

  it('il dominio dice un altro commit: si torna li, come prima', () => {
    const elenco = { deployments: [rilascio(ESCE, 'esce'), rilascio(ROTTO, 'forse-rotto')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: ESCE, sulDominio: dominio(PRIMA) })).toBe('https://mycity-sul-dominio.vercel.app');
  });

  it('il dominio non si legge: resta la regola dell elenco, un solo altro commit e quello', () => {
    const elenco = { deployments: [rilascio(ESCE, 'esce'), rilascio(PRIMA, 'prima')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: ESCE })).toBe('https://mycity-prima.vercel.app');
  });
});
