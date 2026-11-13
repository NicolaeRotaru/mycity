/**
 * 13/11/2026 — LA CACHE DI NEXT SI RINNOVA A OGNI COMMIT, ANCHE SULLE RICHIESTE.
 *
 * La chiave della cache di compilazione era una per ramo: salvata al primo
 * giro, non si rinnovava piu' (GitHub non riscrive una chiave che esiste gia').
 * Dopo un commit che cambiava next.config.js tutte le corse della richiesta
 * ricompilavano da zero: fetta 7 della corsa 43375560588, tentativo 2, 102
 * secondi di costruzione invece di circa 50. Questa prova pretende che ogni
 * cache di Next abbia il commit nella chiave e riparta, se non la trova, dal
 * ramo e poi da qualunque costruzione dello stesso tipo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** Per ogni cache di Next nella CI: la chiave e le righe di ripiego. */
function cacheDiNext(workflow: string) {
  const blocchi = [...workflow.matchAll(/key: (next-build-[^\n]+)\n\s+restore-keys: \|\n((?:\s{12}\S[^\n]*\n)+)/g)];
  return blocchi.map((b) => ({ chiave: b[1].trim(), ripieghi: b[2].split('\n').map((r) => r.trim()).filter(Boolean) }));
}

function perche_la_cache_puo_restare_vecchia(workflow: string): string[] {
  const cache = cacheDiNext(workflow);
  const motivi: string[] = [];
  if (cache.length < 3) motivi.push(`trovo ${cache.length} cache di Next invece di 3 (lint, browser, axe)`);
  for (const { chiave, ripieghi } of cache) {
    if (!/\$\{\{ github\.sha \}\}\s*$/.test(chiave)) {
      motivi.push(`la chiave «${chiave}» non finisce col commit: su una richiesta si salverebbe una volta sola`);
    }
    if (/github\.ref == 'refs\/heads\/main' &&/.test(chiave)) {
      motivi.push(`la chiave «${chiave}» usa il commit solo su main`);
    }
    const prefisso = chiave.replace(/\$\{\{ github\.sha \}\}\s*$/, '');
    if (!ripieghi.includes(prefisso)) motivi.push(`«${chiave}» non riparte dalla cache piu' recente dello stesso ramo`);
  }
  return motivi;
}

const vero = readFileSync('.github/workflows/ci.yml', 'utf8');

describe('la cache di compilazione di Next si rinnova a ogni commit', () => {
  it('boccia la chiave di prima, una per ramo (la forma sbagliata)', () => {
    const rotto = vero.replaceAll(
      '${{ github.head_ref || github.ref_name }}-${{ github.sha }}',
      "${{ github.ref == 'refs/heads/main' && github.sha || github.head_ref || github.ref_name }}",
    );
    expect(rotto).not.toBe(vero);
    expect(perche_la_cache_puo_restare_vecchia(rotto).length).toBeGreaterThan(0);
  });

  it('la CI vera: tre cache, tutte col commit nella chiave', () => {
    expect(perche_la_cache_puo_restare_vecchia(vero)).toEqual([]);
  });
});
