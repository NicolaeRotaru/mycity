#!/usr/bin/env node
/**
 * check-migration-drift — rileva il "drift" tra i file in migrations/ e le
 * migration effettivamente APPLICATE sul database.
 *
 * Motivazione: e' gia' successo di committare un file migration (es. 067) senza
 * applicarlo al DB. Gli unit test non lo vedono; i test d'integrazione coprono
 * solo gli effetti delle migration di sicurezza. Questo script chiude il cerchio
 * confrontando i nomi dei file con la tabella di tracking di Supabase
 * (supabase_migrations.schema_migrations).
 *
 * Uso:
 *   SUPABASE_DB_URL="postgresql://...:5432/postgres" node scripts/check-migration-drift.mjs
 *   (oppure: npm run db:check-drift)
 *
 * Comportamento:
 *   - manca SUPABASE_DB_URL  -> SKIP (exit 0), stampa come configurarlo
 *   - manca il pacchetto pg  -> SKIP (exit 0), suggerisce `npm i -D pg`
 *   - non si collega         -> exit 1, con il perche' e cosa cambiare
 *                               (da GitHub Actions: la riga del «Session pooler»)
 *   - drift rilevato         -> exit 1 con l'elenco dei file non applicati
 *   - tutto applicato        -> exit 0
 *
 * Pensato per girare in locale/CI in un job OPT-IN (richiede la connection
 * string con password: NON metterla in un workflow pubblico senza secret).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');
const NAME_RE = /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/;

/**
 * #46 — Si confronta il PREFISSO NUMERICO oltre al nome. Il contenuto NO: si
 * calcola e si stampa soltanto.
 *
 * Prima il confronto era `applied.has(m.name)`, cioe' solo la parte descrittiva
 * del nome file, e due migrazioni con lo stesso nome e numero diverso (capita:
 * `108_x` e `108b_x`) risultavano la stessa cosa. Quello e' chiuso: sotto si
 * guardano tutti e due.
 *
 * ⚠️ QUELLO CHE QUESTO CONTROLLO NON PRENDE, detto qui perche' fin qui il
 * commento prometteva piu' di quanto il codice facesse (misurato il 6/9/2026).
 * Una migrazione MODIFICATA dopo essere stata applicata passa verde: il numero
 * e il nome nel database ci sono ancora, e nessuno confronta il contenuto. Sotto
 * si calcola l'impronta md5 di ogni file, ma serve solo a stamparne cinque nel
 * log — non entra in nessun confronto. Per confrontarla davvero servirebbe una
 * colonna dove conservarla in `supabase_migrations.schema_migrations`, che oggi
 * non c'e': e' una modifica al database, cioe' una decisione da firmare, non una
 * riga da aggiungere qui. Finche' quella colonna non esiste, la frase giusta e'
 * «il database conosce queste migrazioni», non «il database e' allineato al
 * codice».
 */
/**
 * 15/10/2026 (R53) — PERCHE' IL CONTROLLO NON SI COLLEGAVA, DETTO A CHI LO LEGGE.
 *
 * Il lavoro «Deriva migrazioni (produzione)» e' finito rosso 52 mattine su 52,
 * dal 21/8 all'11/10, sempre cosi':
 *
 *   check-migration-drift: errore Error: connect ENETUNREACH 2a05:d012:…:5432
 *
 * Il segreto SUPABASE_DB_URL conteneva la connessione DIRETTA di Supabase
 * (db.<progetto>.supabase.co), che risponde solo in IPv6. I computer di GitHub
 * Actions hanno solo IPv4: la rete non ci arriva. Non era la password e non era
 * il database spento — e il messaggio non lo diceva, quindi il rosso e'
 * diventato rumore di fondo. La strada che funziona e' il «Session pooler»,
 * che risponde in IPv4: la stessa riga che serve alla copia notturna.
 *
 * Qui si traduce l'errore in quello che c'e' da fare. Mai la password nel
 * testo: si nominano solo macchina e porta.
 */
export const ESEMPIO_SESSION_POOLER =
  'postgresql://postgres.<progetto>:<password>@aws-0-<regione>.pooler.supabase.com:5432/postgres';

/** Codici con cui il sistema dice «da qui quella rete non si raggiunge». */
const RETE_IRRAGGIUNGIBILE = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'EAFNOSUPPORT']);

/** Macchina, porta e password di una stringa di connessione; `letta: false` se non si legge. */
function partiDellIndirizzo(url) {
  try {
    const u = new URL(String(url ?? ''));
    return {
      letta: true,
      macchina: u.hostname.replace(/^\[|\]$/g, ''),
      porta: u.port || '5432',
      // Tutte e due le forme: l'errore potrebbe ripetere la stringa com'e'
      // scritta (p%40ss) o gia' decodificata (p@ss).
      password: u.password ? decodeURIComponent(u.password) : '',
      passwordScritta: u.password,
    };
  } catch {
    return { letta: false, macchina: '', porta: '', password: '', passwordScritta: '' };
  }
}

