import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { codiceOEtichetta, codiciDaStampare, spiegaIlCollegamentoFallito } from '@/scripts/check-migration-drift.mjs';

/**
 * I due script delle migrazioni (il controllo della deriva e l'applicazione delle mancanti) scrivono
 * nel log del lavoro, quando il collegamento al database fallisce o cade, solo il tipo di indirizzo
 * e un codice. La macchina, la porta, l'utente, il codice del progetto e il testo dell'errore non ci
 * vanno.
 *
 * - Il controllo della deriva gira vero con un `pg` finto (aggancio del caricatore di Node: nessuna
 *   rete). Il suo Client e' un EventEmitter, come quello vero, e manda l'evento 'error' mentre una
 *   domanda aspetta, dopo che una domanda e' fallita, o mentre il client si chiude.
 * - Lo script delle migrazioni gira vero con un `psql` finto in testa al PATH, che fallisce nel punto
 *   scelto dalla prova col testo che darebbe psql, macchina e indirizzo compresi.
 */

const RADICE = process.cwd();
const DERIVA = join(RADICE, 'scripts/check-migration-drift.mjs');
const MIGRAZIONI = join(RADICE, 'scripts/applica-migrazioni-mancanti.sh');

const PROGETTO = 'qwertyuiopasdfghjklz';
const MACCHINA = 'aws-1-eu-central-1.pooler.supabase.com';
const IP = '52.59.152.35';
const PORTA = '6543';
const PASSWORD = 'Segreto-Lungo-77';
const URL_POOLER = `postgresql://postgres.${PROGETTO}:${PASSWORD}@${MACCHINA}:${PORTA}/postgres`;
const URL_DIRETTA = `postgresql://postgres:${PASSWORD}@db.${PROGETTO}.supabase.co:5432/postgres`;
const MESSAGGIO_PG = `FATAL: terminating connection due to administrator command (postgres.${PROGETTO} @ ${MACCHINA} ${IP}:${PORTA})`;

/** Nessun pezzo dell'indirizzo e nessuna parola del testo dell'errore. */
function senzaDettagli(testo: string, ancheParole: string[] = []) {
  for (const pezzo of [PROGETTO, MACCHINA, 'aws-1-eu-central-1', IP, PASSWORD, `:${PORTA}`, `port ${PORTA}`, 'FATAL', ...ancheParole]) {
    expect(testo, `il log contiene «${pezzo}»:\n${testo}`).not.toContain(pezzo);
  }
}

/** Le righe d'esito di guasto del controllo della deriva. */
function esitiDiGuasto(testo: string) {
  return testo.split('\n').filter((r) => r.startsWith('❌ check-migration-drift'));
}

