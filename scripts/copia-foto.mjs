#!/usr/bin/env node
/**
 * 1/11/2026 — LE FOTO DI PRODOTTI E NEGOZI NON ERANO IN NESSUNA COPIA.
 *
 * La copia notturna salvava il database, gli utenti e l'ELENCO delle foto
 * (quali file esistevano). I file veri no: il pezzo con rclone in fondo a
 * scripts/backup-db.sh vuole un secchio di destinazione a pagamento, e senza
 * quello restava spento. Risultato: se il progetto Supabase perdeva le
 * immagini, ogni negoziante doveva rifotografare il catalogo.
 *
 * Questo script non chiede una destinazione nuova. Scarica i secchi PUBBLICI
 * delle immagini dall'API Storage di Supabase, con la chiave di servizio, in
 * una cartella accanto alla copia del database. Il resto (impacchettare,
 * cifrare, conservare fra gli artefatti come il database) lo fa
 * scripts/copia-foto.sh.
 *
 * Regole che non si piegano:
 *  - `kyc-docs` (documenti d'identita') non si scarica MAI, nemmeno se
 *    qualcuno lo scrive per sbaglio nell'elenco dei secchi;
 *  - un elenco o un download che non riesce fa fallire tutto, con il nome del
 *    file: una copia a meta' che si dichiara riuscita e' peggio di nessuna;
 *  - un file da zero byte e' un fallimento, non una foto;
 *  - una copia senza nemmeno un file e' un fallimento: su un marketplace vivo
 *    vuol dire chiave sbagliata o secchio sbagliato.
 *
 * Uso: node scripts/copia-foto.mjs <cartella>
 *   FOTO_CHIAVE_SERVIZIO       la chiave di servizio di Supabase (obbligatoria;
 *                              il lavoro la prende dal segreto
 *                              SUPABASE_SERVICE_ROLE_KEY. Nome a parte perche'
 *                              nel codice del sito quella chiave si legge solo
 *                              da lib/env.ts, e questo script gira fuori dal sito)
 *   SUPABASE_URL               https://<progetto>.supabase.co (facoltativa: se
 *                              manca si ricava dall'utente di SUPABASE_DB_URL,
 *                              che nel Session pooler e' «postgres.<progetto>»)
 *   FOTO_SECCHI                default «products stories reviews». Passano
 *                              SOLO i secchi dichiarati `pubblico: true` in
 *                              lib/storage/regole-secchi.ts (la casa unica
 *                              delle regole dei magazzini): `cod-proof`,
 *                              `invoices`, `kyc-docs` restano fuori anche se
 *                              qualcuno li scrive qui.
 *   FOTO_TETTO_MB              default 3000: oltre, si ferma e lo dice
 *
 * Uscite: 0 riuscita · 1 fallita · 2 uso sbagliato · 3 non configurata (manca
 * la chiave o l'indirizzo). Il 3 e' distinto apposta: il lavoro notturno lo usa
 * per non riscrivere ogni notte «manca la chiave» nella stessa segnalazione.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Ogni richiesta ha una scadenza: un fornitore che non risponde non deve mangiarsi la notte. */
export const SCADENZA_MS = 60_000;
/** Il file che Supabase mette nelle cartelle «vuote» create dal pannello: non e' una foto. */
export const SEGNAPOSTO = '.emptyFolderPlaceholder';

const REGOLE_SECCHI = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'storage', 'regole-secchi.ts');

/**
 * I secchi pubblici, letti dalla casa unica delle regole (lib/storage/regole-secchi.ts).
 * Si legge il testo, non si importa: lo script gira con node senza TypeScript.
 * Se il file cambia forma e non si legge piu', si ferma: indovinare qui vorrebbe
 * dire rischiare di copiare un magazzino privato.
 * @param {string} [testo]
 * @returns {Set<string>}
 */
export function secchiPubblici(testo = readFileSync(REGOLE_SECCHI, 'utf8')) {
  const pubblici = new Set();
  let trovati = 0;
  for (const m of testo.matchAll(/nome:\s*'([^']+)'[^}]*?pubblico:\s*(true|false)/g)) {
    trovati++;
    if (m[2] === 'true') pubblici.add(m[1]);
  }
  if (trovati === 0) throw new Error(`non riesco a leggere quali secchi sono pubblici da ${REGOLE_SECCHI}`);
  return pubblici;
}

/**
 * Il tetto in byte da FOTO_TETTO_MB. Vuoto = 3000 MB. Qualunque altra cosa che
 * non sia un numero positivo e' un errore chiaro, non un NaN che spegne il tetto.
 * @param {string | undefined} valore
 * @returns {number}
 */
export function tettoDaMb(valore) {
  if (valore === undefined || String(valore).trim() === '') return 3000 * 1024 * 1024;
  const n = Number(String(valore).trim());
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`FOTO_TETTO_MB deve essere un numero di megabyte maggiore di zero, non «${valore}»`);
  }
  return n * 1024 * 1024;
}

