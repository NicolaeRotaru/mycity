/**
 * 15/10/2026 — IL RILASCIO AUTOMATICO AVREBBE APPLICATO 48 MIGRAZIONI DA SOLO.
 *
 * La produzione e' indietro di 48 migrazioni, l'ultima e' la 161. Il lavoro
 * «Rilascio dopo CI verde» applica le migrazioni mancanti PRIMA di pubblicare,
 * con scripts/applica-migrazioni-mancanti.sh. Oggi non gira perche' mancano i
 * segreti; il giorno in cui Nicola li mette, la prima unione su main — anche
 * il «cambio innocuo» suggerito per provare il rilascio — le avrebbe applicate
 * tutte, senza nessuno davanti.
 *
 * E la 161 toglie ai clienti la lettura dei negozi dalla tabella `profiles`,
 * proprio quella da cui il codice pubblicato oggi legge il negozio nella scheda
 * prodotto: applicata prima del codice nuovo, ogni scheda direbbe «Prodotto non
 * disponibile». Il riallineamento grande va fatto a mano, con la procedura.
 *
 * Queste prove ESEGUONO lo script vero e il passo vero del rilascio, con un
 * `psql` finto che fa la parte del registro delle migrazioni e annota cosa gli
 * viene chiesto di applicare. Pretendono:
 *   ① oltre il tetto, lo script si ferma PRIMA di applicare qualsiasi cosa;
 *   ② sotto il tetto (un rilascio normale) applica come prima;
 *   ③ senza tetto (la CI, la procedura a mano) non cambia niente;
 *   ④ il passo del rilascio porta davvero il tetto, e se si ferma lo dice nel
 *     riepilogo;
 *   ⑤ se il database non si raggiunge, lo script dice di usare il Session pooler.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { passo, esegui } from './_lavoro-di-rilascio';

const RADICE = process.cwd();

/** I file di migrazione nell'ordine in cui li applica lo script (sort -V). */
function migrazioni(): string[] {
  const nomi = readdirSync(join(RADICE, 'migrations')).filter((f) => /^\d{3}[a-z]?_.+\.sql$/.test(f));
  const ordinati = spawnSync('sort', ['-V'], { input: nomi.join('\n'), encoding: 'utf8' }).stdout.trim().split('\n');
  if (ordinati.length < 100) throw new Error(`Ho letto solo ${ordinati.length} migrazioni: qualcosa non va`);
  return ordinati;
}

/** Le versioni (il numero davanti) delle ultime `quante` migrazioni. */
function ultime(quante: number): string[] {
  return migrazioni()
    .slice(-quante)
    .map((f) => f.slice(0, f.indexOf('_')));
}

/**
 * Un `psql` finto: risponde come il registro delle migrazioni (conosce tutte le
 * versioni tranne quelle in FINTE_MANCANTI), e annota in REGISTRO_PSQL ogni file
 * che gli si chiede di applicare. Non apre nessuna connessione.
 */
