// La rete, con le cinture: si aprono solo pagine pubbliche su http(s), mai indirizzi interni.
// Le pagine da aprire arrivano da OpenStreetMap o dalla ricerca dell'AD, cioè da testi che chiunque può
// scrivere: per questo ogni indirizzo (e ogni rinvio) passa dal controllo prima di partire.
// Il collaudo del 26/11 ha mostrato che controllare il nome e poi aprirlo con fetch lascia un buco (il dominio
// può cambiare indirizzo fra le due cose): adesso il controllo sta dentro la connessione (`lookup` di Node),
// sull'indirizzo che si usa davvero.

import { lookup as dnsLookup } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

const V4_PRIVATI: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24], [0xe0000000, 3],
];
const v4Numero = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
const v4Privato = (ip: string) => {
  const n = v4Numero(ip);
  return V4_PRIVATI.some(([rete, bit]) => (n >>> (32 - bit)) === (rete >>> (32 - bit)));
};

/** Gli otto gruppi di un IPv6 (null se non si legge). Gestisce «::» e l'IPv4 in coda. */
function v6Gruppi(ip: string): number[] | null {
  let t = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const v4 = t.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) { const n = v4Numero(v4[1]); t = t.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`; }
  const [a, b] = t.split('::');
  if (t.split('::').length > 2) return null;
  const sx = a ? a.split(':') : [];
  const dx = b !== undefined ? (b ? b.split(':') : []) : [];
  const mancano = 8 - sx.length - dx.length;
  if (b === undefined && sx.length !== 8) return null;
  const tutti = [...sx, ...Array(Math.max(0, mancano)).fill('0'), ...dx].map((g) => parseInt(g || '0', 16));
  return tutti.length === 8 && tutti.every((g) => Number.isFinite(g) && g >= 0 && g <= 0xffff) ? tutti : null;
}

/** Un indirizzo che non si apre mai: privato, locale, riservato, o un IPv4 interno nascosto dentro un IPv6. */
export function ipNonPubblico(ip: string): boolean {
  if (isIP(ip) === 4) return v4Privato(ip);
  const g = v6Gruppi(ip);
  if (!g) return true;
  const v4dentro = (alto: number, basso: number) => v4Privato(`${alto >> 8}.${alto & 255}.${basso >> 8}.${basso & 255}`);
  if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 e gli IPv4 «compatibili» (::a.b.c.d)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4dentro(g[6], g[7]); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64 (64:ff9b::/96 e /48)
  if (g[0] === 0x2002) return true; // 6to4: mai, porta a un IPv4 scelto da chi scrive
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentazione
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 locali unici
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 collegamento locale
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 vecchi locali
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** L'indirizzo, se si può aprire: http(s), porta normale, nome di dominio vero (niente IP, niente nomi interni). */
export function indirizzoSicuro(testo: string): URL | null {
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(testo) ? testo : `https://${testo}`); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  if (u.username || u.password) return null;
  if (u.port && !['80', '443'].includes(u.port)) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || isIP(host.replace(/^\[|\]$/g, ''))) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(host)) return null;
  return u;
}

/** La risoluzione dei nomi usata dentro la connessione: se anche uno solo degli indirizzi non è pubblico, niente. */
export const lookupSicuro: LookupFunction = (host, opzioni, fatto) => {
  dnsLookup(host, { ...(typeof opzioni === 'object' ? opzioni : {}), all: true, verbatim: true }, (err, indirizzi) => {
    if (err) return (fatto as (e: NodeJS.ErrnoException | null, a: string | never[], f?: number) => void)(err, []);
    const lista = (Array.isArray(indirizzi) ? indirizzi : [indirizzi]) as { address: string; family: number }[];
    if (!lista.length || lista.some((a) => ipNonPubblico(a.address))) {
      const e = Object.assign(new Error('indirizzo non pubblico'), { code: 'EINTERNO' }) as NodeJS.ErrnoException;
      return (fatto as (e: NodeJS.ErrnoException | null, a: string | never[], f?: number) => void)(e, []);
    }
    const tutti = typeof opzioni === 'object' && (opzioni as { all?: boolean }).all;
    if (tutti) return (fatto as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, lista);
    return (fatto as (e: null, a: string, f: number) => void)(null, lista[0].address, lista[0].family);
  });
};