/**
 * 15/10/2026 (collaudo di R53) — Il database di questa stessa macchina: il
 * passo «Coerenza interna» della CI si collega a localhost. Se quello non
 * risponde, il consiglio del Session pooler porta fuori strada: li' Supabase
 * non c'entra, e' il Postgres del lavoro che non e' pronto.
 */
function eLocale(macchina) {
  const m = macchina.toLowerCase();
  return m === '' || m === 'localhost' || m === '::1' || /^127\./.test(m) || m.startsWith('/');
}

/** Un indirizzo di Supabase (diretto o pooler): solo li' il Session pooler e' la strada. */
function eSupabase(macchina) {
  return /\.supabase\.(co|com)$/i.test(macchina);
}

/** Codici con cui Postgres dice «ti sento, ma utente o password non vanno». */
const ACCESSO_RIFIUTATO = new Set(['28P01', '28000']);

/** Codici con cui il sistema dice «quel nome di macchina non esiste». */
const NOME_NON_TROVATO = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME']);

/**
 * Toglie dal testo tutto quello che potrebbe essere una password: le due forme
 * della password, se la riga si legge, e comunque qualunque «://utente:segreto@»
 * — che e' l'unica difesa quando la riga NON si legge e la password non si sa
 * isolare.
 *
 * 15/10/2026 (secondo collaudo di R53) — Una password di una o due lettere
 * veniva cercata e sostituita in tutto il messaggio: con «x» l'errore
 * «timeout expired» diventava «timeout e***pired». Sotto le quattro lettere
 * una password non e' un segreto che un log possa tradire (si indovina in un
 * attimo), e oscurarla rende illeggibile proprio la riga che spiega il guasto.
 */
const LUNGHEZZA_MINIMA_DA_OSCURARE = 4;

function senzaSegreti(testo, segreti) {
  let pulito = String(testo);
  for (const segreto of segreti) {
    if (segreto && segreto.length >= LUNGHEZZA_MINIMA_DA_OSCURARE) pulito = pulito.split(segreto).join('***');
  }
  return pulito.replace(/:\/\/[^@\s]*@/g, '://***@');
}

/** L'errore stesso e, se e' un gruppo (piu' indirizzi provati), quelli dentro. */
function erroriDentro(errore) {
  const tutti = [errore];
  if (errore && Array.isArray(errore.errors)) tutti.push(...errore.errors);
  return tutti.filter(Boolean);
}

/**
 * Le righe da stampare quando il collegamento al database fallisce.
 * Funzione pura: riceve l'errore e la stringa di connessione, non tocca niente.
 */