const cartelle: string[] = [];
afterAll(() => {
  for (const c of cartelle) rmSync(c, { recursive: true, force: true });
});
function cartellaNuova(nome: string) {
  const c = mkdtempSync(join(tmpdir(), `${nome}-`));
  cartelle.push(c);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Il controllo della deriva
// ---------------------------------------------------------------------------------------------

let registra = '';

beforeAll(() => {
  const scena = cartellaNuova('deriva-evento');
  const fintoPg = join(scena, 'finto-pg.mjs');
  writeFileSync(
    fintoPg,
    `import { EventEmitter } from 'node:events';
const scena = JSON.parse(process.env.FINTA_SCENA ?? '{}');
function errore() {
  const e = new Error(scena.message);
  if (scena.code) e.code = scena.code;
  return e;
}
class Client extends EventEmitter {
  async connect() {
    if (scena.dove === 'collegamento') throw errore();
  }
  query() {
    if (scena.dove === 'durante-la-domanda') {
      // Come pg: prima l'evento 'error' sul client, poi la domanda in sospeso rifiutata al giro dopo.
      return new Promise((_, rifiuta) => {
        setTimeout(() => {
          const e = errore();
          this.emit('error', e);
          process.nextTick(() => rifiuta(e));
        }, 5);
      });
    }
    if (scena.dove === 'registro' || scena.dove === 'domanda-poi-evento') return Promise.reject(errore());
    return Promise.resolve({ rows: [] });
  }
  end() {
    if (scena.dove === 'domanda-poi-evento' || scena.dove === 'durante-la-chiusura') {
      // Il server chiude la sessione mentre il client esce: l'evento 'error' arriva dalla rete.
      return new Promise((risolvi) => {
        setTimeout(() => {
          this.emit('error', errore());
          risolvi();
        }, 5);
      });
    }
    return Promise.resolve();
  }
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

function lanciaLaDeriva(scena: { dove: string; code?: string; message: string }, url = URL_POOLER) {
  const esito = spawnSync(process.execPath, ['--import', registra, DERIVA], {
    cwd: RADICE,
    encoding: 'utf8',
    timeout: 20_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', SUPABASE_DB_URL: url, FINTA_SCENA: JSON.stringify(scena) },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

describe("il controllo della deriva, quando il client manda l'evento 'error'", () => {
  it('mentre una domanda aspetta: una riga generica, uscita 1, niente indirizzo ne\' testo', () => {
    const { uscita, testo } = lanciaLaDeriva({ dove: 'durante-la-domanda', code: '57P01', message: MESSAGGIO_PG });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain("il collegamento al database si e' interrotto (pooler di Supabase). Codice dell'errore: 57P01");
    expect(esitiDiGuasto(testo), testo).toHaveLength(1);
    senzaDettagli(testo, ['terminating connection', 'administrator command']);
  });

  it('dopo che la domanda e\' gia\' fallita per lo stesso guasto: un esito solo, e l\'uscita resta 1', () => {
    const { uscita, testo } = lanciaLaDeriva({ dove: 'domanda-poi-evento', code: '57P01', message: MESSAGGIO_PG });
    expect(uscita, testo).toBe(1);
    expect(esitiDiGuasto(testo), testo).toEqual([
      '❌ check-migration-drift: collegato al database, ma non riesco a leggere il registro delle migrazioni (57P01).',
    ]);
    senzaDettagli(testo, ['terminating connection', 'administrator command']);
  });

  it('mentre il client si chiude, senza codice: la riga generica con l\'etichetta, uscita 1 e non 2', () => {
    // Le domande rispondono «nessuna migrazione applicata» (sarebbe deriva, uscita 2): il guasto in
    // chiusura arriva prima del confronto, e il confronto non parte.
    const { uscita, testo } = lanciaLaDeriva({ dove: 'durante-la-chiusura', message: `Connection terminated unexpectedly (${MACCHINA} ${IP})` });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain("il collegamento al database si e' interrotto (pooler di Supabase). Codice dell'errore: CONNESSIONE_CHIUSA");
    expect(esitiDiGuasto(testo), testo).toHaveLength(1);
    expect(testo).not.toContain('NON applicate');
    senzaDettagli(testo, ['Connection terminated']);
  });
});

describe('il controllo della deriva, errori senza codice stampabile: un\'etichetta al posto del codice', () => {
  it('un errore di certificato, con o senza codice di Node, diventa TLS', () => {
    for (const scena of [
      { dove: 'collegamento', message: `self-signed certificate in certificate chain (${MACCHINA})` },
      { dove: 'collegamento', code: 'DEPTH_ZERO_SELF_SIGNED_CERT', message: `self-signed certificate (${IP})` },
      { dove: 'collegamento', code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: `Hostname/IP does not match certificate's altnames: Host: ${MACCHINA}` },
    ]) {
      const { uscita, testo } = lanciaLaDeriva(scena);
      expect(uscita, testo).toBe(1);
      expect(testo).toContain("Codice dell'errore: TLS");
      senzaDettagli(testo, ['self-signed', 'altnames']);
    }
  });

  it('il tempo scaduto diventa TIMEOUT, il collegamento chiuso CONNESSIONE_CHIUSA', () => {
    const scaduto = lanciaLaDeriva({ dove: 'collegamento', message: `timeout expired (${MACCHINA})` });
    expect(scaduto.uscita, scaduto.testo).toBe(1);
    expect(scaduto.testo).toContain("Codice dell'errore: TIMEOUT");
    senzaDettagli(scaduto.testo, ['timeout expired']);

    const chiuso = lanciaLaDeriva({ dove: 'registro', message: `Connection terminated unexpectedly (${MACCHINA})` });
    expect(chiuso.uscita, chiuso.testo).toBe(1);
    expect(chiuso.testo).toContain('non riesco a leggere il registro delle migrazioni (CONNESSIONE_CHIUSA)');
    senzaDettagli(chiuso.testo, ['Connection terminated']);
  });

  it('un codice stampabile resta quello, e cio\' che non si riconosce resta «senza codice»', () => {
    expect(codiceOEtichetta(Object.assign(new Error('timeout expired'), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
    expect(codiceOEtichetta(Object.assign(new Error('statement timeout'), { code: '57014' }))).toBe('57014');
    expect(codiceOEtichetta(new Error('The server does not support SSL connections'))).toBe('TLS');
    expect(codiceOEtichetta({ code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' })).toBe('TLS');
    expect(codiciDaStampare([codiceOEtichetta(new Error(`boh ${MACCHINA}`))])).toBe('senza codice');
    expect(codiciDaStampare(['TLS', 'TIMEOUT', 'CONNESSIONE_CHIUSA'])).toBe('TLS, TIMEOUT, CONNESSIONE_CHIUSA');
  });

  it('il consiglio per il pooler dice cosa controllare senza rimandare al testo dell\'errore', () => {
    const t = spiegaIlCollegamentoFallito(new Error(MESSAGGIO_PG), URL_POOLER).join('\n');
    expect(t).toContain('postgres.<progetto>');
    expect(t).not.toMatch(/se l'errore/i);
    senzaDettagli(t);
  });
});

// ---------------------------------------------------------------------------------------------
// Lo script che applica le migrazioni
// ---------------------------------------------------------------------------------------------

/**
 * Un `psql` finto. Il primo contatto (lo schema del registro, da standard input), il conto del
 * registro e l'applicazione di un file possono fallire col testo e l'uscita scelti dalla prova;
 * altrimenti risponde come il registro: conosce tutte le versioni tranne quelle in FINTE_MANCANTI.
 */
function preparaPsqlFinto() {
  const cartella = cartellaNuova('psql-finto-log');
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
if [ -z "$query" ] && [ -z "$file" ]; then
  cat > /dev/null
  if [ -n "\${FINTO_PRIMO_CONTATTO:-}" ]; then printf '%s\\n' "$FINTO_PRIMO_CONTATTO" >&2; exit 2; fi
  exit 0
fi
if [ -n "$file" ]; then
  if [ -n "\${FINTO_APPLICA:-}" ]; then printf '%s\\n' "$FINTO_APPLICA" >&2; exit "\${FINTO_APPLICA_USCITA:-2}"; fi
  exit 0
fi
case "$query" in
  *"count(*)"*)
    if [ -n "\${FINTO_CONTA:-}" ]; then printf '%s\\n' "$FINTO_CONTA" >&2; exit 2; fi
    echo 2 ;;
  *"SELECT 1 FROM supabase_migrations.schema_migrations"*)
    v="$(printf '%s' "$query" | sed -nE "s/.*version = '([^']+)'.*/\\1/p" | head -1)"
    case " \${FINTE_MANCANTI:-} " in *" $v "*) ;; *) echo 1 ;; esac ;;
