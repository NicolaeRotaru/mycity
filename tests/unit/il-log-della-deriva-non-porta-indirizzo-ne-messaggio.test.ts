import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codiciDaStampare, spiegaIlCollegamentoFallito, spiegaIlRegistroIlleggibile } from '@/scripts/check-migration-drift.mjs';

/**
 * Il controllo della deriva scrive nel log del lavoro solo il tipo di indirizzo e il codice
 * dell'errore. La macchina, l'utente, la porta e il messaggio di Postgres non ci vanno, in nessuno
 * dei quattro punti in cui lo script puo' fermarsi: collegamento, registro delle migrazioni,
 * permessi, errore inatteso.
 *
 * Lo script vero gira con un `pg` finto (aggancio del caricatore di Node: nessuna rete, nessun
 * database) che si guasta nel punto scelto dalla prova, con un messaggio pieno di dettagli.
 */

const RADICE = process.cwd();
const SCRIPT = join(RADICE, 'scripts/check-migration-drift.mjs');

const PROGETTO = 'qwertyuiopasdfghjklz';
const MACCHINA = 'aws-1-eu-central-1.pooler.supabase.com';
const IP = '52.59.152.35';
const URL_POOLER = `postgresql://postgres.${PROGETTO}:Segreto-Lungo-77@${MACCHINA}:5432/postgres`;
const MESSAGGIO = `FATAL: tenant or user not found: postgres.${PROGETTO} at ${MACCHINA} (${IP}:5432)`;

/** Nessun pezzo dell'indirizzo e nessuna parola del messaggio. */
function senzaDettagli(testo: string) {
  for (const pezzo of [PROGETTO, MACCHINA, 'aws-1-eu-central-1', IP, 'Segreto-Lungo-77', 'tenant or user not found', 'FATAL']) {
    expect(testo, `il log contiene «${pezzo}»:\n${testo}`).not.toContain(pezzo);
  }
}

let scena = '';
let registra = '';

beforeAll(() => {
  scena = mkdtempSync(join(tmpdir(), 'deriva-log-'));
  const fintoPg = join(scena, 'finto-pg.mjs');
  writeFileSync(
    fintoPg,
    `import { EventEmitter } from 'node:events';
function guasto(dove) {
  const g = JSON.parse(process.env.FINTO_GUASTO ?? '{}');
  if (g.dove !== dove) return;
  const e = new Error(g.message);
  if (g.code) e.code = g.code;
  throw e;
}
// Come il Client vero di pg, e' un EventEmitter.
class Client extends EventEmitter {
  async connect() { guasto('collegamento'); }
  async query(sql) {
    guasto(String(sql).includes('WITH ruoli') ? 'permessi' : 'registro');
    return { rows: [] };
  }
  async end() { guasto('chiusura'); }
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

function lancia(guasto: { dove: string; code?: string; message: string }, env: Record<string, string> = {}) {
  const esito = spawnSync(process.execPath, ['--import', registra, SCRIPT], {
    cwd: RADICE,
    encoding: 'utf8',
    timeout: 20_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', SUPABASE_DB_URL: URL_POOLER, FINTO_GUASTO: JSON.stringify(guasto), ...env },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

describe('lo script vero non scrive indirizzo ne\' messaggio nel log', () => {
  it('collegamento fallito: tipo di indirizzo e codice, nient\'altro', () => {
    const { uscita, testo } = lancia({ dove: 'collegamento', code: 'XX000', message: MESSAGGIO });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('non riesco a collegarmi al database (pooler di Supabase)');
    expect(testo).toContain("Codice dell'errore: XX000");
    senzaDettagli(testo);
  });

  it('registro delle migrazioni illeggibile: solo il codice', () => {
    const { uscita, testo } = lancia({ dove: 'registro', code: '42501', message: `permission denied for schema supabase_migrations (${MESSAGGIO})` });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('non riesco a leggere il registro delle migrazioni (42501)');
    expect(testo).not.toContain('permission denied');
    senzaDettagli(testo);
  });

  it('permessi illeggibili: solo il codice', () => {
    const file = join(scena, 'permessi.json');
    const { uscita, testo } = lancia({ dove: 'permessi', code: '57014', message: MESSAGGIO }, { PERMESSI_ESPORTA: file });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('non riesco a leggere i permessi (57014)');
    senzaDettagli(testo);
  });

  it('errore inatteso: una riga generica col codice', () => {
    const { uscita, testo } = lancia({ dove: 'chiusura', code: 'ECONNRESET', message: MESSAGGIO });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('errore inatteso (ECONNRESET)');
    senzaDettagli(testo);
  });
});

describe('le spiegazioni, una per una', () => {
  const tutteLeStrade = [
    Object.assign(new Error(MESSAGGIO), { code: 'ECONNREFUSED' }),
    Object.assign(new Error(MESSAGGIO), { code: '28P01' }),
    Object.assign(new Error(MESSAGGIO), { code: 'ENOTFOUND', hostname: MACCHINA }),
    Object.assign(new Error(MESSAGGIO), { code: 'ENETUNREACH', address: '2a05:d012::1' }),
    new Error(MESSAGGIO),
  ];
  const indirizzi = [
    URL_POOLER,
    `postgresql://postgres:Segreto-Lungo-77@db.${PROGETTO}.supabase.co:5432/postgres`,
    `postgresql://app:Segreto-Lungo-77@${IP}:5432/app`,
    `postgresql://postgres:Segreto-Lungo-77@progetto-${PROGETTO}.supabase.com:5432/postgres`,
  ];

  it('nessuna strada del collegamento fallito ripete macchina, utente o messaggio', () => {
    for (const url of indirizzi) {
      for (const errore of tutteLeStrade) senzaDettagli(spiegaIlCollegamentoFallito(errore, url).join('\n'));
    }
  });

  it('il registro illeggibile non ripete il messaggio', () => {
    for (const code of ['42P01', '42501', 'XX000', undefined]) {
      senzaDettagli(spiegaIlRegistroIlleggibile({ code, message: MESSAGGIO }).join('\n'));
    }
  });

  it('un «codice» che non ha la forma di un codice non passa', () => {
    expect(codiciDaStampare(['ECONNREFUSED', '28P01'])).toBe('ECONNREFUSED, 28P01');
    expect(codiciDaStampare([MACCHINA, `postgres.${PROGETTO}`, '', undefined])).toBe('senza codice');
  });
});