export function spiegaIlCollegamentoFallito(errore, url) {
  const { letta, macchina, porta, password, passwordScritta } = partiDellIndirizzo(url);
  const errori = erroriDentro(errore);
  const codici = errori.map((e) => String(e.code ?? '')).filter(Boolean);
  const irraggiungibile = codici.some((c) => RETE_IRRAGGIUNGIBILE.has(c));
  const accessoRifiutato = codici.some((c) => ACCESSO_RIFIUTATO.has(c));
  const nomeNonTrovato = codici.some((c) => NOME_NON_TROVATO.has(c));
  const indirizzoIPv6 =
    macchina.includes(':') || errori.some((e) => typeof e.address === 'string' && e.address.includes(':'));
  const connessioneDiretta = /^db\.[^.]+\.supabase\.co$/i.test(macchina);
  const sessionPooler = /\.pooler\.supabase\.com$/i.test(macchina);
  const rigaDelPooler = `   Da GitHub Actions serve la riga del «Session pooler» (IPv4) di Supabase: ${ESEMPIO_SESSION_POOLER}`;

  const grezzo = String(errore?.message ?? errore ?? '').trim() || codici.join(', ') || 'errore sconosciuto';
  const dettaglio = senzaSegreti(grezzo, [password, passwordScritta]);

  const dove = letta ? `${macchina || 'database locale'}:${porta}` : 'l\'indirizzo in SUPABASE_DB_URL';
  const righe = [
    `❌ check-migration-drift: non riesco a collegarmi al database (${dove}).`,
    `   Errore: ${dettaglio}`,
  ];

  if (!letta) {
    // 15/10/2026 (collaudo di R53) — Una password con # o / incollata a mano
    // al posto di [YOUR-PASSWORD] rende la riga illeggibile, e prima usciva la
    // traccia nuda di Node («TypeError: Invalid URL») senza dire perche'.
    righe.push(
      '   Perche\': la riga in SUPABASE_DB_URL non si legge come indirizzo postgresql://… .',
      '   Di solito e\' la password: se contiene # / ? @ : vanno scritti codificati (# → %23, / → %2F, ? → %3F, @ → %40, : → %3A).',
      `   La riga del «Session pooler» ha questa forma: ${ESEMPIO_SESSION_POOLER}`,
    );
  } else if (accessoRifiutato) {
    // 15/10/2026 (secondo collaudo di R53) — Prima dei rami della rete e del
    // database locale: se il server ha rifiutato la password, la rete ci e'
    // arrivata e il database risponde.
    // Dire «la rete non arriva, e' IPv6» a chi ha solo la password sbagliata
    // (dal computer di Nicola, che l'IPv6 ce l'ha) lo manda a cambiare la riga
    // giusta.
    righe.push('   Perche\': il database risponde, ma rifiuta utente o password: controlla quelli scritti in SUPABASE_DB_URL.');
    if (sessionPooler) {
      righe.push('   Nella riga del pooler l\'utente e\' postgres.<progetto>, non solo «postgres».');
    }
  } else if (eLocale(macchina)) {
    righe.push(
      '   E\' un database su questa stessa macchina e non risponde: controlla che sia acceso (nella CI: il servizio',
      '   Postgres del lavoro) e che porta, utente e nome del database siano giusti.',
    );
  } else if (connessioneDiretta || (irraggiungibile && indirizzoIPv6)) {
    righe.push(
      '   Perche\': la rete non arriva a quell\'indirizzo. La connessione diretta di Supabase (db.<progetto>.supabase.co)',
      '   risponde solo in IPv6, e i computer di GitHub Actions hanno solo IPv4.',
      '   Cosa fare: in SUPABASE_DB_URL metti la riga del «Session pooler» (IPv4) — Supabase → pannello Connect →',
      `   riquadro «Session pooler», porta 5432. Ha questa forma: ${ESEMPIO_SESSION_POOLER}`,
      '   E\' la stessa riga che serve alla copia notturna del database.',
    );
  } else if (nomeNonTrovato) {
    // 15/10/2026 (secondo collaudo di R53) — Un nome del pooler scritto male
    // (la regione, o aws-0 al posto di aws-1) finiva nel ramo del pooler, che
    // mandava a controllare la password. Lo script delle migrazioni, sullo
    // stesso errore, diceva gia' la cosa giusta: adesso lo dicono tutti e due.
    righe.push('   Perche\': il nome della macchina in SUPABASE_DB_URL non si trova: controlla l\'indirizzo.');
    if (eSupabase(macchina)) {
      righe.push(
        '   Copialo intero da Supabase → pannello Connect → riquadro «Session pooler»: la regione e il prefisso',
        '   (aws-0 o aws-1) cambiano da progetto a progetto.',
      );
    }
  } else if (sessionPooler) {
    righe.push(
      '   L\'indirizzo e\' gia\' quello del pooler. Se l\'errore parla di utente o «tenant»: l\'utente e\' postgres.<progetto>',
      '   (nel pooler porta dietro il codice del progetto, non e\' solo «postgres»). Altrimenti controlla porta (5432) e password.',
    );
  } else if (irraggiungibile) {
    righe.push('   Perche\': da qui la rete non arriva a quell\'indirizzo.');
    if (eSupabase(macchina)) righe.push(rigaDelPooler);
  } else {
    righe.push('   Controlla l\'indirizzo scritto in SUPABASE_DB_URL.');
    if (eSupabase(macchina)) righe.push(rigaDelPooler);
  }
  return righe;
}

function repoMigrationNames() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((f) => f.match(NAME_RE))
    .filter(Boolean)
    .map((m) => {
      const file = `${m[1]}_${m[2]}.sql`;
      const contenuto = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        prefix: m[1],
        name: m[2],
        file,
        impronta: crypto.createHash('md5').update(contenuto).digest('hex'),
      };
    });
}

