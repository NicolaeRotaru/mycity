import { readFileSync, mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { percorso, type EsitoFinto, type LavoroYaml, type PassoYaml } from './_condizioni-github';

/**
 * 1/11/2026 — LA PROVA MENSILE DI RIPRISTINO CADEVA SENZA AVVISARE NESSUNO.
 *
 * La copia notturna, quando fallisce, apre una segnalazione nel deposito. La
 * prova mensile che dice «la copia si riapre» no: se il ripristino non
 * riusciva, il lavoro restava rosso in una pagina che il primo del mese non
 * apre nessuno. Qui le condizioni del file si VALUTANO come le valuta GitHub
 * (percorso()), e il passo d'allarme si esegue davvero con un `gh` finto.
 * Cosa non si prova da qui: che GitHub mandi davvero la posta.
 */
const richiedi = createRequire(import.meta.url);
const yaml = richiedi('js-yaml') as { load: (testo: string) => unknown };

type LavoroConPermessi = LavoroYaml & { permissions?: Record<string, string> };

function lavoro(): LavoroConPermessi {
  const documento = yaml.load(
    readFileSync(join(process.cwd(), '.github/workflows/backup-db.yml'), 'utf8'),
  ) as { jobs?: Record<string, LavoroConPermessi> };
  const trovato = documento?.jobs?.['prova-di-ripristino'];
  if (!trovato?.steps?.length) throw new Error('Non trovo il lavoro «prova-di-ripristino» in backup-db.yml');
  return trovato;
}

const PRIMO_DEL_MESE = { event_name: 'schedule', schedule: '41 3 1 * *' };
const FALLITO: EsitoFinto = { esito: 'failure' };
const suonaAllarme = (girati: string[]) => girati.some((n) => /allarme/i.test(n));

function passoAllarme(): PassoYaml {
  const trovato = (lavoro().steps ?? []).find((p) => /allarme/i.test(p.name ?? ''));
  if (!trovato) throw new Error('Nel lavoro «prova-di-ripristino» non c e nessun passo che dia l allarme');
  return trovato;
}

function suona(aperta: string) {
  const scena = mkdtempSync(join(tmpdir(), 'allarme-ripristino-'));
  try {
    const cestino = join(scena, 'bin');
    mkdirSync(cestino);
    const registro = join(scena, 'gh.txt');
    const riepilogo = join(scena, 'riepilogo.md');
    writeFileSync(registro, '');
    writeFileSync(riepilogo, '');
    writeFileSync(join(cestino, 'gh'), `#!/usr/bin/env bash
printf '%s' "$*" | tr '\\n' ' ' >> "$REGISTRO"
printf '\\n' >> "$REGISTRO"
if [ "$1 $2" = "issue list" ]; then printf '%s' "$FINTA_APERTA"; fi
exit 0
`);
    chmodSync(join(cestino, 'gh'), 0o755);
    const passo = passoAllarme();
    const esito = spawnSync('bash', ['-c', String(passo.run ?? '')], {
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
        INDIRIZZO_CORSA: 'https://github.com/NicolaeRotaru/mycity/actions/runs/456',
        TITOLO: String(passo.env?.TITOLO ?? ''),
      },
    });
    return {
      uscita: esito.status,
      titolo: String(passo.env?.TITOLO ?? ''),
      chiamate: readFileSync(registro, 'utf8').split('\n').filter(Boolean),
    };
  } finally {
    rmSync(scena, { recursive: true, force: true });
  }
}

describe('la prova mensile di ripristino fallita suona l allarme', () => {
  it('se la copia non si riapre sul database vuoto, il passo dell allarme gira', () => {
    const girati = percorso(lavoro().steps ?? [], PRIMO_DEL_MESE, {
      'Riaprila su un database vuoto, e cronometra': FALLITO,
    });
    expect(suonaAllarme(girati), 'Una prova di ripristino fallita deve avvisare qualcuno').toBe(true);
  });

  it('anche se cade un passo qualunque prima (segreti, client, copia fresca, foto), l allarme gira', () => {
    for (const passo of [
      'Installa il client Postgres',
      'Verifica di avere i segreti',
      'Fai una copia fresca',
      'Copia le foto accanto al database',
      'Riapri una foto dalla copia',
    ]) {
      const girati = percorso(lavoro().steps ?? [], PRIMO_DEL_MESE, { [passo]: FALLITO });
      expect(suonaAllarme(girati), `cade «${passo}» e nessuno lo sa`).toBe(true);
    }
  });

  it('una prova andata bene non disturba nessuno', () => {
    expect(suonaAllarme(percorso(lavoro().steps ?? [], PRIMO_DEL_MESE, {}))).toBe(false);
  });

  it('il lavoro ha il permesso di aprire la segnalazione, e continua a poter leggere il codice', () => {
    expect(lavoro().permissions?.issues).toBe('write');
    expect(lavoro().permissions?.contents).toBe('read');
  });

  it('senza segnalazioni aperte ne apre una, col suo titolo, che chiama il proprietario', () => {
    const esito = suona('');
    expect(esito.uscita).toBe(0);
    expect(esito.titolo).toMatch(/ripristino/i);
    const apertura = esito.chiamate.find((c) => c.startsWith('issue create'));
    expect(apertura, 'Nessuna segnalazione aperta: il passo non ha avvisato nessuno').toBeDefined();
    expect(apertura).toContain(esito.titolo);
    expect(apertura).toContain('@NicolaeRotaru');
    expect(apertura).toContain('actions/runs/456');
  });

  it('con una segnalazione gia aperta aggiunge un commento invece di aprirne un altra', () => {
    const esito = suona('9');
    expect(esito.uscita).toBe(0);
    expect(esito.chiamate.some((c) => c.startsWith('issue comment 9'))).toBe(true);
    expect(esito.chiamate.some((c) => c.startsWith('issue create'))).toBe(false);
  });
});