export const SECCHI_PREDEFINITI = ['products', 'stories', 'reviews'];
/** Mai, per nessun motivo: documenti d'identita'. */
export const SECCHI_VIETATI = new Set(['kyc-docs']);

/**
 * @param {string | undefined} dbUrl
 * @returns {string | null}
 * «postgresql://postgres.abcd:pw@aws-0-eu.pooler.supabase.com:5432/postgres» → https://abcd.supabase.co */
export function indirizzoDalDb(dbUrl) {
  if (!dbUrl) return null;
  try {
    const u = new URL(dbUrl);
    const m = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(u.username));
    return m ? `https://${m[1]}.supabase.co` : null;
  } catch {
    return null;
  }
}

/**
 * Separa l'elenco dei secchi e tiene solo quelli pubblici, dicendo cosa scarta.
 * @param {string | undefined} testo
 * @param {(riga: string) => void} [avvisa]
 * @param {Set<string>} [pubblici]
 * @returns {string[]}
 */
export function secchiDaCopiare(testo, avvisa = () => {}, pubblici = secchiPubblici()) {
  const chiesti = (testo && testo.trim() ? testo.trim().split(/[\s,]+/) : SECCHI_PREDEFINITI).filter(Boolean);
  return chiesti.filter((s) => {
    if (SECCHI_VIETATI.has(s)) {
      avvisa(`[foto] Il secchio ${s} non si copia mai (documenti d'identita'): saltato.`);
      return false;
    }
    if (!pubblici.has(s)) {
      avvisa(`[foto] Il secchio ${s} non e' dichiarato pubblico in lib/storage/regole-secchi.ts: saltato. Un magazzino privato non entra in questa copia senza una decisione.`);
      return false;
    }
    return true;
  });
}

function codifica(percorso) {
  return percorso.split('/').map(encodeURIComponent).join('/');
}

function intestazioni(chiave) {
  return { Authorization: `Bearer ${chiave}`, apikey: chiave };
}

/**
 * Tutti i file di un secchio, cartella per cartella, a pagine di `pagina`.
 * Nell'API di Supabase una voce con `id: null` e' una cartella.
 * @param {{ base: string, chiave: string, secchio: string, pagina?: number, fetchFn?: typeof fetch, scadenzaMs?: number }} opzioni
 * @returns {Promise<string[]>}
 */
export async function elencaSecchio({ base, chiave, secchio, pagina = 1000, fetchFn = fetch, scadenzaMs = SCADENZA_MS }) {
  const file = [];
  const daVisitare = [''];
  while (daVisitare.length) {
    const prefisso = daVisitare.shift();
    for (let offset = 0; ; offset += pagina) {
      const risposta = await fetchFn(`${base}/storage/v1/object/list/${encodeURIComponent(secchio)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(scadenzaMs),
        headers: { ...intestazioni(chiave), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: prefisso, limit: pagina, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      if (!risposta.ok) {
        throw new Error(`l'elenco del secchio ${secchio} (cartella «${prefisso || '/'}», da ${offset}) ha risposto ${risposta.status}`);
      }
      const voci = await risposta.json();
      if (!Array.isArray(voci)) throw new Error(`l'elenco del secchio ${secchio} non e' una lista`);
      for (const v of voci) {
        const nome = prefisso ? `${prefisso}/${v.name}` : v.name;
        if (v.id === null || v.id === undefined) daVisitare.push(nome);
        else if (v.name !== SEGNAPOSTO) file.push(nome);
      }
      if (voci.length < pagina) break;
    }
  }
  return file;
}

/** Il file non c'e' piu' (cancellato fra l'elenco e il download): non e' un guasto della copia. */
const SPARITO = Symbol('sparito');