function preparaFinti(): { cartella: string; registro: string } {
  const cartella = mkdtempSync(join(tmpdir(), 'psql-finto-'));
  const registro = join(cartella, 'registro.txt');
  writeFileSync(registro, '');
  writeFileSync(
    join(cartella, 'psql'),
    `#!/usr/bin/env bash
query=""; file=""
while [ $# -gt 0 ]; do
  case "$1" in
    -c) query="$2"; shift 2 ;;
    -f) file="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "\${FINTO_PSQL_IRRAGGIUNGIBILE:-}" = "1" ]; then
  echo 'psql: error: connection to server at "db.x.supabase.co" (2a05:d012::1), port 5432 failed: Network is unreachable' >&2
  exit 2
fi
if [ -n "$file" ]; then echo "APPLICATO $(basename "$file")" >> "$REGISTRO_PSQL"; exit 0; fi
if [ -z "$query" ]; then cat > /dev/null; exit 0; fi
case "$query" in
  *"count(*)"*) echo 156 ;;
  *INSERT*) echo "REGISTRATO" >> "$REGISTRO_PSQL" ;;
  *"SELECT 1 FROM supabase_migrations.schema_migrations"*)
    v="$(printf '%s' "$query" | sed -nE "s/.*version = '([^']+)'.*/\\1/p" | head -1)"
    case " \${FINTE_MANCANTI:-} " in
      *" $v "*) ;;
      *) echo 1 ;;
    esac
    ;;
esac
exit 0
`,
  );
  chmodSync(join(cartella, 'psql'), 0o755);
  // Il passo del rilascio installa il client con apt: qui non si installa niente.
  writeFileSync(join(cartella, 'sudo'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(cartella, 'sudo'), 0o755);
  return { cartella, registro };
}

function applicate(registro: string): string[] {
  return readFileSync(registro, 'utf8')
    .split('\n')
    .filter((r) => r.startsWith('APPLICATO '))
    .map((r) => r.slice('APPLICATO '.length));
}

function lanciaLoScript(mancanti: string[], env: Record<string, string> = {}) {
  const { cartella, registro } = preparaFinti();
  const esito = spawnSync('bash', ['scripts/applica-migrazioni-mancanti.sh'], {
    cwd: RADICE,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${cartella}:${process.env.PATH}`,
      SUPABASE_DB_URL: 'postgresql://finto@localhost/finto',
      REGISTRO_PSQL: registro,
      FINTE_MANCANTI: mancanti.join(' '),
      ...env,
    },
  });
  return {
    uscita: esito.status ?? -1,
    stdout: esito.stdout ?? '',
    stderr: esito.stderr ?? '',
    applicate: applicate(registro),
    registrate: readFileSync(registro, 'utf8').split('\n').filter((r) => r === 'REGISTRATO').length,
  };
}

// Ogni prova lancia lo script vero, che chiama `psql` (finto) un paio di centinaia
// di volte: sotto il carico dell'intera suite i cinque secondi di default non
// bastano, e una prova scaduta per lentezza non dice niente sul tetto.
const LENTA = { timeout: 30_000 };

describe('lo script delle migrazioni, con il tetto del rilascio automatico', LENTA, () => {
  it('con 48 migrazioni mancanti (la produzione di oggi) si ferma PRIMA di applicarne una', () => {
    const r = lanciaLoScript(ultime(48), { MASSIMO_MIGRAZIONI: '20' });
    expect(r.uscita, r.stderr).toBe(4);
    expect(r.applicate).toEqual([]);
    expect(r.registrate).toBe(0);
    expect(r.stderr).toContain('mancano 48 migrazioni');
    expect(r.stderr).toContain('docs/migrazioni-baseline-produzione.md');
    expect(r.stderr).toContain(migrazioni().at(-1));
  });

  it('il confine: 20 mancanti con tetto 20 si applicano, 21 no', () => {
    const venti = lanciaLoScript(ultime(20), { MASSIMO_MIGRAZIONI: '20' });
    expect(venti.uscita, venti.stderr).toBe(0);
    expect(venti.applicate).toHaveLength(20);
    expect(venti.stdout).toContain('▶ applicate 20 ');

    const ventuno = lanciaLoScript(ultime(21), { MASSIMO_MIGRAZIONI: '20' });
    expect(ventuno.uscita).toBe(4);
    expect(ventuno.applicate).toEqual([]);
  });

  it('un rilascio normale (poche migrazioni nuove) applica e registra come prima, in ordine', () => {
    const tre = ultime(3);
    const r = lanciaLoScript(tre, { MASSIMO_MIGRAZIONI: '20' });
    expect(r.uscita, r.stderr).toBe(0);
    expect(r.applicate).toEqual(migrazioni().slice(-3));
    expect(r.registrate).toBe(3);
  });

  it('senza tetto (la CI che ricostruisce, la procedura a mano) applica tutto come prima', () => {
    const r = lanciaLoScript(ultime(48));
    expect(r.uscita, r.stderr).toBe(0);
    expect(r.applicate).toEqual(migrazioni().slice(-48));
  });

  it('niente da applicare: esce verde e lo dice', () => {
    const r = lanciaLoScript([], { MASSIMO_MIGRAZIONI: '20' });
    expect(r.uscita, r.stderr).toBe(0);
    expect(r.stdout).toContain('▶ applicate 0 ');
  });

  it('un tetto scritto male non si ignora: si ferma senza toccare niente', () => {
    const r = lanciaLoScript(ultime(3), { MASSIMO_MIGRAZIONI: 'venti' });
    expect(r.uscita).not.toBe(0);
    expect(r.applicate).toEqual([]);
  });

  it('se il database non si raggiunge, dice di usare la riga del Session pooler', () => {
    const r = lanciaLoScript(ultime(3), { FINTO_PSQL_IRRAGGIUNGIBILE: '1' });
    expect(r.uscita).not.toBe(0);
    expect(r.applicate).toEqual([]);
    expect(r.stderr).toContain('«Session pooler»');
    expect(r.stderr).toContain('IPv6');
  });
});

describe('il passo vero del rilascio dopo la CI', LENTA, () => {
  const NOME = 'Applica le migrazioni al database, prima di pubblicare';

  /** Esegue il passo con le sue variabili scritte nel file, piu' i finti. */
  function eseguiIlPasso(mancanti: string[]) {
    const p = passo(NOME);
    const { cartella, registro } = preparaFinti();
    const daFile: Record<string, string> = {};
    for (const [chiave, valore] of Object.entries(p.ambiente)) {
      if (!valore.includes('${{')) daFile[chiave] = valore.replace(/^"(.*)"$/, '$1');
    }
    const r = esegui(p, {
      env: {
        ...daFile,
        PATH: `${cartella}:${process.env.PATH}`,
        SUPABASE_DB_URL: 'postgresql://finto@localhost/finto',
        REGISTRO_PSQL: registro,
        FINTE_MANCANTI: mancanti.join(' '),
      },
    });
    return { ...r, applicate: applicate(registro) };
  }

  it('con il database indietro di 48 non applica niente, esce rosso e spiega cosa fare', () => {
    const r = eseguiIlPasso(ultime(48));
    expect(r.uscita, r.stdout + r.stderr).not.toBe(0);
    expect(r.applicate).toEqual([]);
    expect(r.riepilogo).toContain('troppo indietro');
    expect(r.riepilogo).toContain('docs/migrazioni-baseline-produzione.md');
  });

  it('con le poche migrazioni di un rilascio normale applica, esce verde e le conta', () => {
    const r = eseguiIlPasso(ultime(3));
    expect(r.uscita, r.stdout + r.stderr).toBe(0);
    expect(r.applicate).toEqual(migrazioni().slice(-3));
    expect(r.output.quante).toBe('3');
  });
});
