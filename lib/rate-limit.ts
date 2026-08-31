/**
 * Rate limiter sliding-window — adapter pattern.
 *
 * ⚠️ SU VERCEL UPSTASH NON E' PIU' UN OPZIONALE.
 *
 * Questo file nasce quando il sito girava su Render: UNA macchina accesa, un
 * solo contatore in memoria, e il freno funzionava come dice il numero scritto
 * nel codice. Su Vercel non esiste «la macchina»: ogni richiesta puo' finire su
 * una copia diversa, e ogni copia parte con i contatori vuoti. «Dieci tentativi
 * di accesso al minuto» diventa dieci PER COPIA — e le copie le decide il
 * traffico, non noi. Chi vuole forzare una password non deve nemmeno saperlo:
 * gli basta bussare tanto.
 *
 * Quindi: senza UPSTASH_REDIS_REST_URL/TOKEN il freno non e' rotto, e' molto
 * piu' largo di quanto sembri. In produzione le due variabili vanno messe. La
 * rotta /api/health lo dichiara «degradato» se mancano, cosi' la cosa si vede
 * invece di restare un'ipotesi in un commento.
 *
 * Esperti consultati:
 * - SRE: "In-memory funzionava su singola istanza Render. Su serverless serve
 *   Upstash Redis REST API (HTTP, no socket). Fallback automatico a in-memory
 *   se Upstash non configurato."
 * - Security Engineer: "Rate limit DEVE proteggere comunque, anche se Redis
 *   e' giu'. Fail-open su Redis error = fail su in-memory locale, mai aperto."
 *
 * Uso:
 *   const rl = await rateLimit({ key: `signin:${ip}`, max: 10, windowMs: 60_000 });
 *   if (!rl.allowed) return ApiErrors.rateLimited(rl.retryAfterSec);
 *
 * 22/8/2026 — IL COMMENTO QUI SOPRA DICEVA UNA COSA FALSA.
 *
 * Diceva che la versione sincrona restava «per non rompere i 25+ callsite».
 * Contati: i chiamanti della sincrona erano UNO (app/api/health/route.ts), e
 * quelli della versione con Redis quarantadue. Il commento raccontava un
 * mondo che non esisteva più, e chi lo leggeva ne concludeva che la sincrona
 * fosse la strada normale — mentre la sincrona conta in memoria del singolo
 * processo, quindi con più istanze ognuna ha il suo contatore e il freno di
 * fatto non c'è.
 *
 * L'ultimo chiamante è passato a `rateLimitAsync`. La sincrona resta viva
 * perché è il ripiego che `rateLimitAsync` usa quando Redis non risponde, ma
 * non è più esportata: da fuori si passa solo dalla porta giusta.
 */

type Bucket = { times: number[] };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000;

/**
 * #237 — La pulizia che non puliva.
 *
 * Prima si cancellavano solo le chiavi ferme da piu' di un'ora. Sotto attacco
 * — cinquantamila indirizzi diversi in pochi minuti — nessuna chiave e' vecchia
 * di un'ora: il ciclo scorreva tutte e cinquantamila senza cancellarne una, e
 * lo faceva a OGNI nuova chiave. Il freno anti-abuso diventava il modo piu'
 * comodo per consumare memoria e tempo di calcolo: esattamente il danno che
 * doveva impedire.
 *
 * Ora si cancella per anzianita' — le chiavi col colpo piu' vecchio per prime —
 * fino a rientrare sotto il tetto, sempre. E si scende sotto la soglia di un
 * buon margine, cosi' la pulizia non riparte a ogni inserimento.
 */
const QUOTA_DA_LIBERARE = 0.1; // si libera il 10% quando si tocca il tetto

