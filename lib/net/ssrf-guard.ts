import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * Guard anti-SSRF per i fetch server-side di URL forniti dall'utente
 * (es. rehost delle immagini importate da un marketplace esterno).
 *
 * Meccanismo (allow-list per costruzione): prima di ogni richiesta risolviamo
 * l'host e RIFIUTIAMO qualunque destinazione che non sia un IP pubblico
 * instradabile — loopback, reti private RFC1918, link-local 169.254/16 (incl.
 * gli endpoint metadata cloud), CGNAT, ULA IPv6, ecc. I redirect sono seguiti
 * manualmente e ri-validati hop per hop, così un 3xx non può puntare a un
 * indirizzo interno.
 *
 * Limite noto (stop-gap dichiarato): tra la risoluzione DNS qui e la
 * risoluzione che fa `fetch` esiste una finestra di DNS-rebinding (il fetch
 * ri-risolve l'host). La chiusura definitiva richiede di pinnare l'IP risolto
 * tramite un `https.Agent` con `lookup` custom. Questo guard blocca i casi
 * diretti (URL → IP interno) e redirect-based, che coprono l'abuso pratico.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/** Resolver DNS iniettabile (per i test). Compatibile con dns/promises.lookup(all:true). */
export type DnsResolver = (
  hostname: string,
  opts: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: DnsResolver = (hostname, opts) => dnsLookup(hostname, opts);

/** Hostname palesemente interni, bloccati senza nemmeno risolverli. */
const BLOCKED_HOST_RE = /^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

const DEFAULT_HEADERS: Record<string, string> = {
  // Alcuni CDN rifiutano la user-agent di default di fetch/undici.
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  accept: 'image/avif,image/webp,image/png,image/jpeg,*/*',
};

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const o = Number(p);
    if (o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function inCidr(n: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (n & mask) === (b & mask);
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // non parsabile → blocca per sicurezza
  return (
    inCidr(n, '0.0.0.0', 8) || // "this network"
    inCidr(n, '10.0.0.0', 8) || // private
    inCidr(n, '100.64.0.0', 10) || // CGNAT
    inCidr(n, '127.0.0.0', 8) || // loopback
    inCidr(n, '169.254.0.0', 16) || // link-local + metadata cloud (169.254.169.254)
    inCidr(n, '172.16.0.0', 12) || // private
    inCidr(n, '192.0.0.0', 24) || // IETF protocol assignments
    inCidr(n, '192.0.2.0', 24) || // TEST-NET-1
    inCidr(n, '192.168.0.0', 16) || // private
    inCidr(n, '198.18.0.0', 15) || // benchmarking
    inCidr(n, '240.0.0.0', 4) || // reserved (incl. 255.255.255.255 broadcast)
    n === 0xffffffff
  );
}

function isBlockedIPv6(raw: string): boolean {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped (::ffff:a.b.c.d) → valuta la parte IPv4.
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (ip === '::1' || ip === '::') return true; // loopback / unspecified
  if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
  if (/^f[cd]/.test(ip)) return true; // ULA fc00::/7
  return false;
}

function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return isBlockedIPv4(ip);
  if (v === 6) return isBlockedIPv6(ip);
  return true; // non è un IP valido → blocca
}

/**
 * Valida che `raw` sia un URL http(s) la cui destinazione è un IP pubblico
 * instradabile. Lancia `SsrfBlockedError` altrimenti. Ritorna l'URL parsato.
 */
export async function assertSafePublicUrl(
  raw: string,
  resolver: DnsResolver = defaultResolver,
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfBlockedError('URL non valido');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SsrfBlockedError(`schema non consentito: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_HOST_RE.test(host)) {
    throw new SsrfBlockedError(`host interno non consentito: ${host}`);
  }

  let ips: string[];
  if (net.isIP(host)) {
    ips = [host];
  } else {
    let resolved: Array<{ address: string }>;
    try {
      resolved = await resolver(host, { all: true });
    } catch {
      throw new SsrfBlockedError(`risoluzione DNS fallita per ${host}`);
    }
    ips = resolved.map((r) => r.address);
    if (ips.length === 0) throw new SsrfBlockedError(`nessun indirizzo per ${host}`);
  }

  for (const ip of ips) {
    if (isBlockedIp(ip)) throw new SsrfBlockedError(`indirizzo non instradabile: ${ip}`);
  }
  return u;
}

/**
 * `fetch` SSRF-safe pensato per scaricare immagini: valida l'URL (e ogni hop di
 * redirect) con `assertSafePublicUrl`, usa `redirect: 'manual'` e segue al
 * massimo `maxHops` redirect ri-validati. Timeout obbligatorio.
 */
export async function safeImageFetch(
  raw: string,
  opts: { timeoutMs: number; maxHops?: number; resolver?: DnsResolver },
): Promise<Response> {
  const maxHops = opts.maxHops ?? 3;
  let current = (await assertSafePublicUrl(raw, opts.resolver)).toString();

  for (let hop = 0; ; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: DEFAULT_HEADERS,
    });

    if (res.status >= 300 && res.status < 400) {
      if (hop >= maxHops) throw new SsrfBlockedError('troppi redirect');
      const loc = res.headers.get('location');
      if (!loc) return res; // 3xx senza Location: lascia decidere al chiamante
      const next = new URL(loc, current).toString();
      current = (await assertSafePublicUrl(next, opts.resolver)).toString();
      continue;
    }
    return res;
  }
}
