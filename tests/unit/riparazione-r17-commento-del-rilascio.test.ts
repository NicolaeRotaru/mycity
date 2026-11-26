import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R17-002 — Il commento del passo «Rilascia in produzione» diceva ancora la regola di prima: «se il
 * dominio non risponde e i candidati sono piu' di uno, lo script non sceglie». Dal 24/11 lo script,
 * sapendo il commit che esce (il lavoro di rilascio glielo passa sempre), non sceglie MAI dall'elenco,
 * nemmeno con un candidato solo: si torna indietro solo sul rilascio che il dominio dice, se e' di un
 * altro commit. Chi legge il lavoro deve trovare scritta la regola vera.
 */
const yml = readFileSync(join(process.cwd(), '.github/workflows/deploy-dopo-ci.yml'), 'utf8');

/** Il commento sopra la lettura del dominio, nel passo che pubblica. */
function commentoDelDominio(): string {
  const fine = yml.indexOf('DOMINIO="${DOMINIO_DI_PRODUZIONE:-mycity-marketplace.com}"');
  expect(fine, 'non trovo la lettura del dominio nel lavoro di rilascio').toBeGreaterThan(0);
  const inizio = yml.lastIndexOf("E L'ELENCO NON SA CHI USANO I", fine);
  expect(inizio, 'non trovo il commento sull elenco dei rilasci').toBeGreaterThan(0);
  return yml.slice(inizio, fine).replace(/\n\s*#\s?/g, ' ');
}

describe('R17-002 · il commento del rilascio dice la regola di oggi', () => {
  it('non dice piu che l elenco sceglie quando i candidati sono uno solo', () => {
    expect(yml).not.toMatch(/i candidati sono piu'? di uno/i);
  });

  it('dice che col commit che esce l elenco non sceglie mai, e che si torna solo al dominio di un altro commit', () => {
    const testo = commentoDelDominio();
    expect(testo).toMatch(/solo se il dominio dice un ALTRO commit/);
    expect(testo).toMatch(/commit che esce, e con quello l'elenco da solo non sceglie mai/);
    expect(testo).toMatch(/nemmeno con un candidato solo/);
  });

  it('lo script fa davvero quello che il commento dice (col commit che esce, l elenco da solo non sceglie)', async () => {
    const { rilascioDaTornare } = await import('../../scripts/prova-di-fumo.mjs');
    const rilascio = (url: string, sha: string) => ({ url, target: 'production', readyState: 'READY', meta: { githubCommitSha: sha } });
    const elenco = { deployments: [rilascio('nuovo.vercel.app', 'aaa'), rilascio('vecchio.vercel.app', 'bbb')] };
    expect(rilascioDaTornare(elenco, { commitCheEsce: 'aaa', sulDominio: null })).toBeNull();
    expect(rilascioDaTornare(elenco, { commitCheEsce: 'aaa', sulDominio: rilascio('vecchio.vercel.app', 'bbb') })).toBe('https://vecchio.vercel.app');
  });
});