function gcIfNeeded() {
  if (buckets.size <= MAX_KEYS) return;
  const daTogliere = Math.max(1, Math.ceil(MAX_KEYS * QUOTA_DA_LIBERARE));
  const perAnzianita = Array.from(buckets.entries())
    .map(([key, b]) => ({ key, ultimo: b.times.length > 0 ? b.times[b.times.length - 1] : 0 }))
    .sort((a, b) => a.ultimo - b.ultimo);
  for (let i = 0; i < daTogliere && i < perAnzianita.length; i++) {
    buckets.delete(perAnzianita[i].key);
  }
}

export type RateLimitOptions = {
  key: string;
  max: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
};

// Contatore in memoria del singolo processo. NON esportato apposta: è il
// ripiego interno di rateLimitAsync quando Redis non risponde, non una strada
// che si sceglie da fuori.
function rateLimit({ key, max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const since = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { times: [] };
    buckets.set(key, bucket);
    gcIfNeeded();
  }
  bucket.times = bucket.times.filter((t) => t > since);

  if (bucket.times.length >= max) {
    const oldest = bucket.times[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec: retryAfter, limit: max };
  }

  bucket.times.push(now);
  return {
    allowed: true,
    remaining: max - bucket.times.length,
    retryAfterSec: 0,
    limit: max,
  };
}

/**
 * Reset dei bucket in-memory. SOLO per test isolation (vitest beforeEach).
 * In produzione non va mai chiamato: il GC interno (MAX_KEYS) gestisce
 * la cleanup automatica.
 */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
}

// =============================================================================
// UPSTASH REDIS ADAPTER (production multi-instance)
// =============================================================================
//
// Pattern: fixed window con counter atomico. Piu' semplice di sliding window
// ma piu' veloce (1 INCR vs N filter). Acceptable trade-off per il marketplace.
//
// Se UPSTASH_REDIS_REST_URL non e' configurato, fallback automatico a
// in-memory. Zero changes per il caller.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

import { logger } from '@/lib/logger';
import { segretiCombaciano } from '@/lib/api/segreti';

/**
 * QUANDO IL FRENO SI ALLARGA, ADESSO LO DICE.
 *
 * Radiografia del 27/8/2026 (R190). Se Upstash non rispondeva, questa funzione
 * restituiva `null` e il freno anti-abuso ripiegava sul contatore in memoria.
 * Il ripiego e' la scelta giusta — meglio un freno largo che nessun freno — ma
 * avveniva in perfetto silenzio: su Vercel «in memoria» vuol dire un contatore
 * per ogni copia, cioe' il limite scritto nel codice moltiplicato per quante
 * copie sono accese. Nessuno poteva sapere che stava succedendo, ne' per
 * quanto tempo era durato.
 *
 * Non si registra ogni singolo ripiego: quando Upstash cade, cade per tutte le
 * richieste, e una riga a testa riempirebbe i registri proprio nel momento in
 * cui servono leggibili. Si registra la prima, e poi una ogni cento.
 */
let ripieghiInMemoria = 0;

/** Quante volte si e' ripiegato sul contatore locale da quando gira il processo. */
export function ripieghiDelFrenoDiRete(): number {
  return ripieghiInMemoria;
}

/** Solo per le prove: rimette il conto a zero. */
export function __azzeraRipieghiFreno(): void {
  ripieghiInMemoria = 0;
}

function segnalaRipiego(motivo: string): null {
  ripieghiInMemoria++;
  if (ripieghiInMemoria === 1 || ripieghiInMemoria % 100 === 0) {
    logger.warn('[freno] Upstash non risponde: conto le richieste in memoria, il limite reale e piu largo', {
      motivo,
      ripieghi: ripieghiInMemoria,
    });
  }
  return null;
}

async function upstashIncr(key: string, ttlSec: number): Promise<number | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    // Pipeline: INCR + EXPIRE atomici via Upstash batch endpoint
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', `rl:${key}`],
        ['EXPIRE', `rl:${key}`, String(ttlSec), 'NX'],
      ]),
      // Timeout breve: rate limit deve essere fast-path
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return segnalaRipiego(`Upstash ha risposto HTTP ${res.status}`);
    const data: Array<{ result: number | string }> = await res.json();
    const count = Number(data[0]?.result);
    if (Number.isFinite(count)) return count;
    return segnalaRipiego('Upstash ha risposto qualcosa che non e un numero');
  } catch (e) {
    return segnalaRipiego(e instanceof Error ? e.message : 'errore di rete');
  }
}