export type Pagina = { ok: boolean; stato: number | null; url: string; html: string; errore: string | null; ms: number };

/** Una richiesta GET, senza seguire i rinvii, con la risoluzione sicura. */
function prendi(u: URL, segnale: AbortSignal, maxByte: number): Promise<{ stato: number; dove: string | null; tipo: string; corpo: string }> {
  return new Promise((ok, ko) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, {
      method: 'GET', lookup: lookupSicuro, signal: segnale,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MyCity-SchedaVenditore/1.0; +https://www.mycity.it)',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'it-IT,it;q=0.9', 'accept-encoding': 'identity',
      },
    }, (res: IncomingMessage) => {
      const stato = res.statusCode ?? 0;
      const dove = typeof res.headers.location === 'string' ? res.headers.location : null;
      const tipo = String(res.headers['content-type'] ?? '');
      if ((stato >= 300 && stato < 400) || (tipo && !/html|xml|text\/plain/i.test(tipo))) { res.resume(); ok({ stato, dove, tipo, corpo: '' }); return; }
      const pezzi: Buffer[] = [];
      let letti = 0;
      res.on('data', (b: Buffer) => { letti += b.length; if (letti <= maxByte) pezzi.push(b); else { pezzi.push(b.subarray(0, Math.max(0, maxByte - (letti - b.length)))); res.destroy(); } });
      const finisci = () => ok({ stato, dove, tipo, corpo: Buffer.concat(pezzi).toString('utf8') });
      res.on('end', finisci);
      res.on('close', finisci);
      res.on('error', finisci);
    });
    req.on('error', ko);
    req.end();
  });
}

/** Apre una pagina pubblica: al massimo 4 rinvii, `maxByte` di testo, `attesaMs` in tutto. */
export async function leggiPagina(indirizzo: string, { attesaMs = 4500, maxByte = 1_500_000 } = {}): Promise<Pagina> {
  const inizio = Date.now();
  const fine = (p: Partial<Pagina>): Pagina => ({ ok: false, stato: null, url: indirizzo, html: '', errore: null, ms: Date.now() - inizio, ...p });
  let u = indirizzoSicuro(indirizzo);
  if (!u) return fine({ errore: 'indirizzo non ammesso' });
  const segnale = AbortSignal.timeout(attesaMs);
  try {
    for (let giro = 0; giro < 5; giro++) {
      const r = await prendi(u, segnale, maxByte);
      if (r.stato >= 300 && r.stato < 400 && r.dove) {
        const prossimo = indirizzoSicuro(new URL(r.dove, u).toString());
        if (!prossimo) return fine({ url: u.toString(), stato: r.stato, errore: 'rinvio verso un indirizzo non ammesso' });
        u = prossimo;
        continue;
      }
      if (r.tipo && !/html|xml|text\/plain/i.test(r.tipo)) return fine({ url: u.toString(), stato: r.stato, errore: 'non è una pagina web' });
      const okHttp = r.stato >= 200 && r.stato < 300;
      return fine({ ok: okHttp, stato: r.stato, url: u.toString(), html: r.corpo, errore: okHttp ? null : `risposta ${r.stato}` });
    }
    return fine({ url: u.toString(), errore: 'troppi rinvii' });
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const msg = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'non risponde in tempo'
      : err?.code === 'EINTERNO' ? 'il dominio porta a un indirizzo interno'
      : err?.code === 'ENOTFOUND' ? 'il dominio non si trova' : 'non si apre';
    return fine({ url: u?.toString() ?? indirizzo, errore: msg });
  }
}