async function main() {
  // #46 — «Saltato» non e' «passato». Con SALTO_E_ERRORE=1 (la CI di
  // produzione) l'assenza della connessione e' un errore, non un verde: un
  // controllo che non ha controllato niente non deve sembrare superato.
  const saltoEErrore = process.env.SALTO_E_ERRORE === '1';
  if (!DB_URL) {
    console.log(`${saltoEErrore ? '❌' : '⏭️ '} check-migration-drift: ${saltoEErrore ? 'ERRORE' : 'SALTATO'} — manca SUPABASE_DB_URL.`);
    // 15/10/2026 (R53) — Qui l'esempio era la connessione DIRETTA
    // (db.<ref>.supabase.co), cioe' proprio l'indirizzo che da GitHub Actions
    // non si raggiunge: chi lo seguiva si ritrovava col controllo rosso ogni
    // mattina per un motivo di rete. L'esempio adesso e' quello che funziona.
    console.log('    Imposta la riga del «Session pooler» (IPv4): Supabase → pannello Connect → riquadro «Session pooler», porta 5432:');
    console.log(`    SUPABASE_DB_URL="${ESEMPIO_SESSION_POOLER}"`);
    process.exit(saltoEErrore ? 1 : 0);
  }

  let pg;
  try {
    pg = await import('pg');
  } catch {
    console.log('⏭️  check-migration-drift: SALTATO — pacchetto "pg" non installato. Esegui: npm i -D pg');
    process.exit(saltoEErrore ? 1 : 0);
  }

  // 15/10/2026 (collaudo di R53) — Anche la costruzione del client sta dentro
  // il try: con una riga illeggibile (una password con # o /) e' gia' qui che
  // pg si lamenta, e fuori dal try usciva la traccia nuda.
  let client;
  try {
    client = new pg.default.Client({ connectionString: DB_URL });
    await client.connect();
  } catch (err) {
    // R53 — Prima qui usciva la traccia nuda di Node («connect ENETUNREACH
    // 2a05:…:5432») e nient'altro: 52 mattine rosse su 52 senza che il
    // messaggio dicesse cosa cambiare. Adesso si dice dove non si arriva e
    // perche', senza mai stampare la password.
    for (const riga of spiegaIlCollegamentoFallito(err, DB_URL)) console.error(riga);
    process.exit(1);
  }
  let applicate;
  try {
    // `version` e' il prefisso numerico, `name` la parte descrittiva: servono
    // tutti e due per riconoscere una migrazione (#46).
    const res = await client.query('SELECT version, name FROM supabase_migrations.schema_migrations');
    applicate = res.rows.map((r) => ({ version: String(r.version ?? ''), name: String(r.name ?? '') }));
  } finally {
    await client.end();
  }

  const repo = repoMigrationNames();
  const perNome = new Set(applicate.map((a) => a.name));
  const perVersione = new Set(applicate.map((a) => a.version));

  // Una migrazione risulta applicata se il database conosce il suo numero
  // OPPURE il suo nome: i due elenchi storici non sono allineati al 100%, e
  // pretendere entrambi darebbe falsi allarmi su tutto il passato.
  const missing = repo.filter((m) => !perNome.has(m.name) && !perVersione.has(m.prefix));

  if (missing.length === 0) {
    console.log(`✅ check-migration-drift: tutte le ${repo.length} migrazioni risultano applicate.`);
    // #46 — L'impronta del contenuto, STAMPATA e non confrontata (vedi la nota
    // in testa al file). Il registro di Supabase non ha una colonna dove
    // conservarla, quindi resta un appiglio per chi indaga a mano: si confronta
    // l'impronta di oggi con quella scritta nel log del rilascio in cui la
    // migrazione e' stata applicata, e si vede se il file e' stato toccato da
    // allora. Un occhio umano, non un cancello.
    for (const m of repo.slice(-5)) console.log(`   ${m.file} · md5 ${m.impronta}`);
    process.exit(0);
  }

  console.error(`❌ check-migration-drift: ${missing.length} migration NON applicate al DB:`);
  for (const m of missing) console.error(`   - ${m.file}`);
  console.error('\nApplicale (Supabase SQL editor / CLI / MCP apply_migration) e rilancia.');
  console.error('Nota: migration storiche pre-tracking potrebbero comparire qui; in tal caso');
  console.error('verifica manualmente e, se gia\' applicate, ignorale.');
  process.exit(1);
}

// Si parte solo quando il file e' lanciato da riga di comando: le prove lo
// importano per leggere `spiegaIlCollegamentoFallito`, e importarlo non deve
// aprire connessioni ne' chiudere il processo.
//
// 15/10/2026 (collaudo di R53) — Si confrontano i percorsi VERI, risolti i
// collegamenti simbolici da tutte e due le parti. Prima il confronto era fra
// il percorso scritto e quello vero: lanciato da un percorso che passa per un
// collegamento (su macOS anche /tmp lo e'), lo script usciva 0 senza stampare
// niente e senza controllare niente — un verde muto.
function lanciatoDaRigaDiComando() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (lanciatoDaRigaDiComando()) {
  main().catch((err) => {
    console.error('check-migration-drift: errore', err);
    process.exit(1);
  });
}
