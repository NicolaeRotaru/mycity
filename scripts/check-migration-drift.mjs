#!/usr/bin/env node
/**
 * check-migration-drift — rileva il "drift" tra i file in migrations/ e le
 * migration effettivamente APPLICATE sul database.
 *
 * Motivazione: e' gia' successo di committare un file migration (es. 067) senza
 * applicarlo al DB. Gli unit test non lo vedono; i test d'integrazione coprono
 * solo gli effetti delle migration di sicurezza. Questo script chiude il cerchio
 * confrontando i nomi dei file con la tabella di tracking di Supabase
 * (supabase_migrations.schema_migrations), e il contenuto dove quella tabella
 * tiene l'impronta del file (vedi #46 · R16-003 qui sotto).
 *
 * Uso:
 *   SUPABASE_DB_URL="postgresql://...:5432/postgres" node scripts/check-migration-drift.mjs
 *   (oppure: npm run db:check-drift)
 *
 * Comportamento:
 *   - manca SUPABASE_DB_URL  -> SKIP (exit 0), stampa come configurarlo
 *   - manca il pacchetto pg  -> SKIP (exit 0), suggerisce `npm i -D pg`
 *   - non si collega         -> exit 1 (USCITA.NON_HO_CONTROLLATO), con il perche'
 *                               e cosa cambiare (da GitHub Actions: la riga del
 *                               «Session pooler»)
 *   - drift rilevato         -> exit 2 (USCITA.DERIVA) con l'elenco dei file non applicati
 *   - tutto applicato        -> exit 0 (USCITA.ALLINEATO)
 *
 * Pensato per girare in locale/CI in un job OPT-IN (richiede la connection
 * string con password: NON metterla in un workflow pubblico senza secret).
 *
 * 17/11/2026 (R30-022) — Anche i permessi, a richiesta:
 *   MANCANTI_ESPORTA=<file>  (28/11/2026, R11-005) scrive nel file le migrazioni del deposito che
 *                            il database collegato non ha, un nome di file per riga (vuoto se non
 *                            ne manca nessuna). E' l'elenco che SALTA_MIGRAZIONI di
 *                            tests/sql/harness/apply.sh vuole: le prove dei permessi girano cosi'
 *                            su un database ricostruito come la produzione, non da tutti i file.
 *   PERMESSI_ESPORTA=<file>  scrive nel file i permessi di anon e authenticated del database
 *                            a cui e' collegato (tabelle, colonne, funzioni, schema public);
 *   PERMESSI_ATTESI=<file>   li confronta con un elenco fornito nello stesso formato (per
 *                            esempio quello esportato dal sito vero da chi ne ha la chiave):
 *                            una differenza e' deriva (exit 2), come una migrazione mancante.
 * Lo script non sceglie mai lui il database: legge quello di SUPABASE_DB_URL. Le prove usano
 * solo `confrontaIPermessi` con dati finti.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');
const NAME_RE = /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/;

/**
 * #46 — Si confronta il PREFISSO NUMERICO oltre al nome.
 *
 * Prima il confronto era `applied.has(m.name)`, cioe' solo la parte descrittiva
 * del nome file, e due migrazioni con lo stesso nome e numero diverso (capita:
 * `108_x` e `108b_x`) risultavano la stessa cosa. Quello e' chiuso: sotto si
 * guardano tutti e due.
 *
 * 13/11/2026 (R16-003) — E IL CONTENUTO, DOVE IL REGISTRO LO TIENE. Prima
 * l'impronta md5 di ogni file si calcolava e si stampava soltanto: una
 * migrazione MODIFICATA dopo essere stata applicata passava verde. Adesso lo
 * script del rilascio (scripts/applica-migrazioni-mancanti.sh) scrive
 * l'impronta del file nella colonna `statements` del registro, come commento
 * SQL «-- md5:<impronta>», e `esitoDelConfronto` la confronta con quella del
 * file di oggi: se sono diverse, e' deriva. Le migrazioni registrate prima (o
 * da altre strade, senza impronta) si riconoscono solo per numero e nome, e il
 * verdetto dice per quante il contenuto e' stato davvero confrontato.
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
  } else if (sessionPooler && codici.includes('ECONNREFUSED')) {
    // 5/11/2026 — Il pooler ha RIFIUTATO il collegamento: la rete ci arriva, la porta no. Non e' la
    // password (quella la direbbe il ramo dell'accesso rifiutato), e la riga e' gia' quella giusta.
    righe.push(
      '   Perche\': il pooler di Supabase ha rifiutato il collegamento su quella porta. La password non c\'entra.',
      '   Controlla la porta (5432 per il «Session pooler») e se Supabase ha un disservizio in corso (status.supabase.com).',
    );
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

/**
 * 1/11/2026 (ondata 9) — «NON MI COLLEGO» E «MANCANO MIGRAZIONI» USCIVANO
 * CON LO STESSO NUMERO. Tutte e due davano 1: per chi guarda solo il colore
 * del lavoro (o un passo che decide sul codice d'uscita) una rete che non
 * arriva al database e quattro migrazioni mai applicate in produzione erano
 * la stessa cosa. Sono due guasti opposti: nel primo il confronto non e'
 * nemmeno partito, nel secondo e' partito e ha trovato la deriva vera (come
 * la mattina del 31/10: «4 migration NON applicate»). Adesso hanno due numeri.
 * L'1 resta a tutto cio' che vuol dire «non ho controllato» (manca la riga,
 * manca pg, non mi collego), perche' e' quello che i lavori gia' conoscono.
 */
