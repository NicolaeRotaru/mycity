import { readFileSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { percorso, type EsitoFinto, type LavoroYaml, type PassoYaml } from './_condizioni-github';

/**
 * 31/10/2026 (ondata 1) — VENTUNO COPIE NOTTURNE FALLITE DI FILA, E NESSUNO
 * LO HA SAPUTO.
 *
 * Dal 19/8 al 7/9 la copia del database e' caduta ogni notte. Il lavoro era
 * rosso, ma nessun passo avvisava nessuno: il rosso restava in una pagina che
 * di notte non apre nessuno. Qui si prova che un fallimento fa partire
 * l'allarme (le condizioni valutate come GitHub) e che l'allarme, eseguito
 * davvero con un `gh` finto, apre una segnalazione oppure aggiorna quella
 * gia' aperta. Cosa non si prova da qui: che GitHub mandi davvero la posta.
 */
const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

type LavoroConPermessi = LavoroYaml & { permissions?: Record<string, string> };

function lavoro(): LavoroConPermessi {
  const documento = yaml.load(
    readFileSync(join(process.cwd(), '.github/workflows/backup-db.yml'), 'utf8'),
  ) as { jobs?: Record<string, LavoroConPermessi> };
  const trovato = documento?.jobs?.backup;
  if (!trovato?.steps?.length) throw new Error('Non trovo il lavoro «backup» in backup-db.yml');
  return trovato;
}

const NOTTE = { event_name: 'schedule', schedule: '17 2 * * *' };
const FALLITO: EsitoFinto = { esito: 'failure' };

function passoAllarme(): PassoYaml {
  const passi = lavoro().steps ?? [];
  const trovato = passi.find((p) => /allarme/i.test(p.name ?? ''));
  if (!trovato) throw new Error('Nel lavoro «backup» non c e nessun passo che dia l allarme');
  return trovato;
}

function suona(aperta: string) {
  const scena = mkdtempSync(join(tmpdir(), 'allarme-copia-'));
  try {
    const cestino = join(scena, 'bin');
    mkdirSync(cestino);
    const registro = join(scena, 'gh.txt');
    const riepilogo = join(scena, 'riepilogo.md');
    writeFileSync(registro, '');
    writeFileSync(riepilogo, '');
    const gh = join(cestino, 'gh');
    writeFileSync(gh, `#!/usr/bin/env bash
# Il corpo della segnalazione va a capo: una chiamata, una riga del registro.
printf '%s' "$*" | tr '\\n' ' ' >> "$REGISTRO"
printf '\\n' >> "$REGISTRO"
if [ "$1 $2" = "issue list" ]; then printf '%s' "$FINTA_APERTA"; fi
exit 0
`);
    chmodSync(gh, 0o755);
    const esito = spawnSync('bash', ['-c', String(passoAllarme().run ?? '')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${cestino}:${process.env.PATH}`,
        REGISTRO: registro,
        GITHUB_STEP_SUMMARY: riepilogo,
        FINTA_APERTA: aperta,
        GH_TOKEN: 'finto',
        DEPOSITO: 'NicolaeRotaru/mycity',
        PROPRIETARIO: 'NicolaeRotaru',
        INDIRIZZO_CORSA: 'https://github.com/NicolaeRotaru/mycity/actions/runs/123',
        TITOLO: "La copia notturna del database non e' riuscita",
      },
    });
    return {
      uscita: esito.status,
      chiamate: readFileSync(registro, 'utf8').split('\n').filter(Boolean),
      riepilogo: readFileSync(riepilogo, 'utf8'),
    };
  } finally {
    rmSync(scena, { recursive: true, force: true });
  }
}

describe('la copia notturna fallita suona l allarme', () => {
  it('se la copia cade, il passo dell allarme gira', () => {
    const girati = percorso(lavoro().steps ?? [], NOTTE, { 'Esegui il backup': FALLITO });
    expect(girati.some((n) => /allarme/i.test(n)), 'Una copia fallita deve far partire un avviso, non restare un rosso che nessuno vede').toBe(true);
  });

  it('se anche solo l installazione del client cade, l allarme gira lo stesso', () => {
    const girati = percorso(lavoro().steps ?? [], NOTTE, { 'Installa il client Postgres': FALLITO });
    expect(girati.some((n) => /allarme/i.test(n))).toBe(true);
  });

  it('una notte andata bene non disturba nessuno', () => {
    const girati = percorso(lavoro().steps ?? [], NOTTE, {});
    expect(girati.some((n) => /allarme/i.test(n))).toBe(false);
  });

  it('il lavoro ha il permesso di aprire la segnalazione, e continua a poter leggere il codice', () => {
    expect(lavoro().permissions?.issues).toBe('write');
    expect(lavoro().permissions?.contents).toBe('read');
  });

  it('senza segnalazioni aperte ne apre una che chiama il proprietario', () => {
    const esito = suona('');
    expect(esito.uscita).toBe(0);
    const apertura = esito.chiamate.find((c) => c.startsWith('issue create'));
    expect(apertura, 'Nessuna segnalazione aperta: il passo non ha avvisato nessuno').toBeDefined();
    expect(apertura).toContain("La copia notturna del database non e' riuscita");
    expect(apertura).toContain('@NicolaeRotaru');
    expect(apertura).toContain('actions/runs/123');
  });

  it('con una segnalazione gia aperta aggiunge un commento invece di aprirne un altra', () => {
    const esito = suona('7');
    expect(esito.uscita).toBe(0);
    expect(esito.chiamate.some((c) => c.startsWith('issue comment 7'))).toBe(true);
    expect(esito.chiamate.some((c) => c.startsWith('issue create'))).toBe(false);
  });
});
