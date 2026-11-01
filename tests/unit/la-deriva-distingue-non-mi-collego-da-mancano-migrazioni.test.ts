import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

// Come in _condizioni-github.ts: js-yaml c'e' (dipendenza di altri pacchetti)
// ma senza i suoi tipi.
const yaml = createRequire(import.meta.url)('js-yaml') as { load: (testo: string) => unknown };

/**
 * 1/11/2026 (ondata 9) — «NON MI COLLEGO» E «MANCANO MIGRAZIONI» ERANO LO
 * STESSO ROSSO.
 *
 * Il controllo notturno della deriva e' finito rosso 52 mattine su 52 perche'
 * la rete non arrivava al database (IPv6), e il 31/10, riparato il segreto, e'
 * finito rosso perche' mancavano 4 migrazioni in produzione. Due guasti
 * opposti — nel primo il confronto non e' nemmeno partito — con lo stesso
 * numero d'uscita (1) e lo stesso colore: chi guarda il lavoro non li separa.
 *
 * Qui lo script VERO gira con un `pg` finto al posto di quello vero (un
 * aggancio del caricatore di Node: nessuna rete, nessun database), e si
 * guardano il numero d'uscita e il testo nelle tre scene: rete che non
 * arriva, migrazioni mancanti, tutto allineato. Poi il passo vero del lavoro
 * notturno gira con un `npm` finto, per vedere che il numero diventa la riga
 * giusta in cima al lavoro.
 */

const RADICE = process.cwd();
const SCRIPT = join(RADICE, 'scripts/check-migration-drift.mjs');
const NOME_RE = /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/;

/** Le righe che il registro di Supabase avrebbe se tutte le migrazioni del repo fossero applicate. */
const tutteApplicate = readdirSync(join(RADICE, 'migrations'))
  .map((f) => f.match(NOME_RE))
  .filter((m): m is RegExpMatchArray => Boolean(m))
  .map((m) => ({ version: m[1], name: m[2], file: `${m[1]}_${m[2]}.sql` }));

let scena = '';
let registra = '';

beforeAll(() => {
  scena = mkdtempSync(join(tmpdir(), 'deriva-finta-'));
  const fintoPg = join(scena, 'finto-pg.mjs');
  // Il `pg` finto: o rifiuta il collegamento con l'errore scelto dalla prova,
  // o risponde alla SELECT con le righe scelte dalla prova.
  writeFileSync(
    fintoPg,
    `class Client {
  async connect() {
    const finto = process.env.FINTO_ERRORE_DI_RETE;
    if (finto) {
      const { code, address, message } = JSON.parse(finto);
      const e = new Error(message);
      e.code = code;
      if (address) e.address = address;
      throw e;
    }
  }
  async query() { return { rows: JSON.parse(process.env.FINTE_RIGHE ?? '[]') }; }
  async end() {}
}
export default { Client };
`,
  );
  const aggancio = join(scena, 'aggancio.mjs');
  writeFileSync(
    aggancio,
    `export async function resolve(specifier, context, next) {
  if (specifier === 'pg') return { url: ${JSON.stringify(pathToFileURL(fintoPg).href)}, shortCircuit: true };
  return next(specifier, context);
}
`,
  );
  registra = join(scena, 'registra.mjs');
  writeFileSync(registra, `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(aggancio).href)});\n`);
});

afterAll(() => {
  if (scena) rmSync(scena, { recursive: true, force: true });
});