export const USCITA = Object.freeze({ ALLINEATO: 0, NON_HO_CONTROLLATO: 1, DERIVA: 2 });

/**
 * Il verdetto del confronto, separato dal database perche' sia provabile.
 * @param {Array<{prefix: string, name: string, file: string, impronta?: string}>} repo i file in migrations/
 * @param {Array<{version: string, name: string, statements?: string[] | null}>} applicate le righe di supabase_migrations.schema_migrations
 * @returns {{ codice: number, mancanti: string[], modificate: string[], righe: string[], errore: boolean }}
 */
/** L'impronta che lo script del rilascio scrive nel registro (`statements`): «-- md5:<32 cifre>». */
function improntaRegistrata(statements) {
  if (!Array.isArray(statements)) return null;
  for (const istruzione of statements) {
    const m = String(istruzione ?? '').trim().match(/^--\s*md5:([0-9a-f]{32})$/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function esitoDelConfronto(repo, applicate) {
  // R01-024 (12/11/2026) — Il nome vale solo per una rinumerazione vera: se la riga con quel nome
  // ha il numero di UN ALTRO file del deposito, e' la migrazione omonima vecchia, non questa.
  const prefissiDelDeposito = new Set(repo.map((m) => String(m.prefix)));
  const perNome = new Set(
    applicate
      .filter((a) => !prefissiDelDeposito.has(String(a.version ?? '')))
      .map((a) => String(a.name ?? '')),
  );
  const perVersione = new Set(applicate.map((a) => String(a.version ?? '')));

  // Una migrazione risulta applicata se il database conosce il suo numero
  // OPPURE il suo nome: i due elenchi storici non sono allineati al 100%, e
  // pretendere entrambi darebbe falsi allarmi su tutto il passato.
  const missing = repo.filter((m) => !perNome.has(m.name) && !perVersione.has(m.prefix));

  // R16-003 — Il contenuto: dove la riga con lo stesso numero tiene l'impronta del file
  // (vedi la nota in testa), deve essere quella del file di oggi.
  const rigaPerNumero = new Map(applicate.map((a) => [String(a.version ?? ''), a]));
  let confrontate = 0;
  const modificate = [];
  for (const m of repo) {
    const registrata = improntaRegistrata(rigaPerNumero.get(String(m.prefix))?.statements);
    if (!registrata || !m.impronta) continue;
    confrontate += 1;
    if (registrata !== String(m.impronta).toLowerCase()) modificate.push({ file: m.file, registrata, oggi: m.impronta });
  }

  if (missing.length === 0 && modificate.length === 0) {
    const righe = [
      `✅ check-migration-drift: tutte le ${repo.length} migrazioni risultano applicate.`,
      confrontate === repo.length
        ? '   Contenuto confrontato per tutte: nessuna e\' cambiata dopo essere stata applicata.'
        : `   Contenuto confrontato per ${confrontate} su ${repo.length}: le altre sono registrate senza impronta e si riconoscono solo per numero e nome.`,
    ];
    return { codice: USCITA.ALLINEATO, mancanti: [], modificate: [], righe, errore: false };
  }

  const righe = [];
  if (missing.length > 0) {
    righe.push(`❌ check-migration-drift: ${missing.length} migration NON applicate al DB:`);
    for (const m of missing) righe.push(`   - ${m.file}`);
  }
  if (modificate.length > 0) {
    righe.push(`❌ check-migration-drift: ${modificate.length} migrazioni modificate dopo essere state applicate:`);
    for (const x of modificate) righe.push(`   - ${x.file} (md5 registrato ${x.registrata}, oggi ${x.oggi})`);
    righe.push('   Una migrazione applicata non si cambia: rimetti il file com\'era e porta la correzione in una migrazione nuova.');
  }
  if (missing.length > 0) {
    righe.push(
      '\nApplicale (Supabase SQL editor / CLI / MCP apply_migration) e rilancia.',
      'Nota: migration storiche pre-tracking potrebbero comparire qui; in tal caso',
      'verifica manualmente e, se gia\' applicate, ignorale.',
    );
  }
  return {
    codice: USCITA.DERIVA,
    mancanti: missing.map((m) => m.file),
    modificate: modificate.map((x) => x.file),
    righe,
    errore: true,
  };
}

/**
 * 28/11/2026 (R11-005) — L'elenco delle migrazioni mancanti per SALTA_MIGRAZIONI di apply.sh:
 * un nome di file per riga, nell'ordine del deposito. Vuoto (non assente) se non ne manca nessuna.
 * @param {{ mancanti: string[] }} esito
 */
export function elencoDelleMancanti(esito) {
  return esito.mancanti.map((f) => `${f}\n`).join('');
}

/**
 * 17/11/2026 (R30-022) — I PERMESSI, NON SOLO I NOMI.
 *
 * Il confronto dei nomi non vede un permesso cambiato a mano: sul sito vero anon non legge
 * public.profiles, sul database ricostruito dalle migrazioni si', e nessun controllo lo diceva.
 * Qui i permessi EFFETTIVI dei due ruoli del browser (contano anche quelli dati a PUBLIC):
 * tabelle e viste, colonne con un permesso loro, funzioni, schema public. Una riga e'
 * { tipo, oggetto, ruolo, permesso }.
 */
export const RUOLI_DEL_BROWSER = Object.freeze(['anon', 'authenticated']);

export const DOMANDA_DEI_PERMESSI = `
WITH ruoli(ruolo) AS (VALUES ('anon'), ('authenticated'))
SELECT 'tabella' AS tipo, c.relname::text AS oggetto, r.ruolo, p.permesso
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  CROSS JOIN ruoli r
  CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(permesso)
 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND has_table_privilege(r.ruolo, c.oid, p.permesso)
UNION ALL
SELECT DISTINCT 'colonna', c.relname || '.' || a.attname, r.ruolo, x.privilege_type
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  CROSS JOIN LATERAL aclexplode(a.attacl) x
  CROSS JOIN ruoli r
 WHERE x.grantee = 0 OR x.grantee = (SELECT oid FROM pg_roles WHERE rolname = r.ruolo)
UNION ALL
SELECT 'funzione', p.oid::regprocedure::text, r.ruolo, 'EXECUTE'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  CROSS JOIN ruoli r
 WHERE has_function_privilege(r.ruolo, p.oid, 'EXECUTE')
UNION ALL
SELECT 'schema', 'public', r.ruolo, x.permesso
  FROM ruoli r CROSS JOIN (VALUES ('USAGE'), ('CREATE')) x(permesso)
 WHERE has_schema_privilege(r.ruolo, 'public', x.permesso)
`;

const TIPI_DI_PERMESSO = new Set(['tabella', 'colonna', 'funzione', 'schema']);

/** Una riga di permesso come chiave confrontabile: «tipo|oggetto|ruolo|permesso». */
export function chiaveDelPermesso(riga) {
  return [riga?.tipo, riga?.oggetto, riga?.ruolo, riga?.permesso].map((x) => String(x ?? '').trim()).join('|');
}

/**
 * L'elenco fornito (JSON: un array di righe { tipo, oggetto, ruolo, permesso }). Lancia con un
 * messaggio chiaro se il file non e' in quel formato: un elenco storto non vale «nessuna differenza».
 */
export function leggiPermessiAttesi(testo) {
  let dati;
  try {
    dati = JSON.parse(String(testo));
  } catch (e) {
    throw new Error(`l'elenco dei permessi non e' JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!Array.isArray(dati) || dati.length === 0) throw new Error("l'elenco dei permessi deve essere un array non vuoto di righe { tipo, oggetto, ruolo, permesso }");
  dati.forEach((r, i) => {
    if (!r || !TIPI_DI_PERMESSO.has(r.tipo) || !r.oggetto || !RUOLI_DEL_BROWSER.includes(r.ruolo) || !r.permesso) {
      throw new Error(`l'elenco dei permessi ha una riga storta (la ${i + 1}): ${JSON.stringify(r)}`);
    }
  });
  return dati;
}

/**
 * Il verdetto sui permessi, separato dal database perche' sia provabile.
 * `inPiu`: il database collegato li concede e l'elenco no. `mancanti`: l'elenco li concede e il
 * database collegato no. Tutte e due sono deriva.
 */
export function confrontaIPermessi(delDatabase, attesi) {
  const qui = new Set(delDatabase.map(chiaveDelPermesso));
  const la = new Set(attesi.map(chiaveDelPermesso));
  const inPiu = [...qui].filter((k) => !la.has(k)).sort();
  const mancanti = [...la].filter((k) => !qui.has(k)).sort();
  if (inPiu.length === 0 && mancanti.length === 0) {
    return {
      codice: USCITA.ALLINEATO, inPiu, mancanti, errore: false,
      righe: [`✅ check-migration-drift: i permessi di anon e authenticated coincidono con l'elenco (${la.size} righe).`],
    };
  }
  const righe = [`❌ check-migration-drift: i permessi di anon e authenticated non coincidono con l'elenco.`];
  if (inPiu.length > 0) {
    righe.push(`   ${inPiu.length} concessi da questo database e non dall'elenco (tipo|oggetto|ruolo|permesso):`);
    for (const k of inPiu) righe.push(`   + ${k}`);
  }
  if (mancanti.length > 0) {
    righe.push(`   ${mancanti.length} concessi dall'elenco e non da questo database:`);
    for (const k of mancanti) righe.push(`   - ${k}`);
  }
  righe.push('   Un permesso cambiato a mano va scritto in una migrazione nuova (GRANT o REVOKE), cosi\' le copie del sito restano uguali a quello vero.');
  return { codice: USCITA.DERIVA, inPiu, mancanti, righe, errore: true };
}

/**
 * 5/11/2026 — Le righe da stampare quando il collegamento riesce ma il registro delle migrazioni non
 * si legge. Funzione pura. Mai l'oggetto d'errore intero: solo codice e messaggio.
 */
export function spiegaIlRegistroIlleggibile(errore) {
  const codice = String(errore?.code ?? '');
  const messaggio = String(errore?.message ?? errore ?? 'errore sconosciuto');
  const righe = [`❌ check-migration-drift: collegato al database, ma non riesco a leggere il registro delle migrazioni (${codice || 'senza codice'}: ${messaggio}).`];
  if (codice === '42P01' || codice === '3F000') {
    righe.push('   Perche\': questo database non ha il registro delle migrazioni di Supabase (supabase_migrations.schema_migrations). SUPABASE_DB_URL punta al database giusto?');
  } else if (codice === '42501') {
    righe.push('   Perche\': l\'utente in SUPABASE_DB_URL non puo\' leggere supabase_migrations.schema_migrations: usa l\'utente postgres del progetto.');
  } else {
    righe.push('   Controlla che SUPABASE_DB_URL punti al database del progetto e che l\'utente possa leggere supabase_migrations.');
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
      // I byte del file, come `md5sum` nello script del rilascio: le due impronte devono coincidere.
      const contenuto = fs.readFileSync(path.join(MIGRATIONS_DIR, file));
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
    process.exit(USCITA.NON_HO_CONTROLLATO);
  }
  let applicate;
  // R30-022 — I permessi si leggono solo se richiesti (PERMESSI_ATTESI o PERMESSI_ESPORTA).
  const fileAttesi = process.env.PERMESSI_ATTESI;
  const fileDaScrivere = process.env.PERMESSI_ESPORTA;
  let permessi = null;
  try {
    // `version` e' il prefisso numerico, `name` la parte descrittiva: servono
    // tutti e due per riconoscere una migrazione (#46). `statements` porta
    // l'impronta del file, dove lo script del rilascio l'ha scritta (R16-003).
    const res = await client.query('SELECT version, name, statements FROM supabase_migrations.schema_migrations');
    applicate = res.rows.map((r) => ({
      version: String(r.version ?? ''),
      name: String(r.name ?? ''),
      statements: Array.isArray(r.statements) ? r.statements : null,
    }));
  } catch (err) {
    // 5/11/2026 — Collegati, ma il registro non si legge: si dice cosa fare, non la traccia nuda.
    for (const riga of spiegaIlRegistroIlleggibile(err)) console.error(riga);
    await client.end().catch(() => {});
    process.exit(USCITA.NON_HO_CONTROLLATO);
  }
  if (fileAttesi || fileDaScrivere) {
    try {
      const res = await client.query(DOMANDA_DEI_PERMESSI);
      permessi = res.rows.map((r) => ({ tipo: r.tipo, oggetto: r.oggetto, ruolo: r.ruolo, permesso: r.permesso }));
    } catch (err) {
      console.error(`❌ check-migration-drift: collegato, ma non riesco a leggere i permessi (${String(err?.code ?? 'senza codice')}: ${String(err?.message ?? err)}).`);
      await client.end().catch(() => {});
      process.exit(USCITA.NON_HO_CONTROLLATO);
    }
  }
  await client.end();

  if (fileDaScrivere && permessi) {
    fs.writeFileSync(fileDaScrivere, `${JSON.stringify(permessi, null, 1)}\n`);
    console.log(`📝 check-migration-drift: ${permessi.length} permessi di anon e authenticated scritti in ${fileDaScrivere}.`);
  }

  const esito = esitoDelConfronto(repoMigrationNames(), applicate);
  if (process.env.MANCANTI_ESPORTA) {
    fs.writeFileSync(process.env.MANCANTI_ESPORTA, elencoDelleMancanti(esito));
    console.log(`📝 check-migration-drift: ${esito.mancanti.length} migrazioni mancanti scritte in ${process.env.MANCANTI_ESPORTA}.`);
  }
  for (const riga of esito.righe) (esito.errore ? console.error : console.log)(riga);
  let codice = esito.codice;

  if (fileAttesi && permessi) {
    let attesi;
    try {
      attesi = leggiPermessiAttesi(fs.readFileSync(fileAttesi, 'utf8'));
    } catch (err) {
      console.error(`❌ check-migration-drift: ${err instanceof Error ? err.message : String(err)} (${fileAttesi}).`);
      process.exit(USCITA.NON_HO_CONTROLLATO);
    }
    const suiPermessi = confrontaIPermessi(permessi, attesi);
    for (const riga of suiPermessi.righe) (suiPermessi.errore ? console.error : console.log)(riga);
    if (codice === USCITA.ALLINEATO) codice = suiPermessi.codice;
  }
  process.exit(codice);
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
    // 5/11/2026 — Solo il messaggio: l'oggetto d'errore intero di pg porta dettagli che non servono.
    console.error('check-migration-drift: errore', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