/**
 * Async version con fallback automatico a in-memory.
 *
 * Usare per endpoint critical-path (signin, signup, checkout) dove il rate
 * limit deve sopravvivere al restart container e scale-out.
 */
export async function rateLimitAsync(opts: RateLimitOptions): Promise<RateLimitResult> {
  const ttlSec = Math.ceil(opts.windowMs / 1000);

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const count = await upstashIncr(opts.key, ttlSec);
    if (count !== null) {
      const allowed = count <= opts.max;
      return {
        allowed,
        remaining: Math.max(0, opts.max - count),
        retryAfterSec: allowed ? 0 : ttlSec,
        limit: opts.max,
      };
    }
    // Fallback se Upstash unreachable: usa in-memory locale invece di
    // fail-open (mai lasciare il marketplace senza rate limit).
  }

  return rateLimit(opts);
}

/**
 * 31/8/2026 (R003/R020, ricaduta) — GUARDARE IL CONTATORE SENZA FARLO SALIRE.
 *
 * Serve quando il freno deve contare solo una parte delle richieste — per
 * esempio i tentativi andati a vuoto — ma deve poter fermare tutti gli altri
 * prima di spendere qualcosa. Senza questa lettura le due cose non stanno
 * insieme: o si conta tutto (e chi e' entrato regolarmente paga per chi bussa a
 * vuoto), o non si ferma niente prima di aver pagato le chiamate di rete.
 *
 * `allowed: false` vuol dire «il secchio e' gia' pieno», non «ho aggiunto una
 * goccia»: chi chiama questa non ha ancora contato niente.
 */
export async function contatoreGiaAlTetto(opts: RateLimitOptions): Promise<RateLimitResult> {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    const count = await upstashLeggi(opts.key);
    if (count !== null) {
      const allowed = count < opts.max;
      return {
        allowed,
        remaining: Math.max(0, opts.max - count),
        retryAfterSec: allowed ? 0 : Math.ceil(opts.windowMs / 1000),
        limit: opts.max,
      };
    }
  }
  return letturaInMemoria(opts);
}

/** Il contatore in memoria, letto senza toccarlo. */
function letturaInMemoria({ key, max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const since = now - windowMs;
  const times = (buckets.get(key)?.times ?? []).filter((t) => t > since);

  if (times.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec: retryAfter, limit: max };
  }
  return { allowed: true, remaining: max - times.length, retryAfterSec: 0, limit: max };
}

/** Una chiave mai vista non e' un guasto: e' zero richieste. */
async function upstashLeggi(key: string): Promise<number | null> {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(`rl:${key}`)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return segnalaRipiego(`Upstash ha risposto HTTP ${res.status} in lettura`);
    const data: { result?: string | number | null } = await res.json();
    if (data.result === null || data.result === undefined) return 0;
    const count = Number(data.result);
    if (Number.isFinite(count)) return count;
    return segnalaRipiego('Upstash ha risposto qualcosa che non e un numero in lettura');
  } catch (e) {
    return segnalaRipiego(e instanceof Error ? e.message : 'errore di rete in lettura');
  }
}

/**
 * Quanti proxy fidati stanno davanti all'applicazione. In produzione ce n'è uno
 * (l'ingresso della piattaforma). Se un giorno se ne aggiunge un altro — per
 * esempio un CDN davanti — si alza questo numero via variabile d'ambiente,
 * senza toccare il codice.
 *
 * ⚠️ Su Vercel questo numero va lasciato a 1. Vercel RISCRIVE `x-forwarded-for`
 * con l'indirizzo vero di chi chiama e non ci lascia passare quello che il
 * chiamante si è scritto da solo: la catena arriva qui con una voce sola, che è
 * già quella giusta. Alzare il numero non renderebbe niente più sicuro — farebbe
 * solo leggere una posizione che non esiste, e il ripiego finirebbe per contare
 * tutti insieme sotto la stessa chiave.
 */