function lancia(env: Record<string, string>) {
  const esito = spawnSync(process.execPath, ['--import', registra, SCRIPT], {
    cwd: RADICE,
    encoding: 'utf8',
    timeout: 20_000,
    // Ambiente pulito: un SUPABASE_DB_URL vero nella shell non deve arrivare qui.
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', ...env },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

const DIRETTA = 'postgresql://postgres:Segreto-Lungo-9@db.abcdefghijkl.supabase.co:5432/postgres';
const POOLER = 'postgresql://postgres.abcdefghijkl:Segreto-Lungo-9@aws-0-eu-west-3.pooler.supabase.com:5432/postgres';

describe('il controllo della deriva separa i tre esiti', () => {
  it('la rete che non arriva (ENETUNREACH, IPv6) esce 1 e indica il Session pooler, senza parlare di migrazioni mancanti', () => {
    const { uscita, testo } = lancia({
      SUPABASE_DB_URL: DIRETTA,
      FINTO_ERRORE_DI_RETE: JSON.stringify({ code: 'ENETUNREACH', address: '2a05:d012::1', message: 'connect ENETUNREACH 2a05:d012::1:5432' }),
    });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('non riesco a collegarmi al database');
    expect(testo).toContain('Session pooler');
    expect(testo).not.toContain('NON applicate');
    expect(testo).not.toContain('Segreto-Lungo-9');
  });

  it('il collegamento rifiutato (ECONNREFUSED) su Supabase esce 1, come «non ho controllato»', () => {
    const { uscita, testo } = lancia({
      SUPABASE_DB_URL: POOLER,
      FINTO_ERRORE_DI_RETE: JSON.stringify({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 52.1.2.3:5432' }),
    });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('non riesco a collegarmi al database');
    expect(testo).not.toContain('NON applicate');
  });

  it('con due migrazioni mai applicate esce con un numero DIVERSO da «non mi collego», e le elenca', () => {
    const mancanti = tutteApplicate.slice(-2);
    const righe = tutteApplicate.slice(0, -2).map(({ version, name }) => ({ version, name }));
    const { uscita, testo } = lancia({ SUPABASE_DB_URL: POOLER, FINTE_RIGHE: JSON.stringify(righe) });
    expect(uscita, testo).toBe(2);
    expect(testo).toContain('2 migration NON applicate');
    for (const m of mancanti) expect(testo).toContain(`- ${m.file}`);
    expect(testo).not.toContain('non riesco a collegarmi');
  });

  it('con tutto applicato esce 0', () => {
    const righe = tutteApplicate.map(({ version, name }) => ({ version, name }));
    const { uscita, testo } = lancia({ SUPABASE_DB_URL: POOLER, FINTE_RIGHE: JSON.stringify(righe) });
    expect(uscita, testo).toBe(0);
    expect(testo).toContain(`tutte le ${tutteApplicate.length} migrazioni risultano applicate`);
  });
});

describe('il lavoro notturno traduce il numero in una riga che si legge', () => {
  const lavoro = yaml.load(readFileSync(join(RADICE, '.github/workflows/deriva-migrazioni-produzione.yml'), 'utf8')) as {
    jobs: { deriva: { steps: Array<{ name?: string; run?: string }> } };
  };
  const passo = lavoro.jobs.deriva.steps.find((s) => s.name === 'Confronta il repository con il database vero');

  function giraIlPasso(codice: number) {
    if (!passo?.run) throw new Error('Il passo «Confronta il repository con il database vero» non ha uno script');
    const cestino = mkdtempSync(join(tmpdir(), 'deriva-npm-finto-'));
    try {
      const npm = join(cestino, 'npm');
      writeFileSync(npm, `#!/usr/bin/env bash\nexit ${codice}\n`);
      chmodSync(npm, 0o755);
      mkdirSync(join(cestino, 'vuota'));
      const esito = spawnSync('bash', ['-e', '-c', passo.run], {
        cwd: join(cestino, 'vuota'),
        encoding: 'utf8',
        env: { NODE_ENV: 'test', PATH: `${cestino}:${process.env.PATH}` },
      });
      return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
    } finally {
      rmSync(cestino, { recursive: true, force: true });
    }
  }

  it('2 → «mancano migrazioni», e il lavoro resta rosso', () => {
    const { uscita, testo } = giraIlPasso(2);
    expect(uscita).toBe(2);
    expect(testo).toContain('::error::Mancano migrazioni');
    expect(testo).not.toContain('Session pooler');
  });

  it('1 → «il confronto non e partito», con la strada del Session pooler, e il lavoro resta rosso', () => {
    const { uscita, testo } = giraIlPasso(1);
    expect(uscita).toBe(1);
    expect(testo).toContain("::error::Il confronto NON e' partito");
    expect(testo).toContain('Session pooler');
    expect(testo).not.toContain('Mancano migrazioni');
  });

  it('0 → nessun errore', () => {
    const { uscita, testo } = giraIlPasso(0);
    expect(uscita).toBe(0);
    expect(testo).not.toContain('::error::');
  });
});
