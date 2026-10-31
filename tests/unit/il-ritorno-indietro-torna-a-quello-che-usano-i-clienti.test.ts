import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rilascioDaTornare } from '@/scripts/prova-di-fumo.mjs';
import { passo, cli, USCITA_VERA_DEL_DEPLOY, SEGRETI_FINTI } from '@/tests/unit/_lavoro-di-rilascio';

/**
 * 31/10/2026 (ondata 1, secondo giro dopo il collaudo) — IL RITORNO INDIETRO
 * ANDAVA ALL'ULTIMO RILASCIO COSTRUITO, NON A QUELLO CHE USAVANO I CLIENTI.
 *
 * La scena del collaudo: il commit X era uscito rotto ed era stato riportato a
 * W con `vercel rollback`. Sul dominio, quindi, i clienti usano W. Adesso esce
 * Y. L'elenco dei rilasci di Vercel, dal piu' recente, dice [X, W]: prendere il
 * primo vuol dire, se Y non risponde, «tornare» a X — cioe' rimettere online il
 * codice che era gia' stato tolto perche' rotto, e scrivere «annullato».
 *
 * L'elenco da solo non distingue «X e' vivo» da «X e' stato tolto»: lo sa solo
 * il dominio. Quindi il lavoro chiede a Vercel quale rilascio serve il dominio
 * adesso, e quando non lo sa non tira a indovinare fra due candidati.
 */
const X = '1111111111111111111111111111111111111111';
const W = '2222222222222222222222222222222222222222';
const Y = '3333333333333333333333333333333333333333';

const rilascio = (commit: string, nome: string) => ({
  uid: `dpl_${nome}`,
  url: `mycity-${nome}.vercel.app`,
  target: 'production',
  state: 'READY',
  meta: { githubCommitSha: commit },
});

const RILASCIO_X = rilascio(X, 'x-rotto');
const RILASCIO_W = rilascio(W, 'w-dei-clienti');
const RILASCIO_Y = rilascio(Y, 'y-automatico');

// Come risponde GET /v13/deployments/<dominio>: un rilascio solo, con
// `readyState` al posto di `state`.
const sulDominio = (r: ReturnType<typeof rilascio>) => ({ id: r.uid, url: r.url, target: 'production', readyState: 'READY', meta: r.meta });

describe('il ritorno indietro torna al rilascio che usano i clienti', () => {
  it('X riportato a W, esce Y: si torna a W, che e quello sul dominio', () => {
    expect(
      rilascioDaTornare({ deployments: [RILASCIO_X, RILASCIO_W] }, { commitCheEsce: Y, sulDominio: sulDominio(RILASCIO_W) }),
      'X era gia stato tolto perche rotto: tornarci vuol dire rimettere online il codice rotto',
    ).toBe('https://mycity-w-dei-clienti.vercel.app');
  });

  it('senza sapere chi c e sul dominio, fra due candidati non tira a indovinare', () => {
    expect(rilascioDaTornare({ deployments: [RILASCIO_X, RILASCIO_W] }, { commitCheEsce: Y })).toBeNull();
  });

  it('se Vercel ha gia messo Y sul dominio da solo, si torna all ultimo rilascio di un altro commit', () => {
    expect(
      rilascioDaTornare({ deployments: [RILASCIO_Y, RILASCIO_X, RILASCIO_W] }, { commitCheEsce: Y, sulDominio: sulDominio(RILASCIO_Y) }),
    ).toBe('https://mycity-x-rotto.vercel.app');
  });

  it('da riga di comando legge il dominio dalla variabile RILASCIO_SUL_DOMINIO', () => {
    const esito = cli(['--rilascio-di-adesso'], {
      stdin: JSON.stringify({ deployments: [RILASCIO_X, RILASCIO_W] }),
      env: { COMMIT_CHE_ESCE: Y, RILASCIO_SUL_DOMINIO: JSON.stringify(sulDominio(RILASCIO_W)) },
    });
    expect(esito.uscita).toBe(0);
    expect(esito.stdout.trim()).toBe('https://mycity-w-dei-clienti.vercel.app');
  });

  it('il passo di rilascio chiede a Vercel chi serve il dominio e si segna W', () => {
    const p = passo('Rilascia in produzione');
    if (!p.run) throw new Error('Il passo «Rilascia in produzione» non ha uno script');

    // Un curl finto che risponde come Vercel: il dominio da una parte, l'elenco
    // dall'altra. Quello di _lavoro-di-rilascio risponde uguale a tutto.
    const scena = mkdtempSync(join(tmpdir(), 'rilascio-dominio-'));
    try {
      const cestino = join(scena, 'bin');
      mkdirSync(cestino);
      const registro = join(scena, 'comandi.txt');
      const uscite = join(scena, 'output.txt');
      writeFileSync(registro, '');
      writeFileSync(uscite, '');
      const finto = (nome: string, corpo: string) => {
        const percorso = join(cestino, nome);
        writeFileSync(percorso, `#!/usr/bin/env bash\nprintf '%s\\n' "${nome} $*" >> "$REGISTRO"\n${corpo}`);
        chmodSync(percorso, 0o755);
      };
      finto('npx', `for a in "$@"; do [ "$a" = deploy ] && { printf '%s' "$FINTA_USCITA_DEPLOY"; exit 0; }; done; exit 0`);
      finto('curl', `case "$*" in *"/v13/deployments/"*) printf '%s' "$FINTO_DOMINIO" ;; *) printf '%s' "$FINTO_ELENCO" ;; esac; exit 0`);

      const esito = spawnSync('bash', ['-c', p.run], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          ...SEGRETI_FINTI,
          PATH: `${cestino}:${process.env.PATH}`,
          REGISTRO: registro,
          GITHUB_OUTPUT: uscite,
          GITHUB_STEP_SUMMARY: join(scena, 'riepilogo.md'),
          COMMIT: Y,
          FINTA_USCITA_DEPLOY: USCITA_VERA_DEL_DEPLOY,
          FINTO_ELENCO: JSON.stringify({ deployments: [RILASCIO_X, RILASCIO_W] }),
          FINTO_DOMINIO: JSON.stringify(sulDominio(RILASCIO_W)),
        },
      });
      expect(esito.status, esito.stderr).toBe(0);

      const precedente = readFileSync(uscite, 'utf8').split('\n').find((r) => r.startsWith('precedente='))?.slice('precedente='.length);
      expect(precedente, 'Il posto dove tornare e quello che usano i clienti, non l ultimo costruito').toBe('https://mycity-w-dei-clienti.vercel.app');

      const chiamate = readFileSync(registro, 'utf8').split('\n').filter((c) => c.startsWith('curl '));
      expect(chiamate.some((c) => c.includes('/v13/deployments/mycity-marketplace.com')), `Chiamate viste: ${chiamate.join(' / ')}`).toBe(true);
    } finally {
      rmSync(scena, { recursive: true, force: true });
    }
  });
});