const PROXY_FIDATI = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS ?? '1') || 1);

// =============================================================================
// CHI DELLA CATENA E' NOSTRO E CHI NO
// =============================================================================
//
// 31/8/2026 (R018, ricaduta) — vedi il commento lungo dentro getClientIp.

/** Un indirizzo IPv4 come numero, oppure null se non e' un IPv4. */
function numeroIPv4(ip: string): number | null {
  const pezzi = ip.split('.');
  if (pezzi.length !== 4) return null;
  let n = 0;
  for (const pezzo of pezzi) {
    if (!/^\d{1,3}$/.test(pezzo)) return null;
    const v = Number(pezzo);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

/**
 * Un indirizzo IPv6 come i suoi otto gruppi da sedici bit, oppure null se non
 * e' un IPv6. Otto numeri e non un numero solo perche' `tsconfig` prende di
 * mira es2017, dove i numeri grandi (`BigInt`) non ci sono.
 */
function numeroIPv6(ip: string): number[] | null {
  const pulito = ip.split('%')[0].toLowerCase();
  if (!pulito.includes(':')) return null;
  const meta = pulito.split('::');
  if (meta.length > 2) return null;
  const sinistra = meta[0] ? meta[0].split(':') : [];
  const destra = meta.length === 2 && meta[1] ? meta[1].split(':') : [];
  const mancanti = 8 - sinistra.length - destra.length;
  if (meta.length === 1 ? mancanti !== 0 : mancanti < 0) return null;
  const gruppi = [...sinistra, ...Array<string>(meta.length === 2 ? mancanti : 0).fill('0'), ...destra];
  const numeri: number[] = [];
  for (const g of gruppi) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    numeri.push(parseInt(g, 16));
  }
  return numeri;
}

/** `::ffff:1.2.3.4` e' un IPv4 travestito: si guarda quello. */
function svestiIPv4(ip: string): string {
  const travestito = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return travestito ? travestito[1] : ip;
}

function dentroLaRete(ip: string, rete: string): boolean {
  const [base, bitTesto] = rete.split('/');
  const bit = Number(bitTesto);

  const v4 = numeroIPv4(ip);
  if (v4 !== null) {
    const baseV4 = numeroIPv4(base);
    if (baseV4 === null) return false;
    const maschera = bit === 0 ? 0 : (0xffffffff << (32 - bit)) >>> 0;
    return ((v4 & maschera) >>> 0) === ((baseV4 & maschera) >>> 0);
  }

  const v6 = numeroIPv6(ip);
  const baseV6 = numeroIPv6(base);
  if (v6 === null || baseV6 === null) return false;
  for (let g = 0; g < 8; g++) {
    const bitRimasti = bit - g * 16;
    if (bitRimasti <= 0) return true;
    const larghezza = Math.min(16, bitRimasti);
    const maschera = larghezza === 16 ? 0xffff : (0xffff << (16 - larghezza)) & 0xffff;
    if ((v6[g] & maschera) !== (baseV6[g] & maschera)) return false;
  }
  return true;
}

/**
 * Le reti che nessuno puo' avere venendo da internet: sono la nostra idraulica
 * interna, i salti che si passano la richiesta dentro casa nostra.
 */
const RETI_DI_CASA = [
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', // RFC1918
  '127.0.0.0/8', '169.254.0.0/16', '0.0.0.0/8',    // loopback, link-local, «questa rete»
  '::1/128', 'fc00::/7', 'fe80::/10',              // gli stessi in IPv6
];

function eIdraulicaDiCasa(pezzo: string): boolean {
  const ip = svestiIPv4(pezzo);
  if (numeroIPv4(ip) === null && numeroIPv6(ip) === null) return false;
  return RETI_DI_CASA.some((rete) => dentroLaRete(ip, rete));
}

/**
 * Le reti da cui Cloudflare esce quando parla con l'origine. Sono pubblicate da
 * loro (cloudflare.com/ips) e cambiano molto di rado.
 */
const RETI_DI_CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

function eDiCloudflare(pezzo: string): boolean {
  const ip = svestiIPv4(pezzo);
  return RETI_DI_CLOUDFLARE.some((rete) => dentroLaRete(ip, rete));
}

/**
 * L'ultimo salto che il nostro bordo ha visto arrivare da fuori.
 *
 * Si guarda la catena da destra e si scartano i pezzi di idraulica interna: da
 * internet nessuno puo' presentarsi con un indirizzo privato, quindi quei pezzi
 * li ha scritti la nostra infrastruttura passandosi la richiesta. Il primo
 * pezzo pubblico che si incontra e' l'indirizzo che il nostro bordo ha visto:
 * la persona, se davanti non c'e' nessuno, oppure il CDN.
 *
 * Se la catena e' TUTTA di casa — sviluppo in locale, chiamata interna — non si
 * scarta niente e si torna al conto di prima.
 */
function indiceDelSaltoEsterno(catena: string[]): number {
  for (let i = catena.length - 1; i >= 0; i--) {
    if (!eIdraulicaDiCasa(catena[i])) return i;
  }
  return catena.length - 1;
}

/**
 * L'indirizzo di chi sta chiamando davvero.
 *
 * Perché non si legge il primo pezzo dell'intestazione: `x-forwarded-for` è una
 * catena, e ogni proxy AGGIUNGE IN CODA l'indirizzo da cui ha ricevuto. Il primo
 * pezzo è quindi quello che ha scritto il chiamante, che può inventarselo: con
 * `X-Forwarded-For: <numero casuale>` a ogni richiesta si otteneva un contatore
 * nuovo ogni volta, e il limite sui tentativi di accesso non contava più nulla.
 *
 * Su Vercel quel buco è chiuso anche a monte — la piattaforma riscrive
 * l'intestazione e butta via quello che ha scritto il chiamante — ma la lettura
 * da destra si tiene: costa niente, dà lo stesso risultato, e resta giusta il
 * giorno in cui davanti al sito ci finisce un CDN.
 *
 * Si legge invece da destra, scartando prima i salti della nostra idraulica
 * interna (gli indirizzi privati, che da internet nessuno può avere) e poi i
 * proxy fidati dichiarati: quello è l'indirizzo scritto dalla nostra
 * infrastruttura, che il chiamante non può falsificare.
 */
export function getClientIp(req: Request): string {
  /**
   * 22/8/2026 — DIETRO CLOUDFLARE SI LEGGEVA L'INDIRIZZO SBAGLIATO.
   *
   * Con un CDN davanti, la catena `x-forwarded-for` ha due salti invece di uno,
   * e questo conto — che ne scarta uno solo — restituiva l'indirizzo del CDN.
   * Tutti i visitatori diventavano lo stesso indirizzo: il freno anti-abuso
   * scattava su tutti insieme dopo poche richieste, e le visite venivano
   * buttate come se fossero un attacco.
   *
   * Cloudflare scrive l'indirizzo vero in un'intestazione sua,
   * `cf-connecting-ip`, che aggiunge lui e che il chiamante non puo'
   * falsificare: quando c'e', e' la risposta piu' affidabile che abbiamo. Se
   * non c'e', resta il conto di prima, che e' quello giusto senza CDN.
   */
  /**
   * 27/8/2026 (R018) — QUELL'INTESTAZIONE ERA CREDUTA SULLA PAROLA.
   *
   * `cf-connecting-ip` e' affidabile SOLO se la richiesta e' passata davvero
   * da Cloudflare. Ma l'origine Vercel e' raggiungibile diritta — non serve
   * saperne l'indirizzo, basta il nome del sito — e chi arriva di li' quella
   * riga se la scrive da solo. Cambiandola a ogni richiesta diventa un
   * visitatore nuovo ogni volta, e nessun contatore arriva mai al suo tetto:
   * diecimila tentativi di accesso al minuto contati come diecimila persone.
   * Cioe' tutti i freni per indirizzo del sito, azzerati da una riga di
   * intestazione.
   *
   * Ignorarla non costa niente, ed e' il punto: su Vercel `x-forwarded-for`
   * la riscrive la piattaforma con l'indirizzo vero e butta via quello che il
   * chiamante si e' messo (sta scritto nel commento di TRUSTED_PROXY_HOPS qui
   * sopra). Il ripiego e' quindi la fonte piu' solida che abbiamo, non una
   * seconda scelta.
   *
   * Per chi Cloudflare ce l'ha davvero davanti resta la strada onesta: una
   * regola di bordo che aggiunge `x-edge-token` con un segreto condiviso.
   * Quando combacia con `EDGE_TRUST_SECRET`, allora quella riga l'ha scritta
   * Cloudflare e vale.
   */
  /**
   * 31/8/2026 (R018, RICADUTA) — QUEL SEGRETO SI SPEDISCE VUOTO.
   *
   * Ignorare `cf-connecting-ip` senza segreto era giusto. Ma il segreto e'
   * spedito vuoto — `.env.example` dice testualmente che lasciarlo vuoto va
   * bene — e davanti al sito il CDN c'e' davvero (lo dichiara il README). Con
   * la configurazione che spediamo, quindi, si finiva a leggere l'ultimo pezzo
   * della catena, che e' un salto della nostra infrastruttura: uguale per tutti.
   * Tutti i visitatori diventavano lo stesso indirizzo e il freno anti-abuso li
   * contava insieme — testualmente il danno che il commento del 22 agosto qui
   * sopra dice di aver riparato.
   *
   * La regola che regge da sola, senza credere a nessuna intestazione: dalla
   * rete pubblica nessuno puo' presentarsi con un indirizzo privato, quindi i
   * pezzi privati in coda alla catena li ha scritti la nostra infrastruttura e
   * si scartano. Il primo pezzo pubblico venendo da destra e' quello che il
   * nostro bordo ha VISTO arrivare, non quello che il chiamante ha dichiarato:
   * a sinistra c'e' la parte inventabile, e li' non si arriva mai.
   *
   * E quel salto dice anche CHI ci ha parlato. Se e' dentro le reti pubblicate
   * da Cloudflare, allora a parlare e' stato davvero Cloudflare — chi bussa
   * dritto all'origine da casa sua non ha un indirizzo cosi' — e la sua
   * `cf-connecting-ip` e' autentica. Non e' credere sulla parola: e' guardare
   * da dove arriva la voce prima di darle retta.
   */
  const cloudflare = req.headers.get('cf-connecting-ip')?.trim() || null;
  const segretoDiBordo = process.env.EDGE_TRUST_SECRET;
  const colSegreto = !!segretoDiBordo && segretiCombaciano(req.headers.get('x-edge-token'), segretoDiBordo);

  const xff = req.headers.get('x-forwarded-for');
  const catena = xff ? xff.split(',').map((p) => p.trim()).filter(Boolean) : [];
  const esterno = catena.length > 0 ? indiceDelSaltoEsterno(catena) : -1;

  if (cloudflare && (colSegreto || (esterno >= 0 && eDiCloudflare(catena[esterno])))) {
    return cloudflare;
  }

  if (esterno >= 0) {
    // I proxy fidati oltre il primo si scartano ancora a mano: chi ne ha
    // davanti piu' di uno che si presenta con indirizzo pubblico lo dichiara
    // con TRUSTED_PROXY_HOPS.
    const i = Math.max(0, esterno - (PROXY_FIDATI - 1));
    return catena[i] ?? catena[catena.length - 1];
  }

  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}
