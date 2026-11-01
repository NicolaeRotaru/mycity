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

  // 1/11/2026 (ondata 9) — QUESTA PROVA PRETENDEVA IL DIFETTO. Diceva «se Y e'
  // gia' sul dominio si torna all'ultimo rilascio di un altro commit», e
  // voleva proprio mycity-x-rotto: il rilascio gia' tolto perche' rotto, cioe'
  // la scena che il resto del file esiste per impedire. Prima di Y i clienti
  // usavano W, ma il dominio ormai dice Y e l'elenco [Y, X, W] non distingue
  // X vivo da X tolto: la risposta giusta e' nessun indirizzo, e il ritorno si
  // fa a mano.
  it('se Vercel ha gia messo Y sul dominio da solo, fra X scartato e W non tira a indovinare', () => {
    expect(
      rilascioDaTornare({ deployments: [RILASCIO_Y, RILASCIO_X, RILASCIO_W] }, { commitCheEsce: Y, sulDominio: sulDominio(RILASCIO_Y) }),
      'X era gia stato tolto perche rotto: tornarci vuol dire rimettere online il codice rotto',
    ).toBeNull();
  });

  it('X scartato, W dei clienti, Y sul dominio che esce: mai X, in nessun ordine dell elenco', () => {
    const elenchi = [
      [RILASCIO_X, RILASCIO_W],
      [RILASCIO_Y, RILASCIO_X, RILASCIO_W],
      [RILASCIO_X, RILASCIO_Y, RILASCIO_W],
      [RILASCIO_Y, RILASCIO_Y, RILASCIO_X, RILASCIO_W],
    ];
    for (const deployments of elenchi) {
      const scelto = rilascioDaTornare({ deployments }, { commitCheEsce: Y, sulDominio: sulDominio(RILASCIO_Y) });
      expect(scelto, `elenco ${deployments.map((d) => d.uid).join(', ')}`).not.toBe('https://mycity-x-rotto.vercel.app');
      expect(scelto).toBeNull();
    }
  });

  // 1/11/2026 (ondata 9, collaudo) — «Un solo altro commit» non basta: l'elenco
  // legge 20 rilasci, e dopo qualche rilancio di X rotto W ne esce. Allora
  // l'unico altro commit e' X. Nel caso ambiguo: sempre null.
  it('Y sul dominio o dominio sconosciuto, W uscito dai 20 letti: mai X, sempre nessun indirizzo', () => {
    const X2 = rilascio(X, 'x-rilanciato');
    const xSenzaSha = { ...rilascio(X, 'x-senza-sha'), meta: {} };
    const elenchi = [[RILASCIO_Y, RILASCIO_X], [RILASCIO_Y, RILASCIO_X, X2], [RILASCIO_Y, xSenzaSha], [RILASCIO_X], [RILASCIO_Y, RILASCIO_W]];
    for (const deployments of elenchi) {
      for (const dominio of [sulDominio(RILASCIO_Y), null]) {
        const scelto = rilascioDaTornare({ deployments }, { commitCheEsce: Y, sulDominio: dominio });
        expect(scelto, `elenco ${deployments.map((d) => d.uid).join(', ')} · dominio ${dominio ? 'Y' : 'sconosciuto'}`).toBeNull();
      }
    }
  });

  it('il dominio risponde senza commit: nessun indirizzo, perche puo essere proprio Y appena rotto', () => {
    const ySenzaSha = { ...sulDominio(RILASCIO_Y), meta: {} };
    expect(rilascioDaTornare({ deployments: [RILASCIO_X, RILASCIO_W] }, { commitCheEsce: Y, sulDominio: ySenzaSha })).toBeNull();
  });

  it('senza sapere quale commit esce, nemmeno il dominio basta', () => {
    expect(rilascioDaTornare({ deployments: [RILASCIO_W] }, { sulDominio: sulDominio(RILASCIO_W) })).toBeNull();
  });

  it('il dominio non pronto o non di produzione non e un posto dove tornare', () => {
    expect(rilascioDaTornare({ deployments: [] }, { commitCheEsce: Y, sulDominio: { ...sulDominio(RILASCIO_W), readyState: 'ERROR' } })).toBeNull();
    expect(rilascioDaTornare({ deployments: [] }, { commitCheEsce: Y, sulDominio: { ...sulDominio(RILASCIO_W), target: 'preview' } })).toBeNull();
  });

  it('Y sul dominio e nessun altro commit: nessun indirizzo', () => {
    expect(rilascioDaTornare({ deployments: [RILASCIO_Y] }, { commitCheEsce: Y, sulDominio: sulDominio(RILASCIO_Y) })).toBeNull();
  });

  it('da riga di comando legge il dominio dalla variabile RILASCIO_SUL_DOMINIO', () => {
    const esito = cli(['--rilascio-di-adesso'], {
      stdin: JSON.stringify({ deployments: [RILASCIO_X, RILASCIO_W] }),
      env: { COMMIT_CHE_ESCE: Y, RILASCIO_SUL_DOMINIO: JSON.stringify(sulDominio(RILASCIO_W)) },
    });
    expect(esito.uscita).toBe(0);
    expect(esito.stdout.trim()).toBe('https://mycity-w-dei-clienti.vercel.app');
  });

  it('da riga di comando, con Y gia sul dominio e X scartato nell elenco, non stampa nessun indirizzo', () => {
    const esito = cli(['--rilascio-di-adesso'], {
      stdin: JSON.stringify({ deployments: [RILASCIO_Y, RILASCIO_X, RILASCIO_W] }),
      env: { COMMIT_CHE_ESCE: Y, RILASCIO_SUL_DOMINIO: JSON.stringify(sulDominio(RILASCIO_Y)) },
    });
    expect(esito.stdout).not.toContain('mycity-x-rotto');
    expect(esito.stdout.trim()).toBe('');
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