esac
exit 0
`,
  );
  chmodSync(join(cartella, 'psql'), 0o755);
  const migrazioni = join(cartella, 'migrations');
  mkdirSync(migrazioni);
  writeFileSync(join(migrazioni, '001_prima.sql'), 'select 1;\n');
  writeFileSync(join(migrazioni, '002_seconda.sql'), 'select 2;\n');
  return { cartella, migrazioni };
}

function lanciaLeMigrazioni(env: Record<string, string>) {
  const { cartella, migrazioni } = preparaPsqlFinto();
  const esito = spawnSync('bash', [MIGRAZIONI], {
    cwd: RADICE,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      NODE_ENV: 'test',
      PATH: `${cartella}:${process.env.PATH}`,
      CARTELLA_MIGRAZIONI: migrazioni,
      SUPABASE_DB_URL: URL_POOLER,
      ...env,
    },
  });
  return { uscita: esito.status ?? -1, testo: `${esito.stdout}\n${esito.stderr}` };
}

const PSQL_TENANT = `psql: error: connection to server at "${MACCHINA}" (${IP}), port ${PORTA} failed: FATAL:  Tenant or user not found`;

describe('lo script delle migrazioni, quando il collegamento fallisce', () => {
  it('al primo contatto: tipo di indirizzo e codice, uscita 1 come prima, niente macchina, porta, utente o testo', () => {
    const { uscita, testo } = lanciaLeMigrazioni({ FINTO_PRIMO_CONTATTO: PSQL_TENANT });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('non riesco a collegarmi al database (pooler di Supabase): nessuna migrazione applicata.');
    expect(testo).toContain("Codice dell'errore: ACCESSO_RIFIUTATO");
    expect(testo).toContain('rifiuta utente o password');
    senzaDettagli(testo, ['Tenant or user not found', 'connection to server', `postgres.${PROGETTO}`]);
  });

  it('al primo contatto sulla connessione diretta: niente nome del progetto ne\' indirizzo IPv6', () => {
    const { uscita, testo } = lanciaLeMigrazioni({
      SUPABASE_DB_URL: URL_DIRETTA,
      FINTO_PRIMO_CONTATTO: `psql: error: connection to server at "db.${PROGETTO}.supabase.co" (2a05:d012:42b:5700::1), port 5432 failed: Network is unreachable`,
    });
    expect(uscita, testo).toBe(1);
    expect(testo).toContain('(connessione diretta di Supabase)');
    expect(testo).toContain("Codice dell'errore: RETE_IRRAGGIUNGIBILE");
    expect(testo).toContain('«Session pooler»');
    senzaDettagli(testo, ['2a05:d012', 'Network is unreachable', 'connection to server']);
  });

  it('al primo contatto, gli altri testi di psql diventano un codice generico', () => {
    const casi: Array<[string, string]> = [
      [`psql: error: connection to server at "${MACCHINA}" (${IP}), port ${PORTA} failed: Connection refused`, 'CONNESSIONE_RIFIUTATA'],
      [`psql: error: connection to server at "${MACCHINA}" (${IP}), port ${PORTA} failed: timeout expired`, 'TIMEOUT'],
      [`psql: error: connection to server at "${MACCHINA}" (${IP}), port ${PORTA} failed: SSL error: certificate verify failed`, 'TLS'],
      [`psql: error: connection to server at "${MACCHINA}" (${IP}), port ${PORTA} failed: qualcosa di mai visto`, 'senza codice'],
    ];
    for (const [psql, codice] of casi) {
      const { uscita, testo } = lanciaLeMigrazioni({ FINTO_PRIMO_CONTATTO: psql });
      expect(uscita, testo).toBe(1);
      expect(testo).toContain(`Codice dell'errore: ${codice}`);
      senzaDettagli(testo, ['connection to server', 'Connection refused', 'timeout expired', 'certificate verify', 'mai visto']);
    }
  });

  it('se il collegamento cade dopo (il conto del registro): una riga generica, e l\'uscita resta quella di psql', () => {
    const { uscita, testo } = lanciaLeMigrazioni({
      FINTO_CONTA: `psql: error: connection to server at "${MACCHINA}" (${IP}), port ${PORTA} failed: server closed the connection unexpectedly`,
    });
    expect(uscita, testo).toBe(2);
    expect(testo).toContain("il collegamento al database si e' interrotto (pooler di Supabase). Codice dell'errore: CONNESSIONE_CHIUSA");
    senzaDettagli(testo, ['server closed the connection', 'connection to server']);
  });

  it('se il collegamento cade mentre applica un file: una riga generica, uscita 2 come prima', () => {
    const { uscita, testo } = lanciaLeMigrazioni({
      FINTE_MANCANTI: '002',
      FINTO_APPLICA: `${MESSAGGIO_PG}\nconnection to server was lost`,
      FINTO_APPLICA_USCITA: '2',
    });
    expect(uscita, testo).toBe(2);
    expect(testo).toContain('▶ applico 002_seconda.sql');
    expect(testo).toContain("il collegamento al database si e' interrotto (pooler di Supabase)");
    senzaDettagli(testo, ['terminating connection', 'connection to server was lost']);
  });

  it('un errore SQL dentro un file (non di collegamento) si stampa come prima, con la sua uscita', () => {
    const { uscita, testo } = lanciaLeMigrazioni({
      FINTE_MANCANTI: '002',
      FINTO_APPLICA: 'psql:002_seconda.sql:1: ERROR:  relation "profiles" already exists',
      FINTO_APPLICA_USCITA: '3',
    });
    expect(uscita, testo).toBe(3);
    expect(testo).toContain('psql:002_seconda.sql:1: ERROR:  relation "profiles" already exists');
    expect(testo).not.toContain("si e' interrotto");
  });
});
