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
 *   FOTO_SECCHI                default «products stories reviews»
 *   FOTO_TETTO_MB              default 3000: oltre, si ferma e lo dice
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

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
 * Separa l'elenco dei secchi e toglie quelli vietati, dicendolo.
 * @param {string | undefined} testo
 * @param {(riga: string) => void} [avvisa]
 * @returns {string[]}
 */
export function secchiDaCopiare(testo, avvisa = () => {}) {
  const chiesti = (testo && testo.trim() ? testo.trim().split(/[\s,]+/) : SECCHI_PREDEFINITI).filter(Boolean);
  return chiesti.filter((s) => {
    if (SECCHI_VIETATI.has(s)) {
      avvisa(`[foto] Il secchio ${s} non si copia mai (documenti d'identita'): saltato.`);
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
 * @param {{ base: string, chiave: string, secchio: string, pagina?: number, fetchFn?: typeof fetch }} opzioni
 * @returns {Promise<string[]>}
 */
export async function elencaSecchio({ base, chiave, secchio, pagina = 1000, fetchFn = fetch }) {
  const file = [];
  const daVisitare = [''];
  while (daVisitare.length) {
    const prefisso = daVisitare.shift();
    for (let offset = 0; ; offset += pagina) {
      const risposta = await fetchFn(`${base}/storage/v1/object/list/${encodeURIComponent(secchio)}`, {
        method: 'POST',
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
        else file.push(nome);
      }
      if (voci.length < pagina) break;
    }
  }
  return file;
}

async function scaricaUno({ base, chiave, secchio, nome, fetchFn, tentativi = 3 }) {
  let ultimo = '';
  for (let i = 0; i < tentativi; i++) {
    try {
      const r = await fetchFn(`${base}/storage/v1/object/${encodeURIComponent(secchio)}/${codifica(nome)}`, {
        headers: intestazioni(chiave),
      });
      if (r.ok) return Buffer.from(await r.arrayBuffer());
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
 *   tettoByte?: number, fetchFn?: typeof fetch, scrivi?: (riga: string) => void }} opzioni
 * @returns {Promise<{ file: number, byte: number, perSecchio: Record<string, number> }>}
 */
export async function copiaFoto({
  base,
  chiave,
  secchi,
  cartella,
  pagina = 1000,
  tettoByte = 3000 * 1024 * 1024,
  fetchFn = fetch,
  scrivi = (r) => {
    process.stdout.write(`${r}\n`);
  },
}) {
  if (!base) throw new Error('manca l indirizzo di Supabase (SUPABASE_URL)');
  if (!chiave) throw new Error('manca la chiave di servizio (FOTO_CHIAVE_SERVIZIO)');
  const radice = resolve(cartella);
  let file = 0;
  let byte = 0;
  const perSecchio = {};
  for (const secchio of secchi) {
    if (SECCHI_VIETATI.has(secchio)) throw new Error(`il secchio ${secchio} non si copia mai`);
    const nomi = await elencaSecchio({ base, chiave, secchio, pagina, fetchFn });
    scrivi(`[foto] ${secchio}: ${nomi.length} file da scaricare`);
    for (const nome of nomi) {
      const dove = resolve(radice, secchio, nome);
      if (!dove.startsWith(radice + sep)) throw new Error(`nome di file fuori dalla cartella: ${secchio}/${nome}`);
      const contenuto = await scaricaUno({ base, chiave, secchio, nome, fetchFn });
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
  return { file, byte, perSecchio };
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
  const secchi = secchiDaCopiare(process.env.FOTO_SECCHI, (r) => process.stderr.write(`${r}\n`));
  const tettoMb = Number(process.env.FOTO_TETTO_MB || 3000);
  try {
    const esito = await copiaFoto({ base, chiave, secchi, cartella: join(cartella), tettoByte: tettoMb * 1024 * 1024 });
    const mb = (esito.byte / 1024 / 1024).toFixed(1);
    process.stdout.write(`[foto] esito-file-foto: copiati ${esito.file} file (${mb} MB) da ${secchi.join(' ')}\n`);
  } catch (e) {
    process.stderr.write(`[foto] esito-file-foto: fallita — ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await principale();
}