async function scaricaUno({ base, chiave, secchio, nome, fetchFn, scadenzaMs, tentativi = 3 }) {
  let ultimo = '';
  for (let i = 0; i < tentativi; i++) {
    try {
      const r = await fetchFn(`${base}/storage/v1/object/${encodeURIComponent(secchio)}/${codifica(nome)}`, {
        headers: intestazioni(chiave),
        signal: AbortSignal.timeout(scadenzaMs),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
      // Supabase risponde 404, o 400 con «not_found» nel corpo, per un file che non esiste piu'.
      if (r.status === 404) return SPARITO;
      const corpo = await r.text().catch(() => '');
      if (r.status === 400 && /not.?found/i.test(corpo)) return SPARITO;
      ultimo = `risposta ${r.status}`;
    } catch (e) {
      ultimo = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`il file ${secchio}/${nome} non si scarica (${tentativi} tentativi, ultimo: ${ultimo})`);
}

/**
 * Copia i secchi nella cartella. Restituisce quanti file e quanti byte.
 * Lancia un errore — mai un mezzo successo — se qualcosa non riesce.
 * @param {{ base: string, chiave: string, secchi: string[], cartella: string, pagina?: number,
 *   tettoByte?: number, fetchFn?: typeof fetch, scrivi?: (riga: string) => void,
 *   scadenzaMs?: number, pubblici?: Set<string> }} opzioni
 * @returns {Promise<{ file: number, byte: number, spariti: string[], perSecchio: Record<string, number> }>}
 */
export async function copiaFoto({
  base,
  chiave,
  secchi,
  cartella,
  pagina = 1000,
  tettoByte = 3000 * 1024 * 1024,
  fetchFn = fetch,
  scadenzaMs = SCADENZA_MS,
  pubblici = secchiPubblici(),
  scrivi = (r) => {
    process.stdout.write(`${r}\n`);
  },
}) {
  if (!base) throw new Error('manca l indirizzo di Supabase (SUPABASE_URL)');
  if (!chiave) throw new Error('manca la chiave di servizio (FOTO_CHIAVE_SERVIZIO)');
  const radice = resolve(cartella);
  let file = 0;
  let byte = 0;
  /** @type {string[]} */
  const spariti = [];
  /** @type {Record<string, number>} */
  const perSecchio = {};
  for (const secchio of secchi) {
    if (SECCHI_VIETATI.has(secchio)) throw new Error(`il secchio ${secchio} non si copia mai`);
    if (!pubblici.has(secchio)) throw new Error(`il secchio ${secchio} non e' pubblico: non entra in questa copia`);
    const nomi = await elencaSecchio({ base, chiave, secchio, pagina, fetchFn, scadenzaMs });
    scrivi(`[foto] ${secchio}: ${nomi.length} file da scaricare`);
    for (const nome of nomi) {
      const dove = resolve(radice, secchio, nome);
      if (!dove.startsWith(radice + sep)) throw new Error(`nome di file fuori dalla cartella: ${secchio}/${nome}`);
      const contenuto = await scaricaUno({ base, chiave, secchio, nome, fetchFn, scadenzaMs });
      if (contenuto === SPARITO) {
        spariti.push(`${secchio}/${nome}`);
        scrivi(`[foto] ${secchio}/${nome} non c'e' piu' (cancellato dopo l'elenco): saltato.`);
        continue;
      }
      if (contenuto.length === 0) throw new Error(`il file ${secchio}/${nome} e' arrivato vuoto (zero byte)`);
      byte += contenuto.length;
      if (byte > tettoByte) {
        throw new Error(`le foto superano il tetto di ${Math.round(tettoByte / 1024 / 1024)} MB: la copia si ferma prima di riempire il disco. Va deciso dove metterle (docs/backup-restore.md §3)`);
      }
      mkdirSync(dirname(dove), { recursive: true });
      writeFileSync(dove, contenuto);
      file++;
    }
    perSecchio[secchio] = nomi.length;
  }
  if (file === 0) {
    throw new Error(`nessun file in nessun secchio (${secchi.join(', ')}): chiave o secchi sbagliati, una copia vuota non e' una copia`);
  }
  return { file, byte, spariti, perSecchio };
}

async function principale() {
  const cartella = process.argv[2];
  if (!cartella) {
    process.stderr.write('Uso: node scripts/copia-foto.mjs <cartella>\n');
    process.exit(2);
  }
  const base = (process.env.SUPABASE_URL || indirizzoDalDb(process.env.SUPABASE_DB_URL) || '').replace(/\/+$/, '');
  const chiave = process.env.FOTO_CHIAVE_SERVIZIO || '';
  if (!chiave || !base) {
    process.stderr.write(
      `[foto] esito-file-foto: non-configurato — manca ${!chiave ? 'la chiave di servizio (FOTO_CHIAVE_SERVIZIO, dal segreto SUPABASE_SERVICE_ROLE_KEY)' : "l'indirizzo SUPABASE_URL"}. Le foto NON sono in copia.\n`,
    );
    process.exit(3);
  }
  try {
    const tettoByte = tettoDaMb(process.env.FOTO_TETTO_MB);
    const secchi = secchiDaCopiare(process.env.FOTO_SECCHI, (r) => process.stderr.write(`${r}\n`));
    if (secchi.length === 0) throw new Error('nessun secchio pubblico da copiare in FOTO_SECCHI');
    const esito = await copiaFoto({ base, chiave, secchi, cartella: join(cartella), tettoByte });
    const mb = (esito.byte / 1024 / 1024).toFixed(1);
    const spariti = esito.spariti.length ? `; ${esito.spariti.length} spariti fra l'elenco e il download` : '';
    process.stdout.write(`[foto] esito-file-foto: copiati ${esito.file} file (${mb} MB) da ${secchi.join(' ')}${spariti}\n`);
  } catch (e) {
    process.stderr.write(`[foto] esito-file-foto: fallita — ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await principale();
}
