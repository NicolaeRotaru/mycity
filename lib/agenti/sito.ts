// LA MISURA DEL SITO — fatta dal programma in 2-4 secondi, prima e mentre l'AD cerca.
// Serve alla tabella firmata «agenzia.sito-solo-dove-vale-di-piu»: c'è il sito? quante pagine? è fatto in casa
// o curato? ha prenotazioni, negozio online, più lingue? Il giudizio sull'aspetto resta all'AD; qui solo
// fatti che il programma legge nella pagina, con la pagina come fonte.

import { leggiPagina } from './rete';

export type LivelloSito = 'nessuno' | 'semplice' | 'medio' | 'pregio';

export type MisuraSito = {
  url: string;
  aperto: boolean;
  /** true: si apre in https · false: https provato e rifiutato, si apre solo in http · null: non si sa. */
  https: boolean | null;
  titolo: string | null;
  descrizione: string | null;
  telefonino: boolean;
  pagine: number;
  funzioni: string[];
  social: { instagram?: string; facebook?: string; tiktok?: string; youtube?: string };
  piattaforma: string | null;
  anno: number | null;
  stima: LivelloSito;
  errore: string | null;
};

const testo = (s: string | undefined | null, max = 200) => {
  const t = String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

const PIATTAFORME: [RegExp, string][] = [
  [/wix\.com|wixstatic|_wixCssImports/i, 'Wix'],
  [/sites\.google\.com|gstatic\.com\/_\/atari/i, 'Google Sites'],
  [/wp-content|wp-includes|wordpress/i, 'WordPress'],
  [/cdn\.shopify|shopify/i, 'Shopify'],
  [/squarespace/i, 'Squarespace'],
  [/jimdo/i, 'Jimdo'],
  [/webflow/i, 'Webflow'],
  [/godaddy|websites\.godaddy/i, 'GoDaddy'],
  [/tilda\.ws|tildacdn/i, 'Tilda'],
  [/site123/i, 'SITE123'],
];

const FUNZIONI: [RegExp, string][] = [
  [/prenot|booking|thefork|quandoo|reserv|calendly|fresha|treatwell/i, 'prenotazioni'],
  [/carrello|add[-_ ]to[-_ ]cart|\/cart\b|woocommerce|checkout|acquista ora|shop online|negozio online/i, 'negozio online'],
  [/\bmen[uù]\b|carta dei vini|listino/i, 'menu o listino'],
  [/wa\.me\/|api\.whatsapp\.com|whatsapp/i, 'WhatsApp'],
  [/<form[^>]*>[\s\S]{0,4000}?(email|messaggio|contatt)/i, 'modulo di contatto'],
  [/hreflang=["'](?!it)[a-z]{2}|\/en\/|lang=["']en/i, 'più lingue'],
];

/** I fatti che si leggono nella pagina iniziale del sito. Funzione pura: la prova la usa con pagine finte. */
export function misuraHtml(html: string, indirizzo: string): Omit<MisuraSito, 'https' | 'aperto' | 'errore'> {
  let base: URL | null = null;
  try { base = new URL(indirizzo); } catch { base = null; }
  const host = base?.hostname.replace(/^www\./, '') ?? '';
  const titolo = testo(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const descrizione = testo(html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
    ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1], 300);
  const telefonino = /<meta[^>]+name=["']viewport["']/i.test(html);
  const interni = new Set<string>();
  const social: MisuraSito['social'] = {};
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const href = m[1].trim();
    let u: URL;
    try { u = new URL(href, base ?? undefined); } catch { continue; }
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === host && /^https?:$/.test(u.protocol)) {
      const p = u.pathname.replace(/\/+$/, '') || '/';
      if (!/\.(jpe?g|png|gif|webp|svg|pdf|css|js|ico|xml|zip|mp4)$/i.test(p) && !/^\/(wp-|feed|cdn-cgi)/.test(p)) interni.add(p);
    }
    const profilo = u.pathname.split('/').filter(Boolean)[0];
    if (!profilo || /^(sharer|share|intent|plugins|dialog|tr|p|reel|explore|hashtag)$/i.test(profilo)) continue;
    if (h === 'instagram.com' && !social.instagram) social.instagram = `https://www.instagram.com/${profilo}/`;
    if ((h === 'facebook.com' || h === 'm.facebook.com') && !social.facebook) social.facebook = `https://www.facebook.com/${u.pathname.replace(/^\/+|\/+$/g, '')}`;
    if (h === 'tiktok.com' && /^@/.test(profilo) && !social.tiktok) social.tiktok = `https://www.tiktok.com/${profilo}`;
    if (h === 'youtube.com' && !social.youtube) social.youtube = `https://www.youtube.com/${u.pathname.replace(/^\/+|\/+$/g, '')}`;
  }
  const generatore = html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)["']/i)?.[1] ?? '';
  const piattaforma = PIATTAFORME.find(([re]) => re.test(generatore) || re.test(html.slice(0, 200_000)))?.[1] ?? null;
  const funzioni = FUNZIONI.filter(([re]) => re.test(html)).map(([, nome]) => nome);
  const anni = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/gi)].map((m) => Number(m[1]));
  const anno = anni.length ? Math.max(...anni) : null;
  const pagine = Math.max(1, interni.size);
  // La stima del programma (la tabella firmata la usa solo se l'AD non ha guardato il sito).
  const annoOggi = new Date().getFullYear();
  const casalingo = piattaforma === 'Google Sites' || piattaforma === 'Jimdo' || piattaforma === 'SITE123' || (anno !== null && anno < annoOggi - 3);
  const funzioniForti = funzioni.filter((f) => ['prenotazioni', 'negozio online', 'più lingue'].includes(f)).length;
  const stima: LivelloSito = pagine >= 12 && funzioniForti >= 2 && telefonino && !casalingo ? 'pregio'
    : pagine <= 2 || casalingo || !telefonino ? 'semplice' : 'medio';
  return { url: base?.toString() ?? indirizzo, titolo, descrizione, telefonino, pagine, funzioni, social, piattaforma, anno, stima };
}

/** Domini che non sono «il sito» dell'attività: social, mappe, elenchi. */
export const NON_E_UN_SITO = /(^|\.)(facebook|instagram|tiktok|youtube|google|goo|linktr|wa|whatsapp|tripadvisor|thefork|justeat|glovoapp|deliveroo|paginegialle|paginebianche|virgilio|yelp|booking|airbnb|matrimonio|sluurpy|restaurantguru|wanderlog)\.[a-z.]+$/i;

export async function misuraSito(indirizzo: string): Promise<MisuraSito> {
  const vuota = (url: string, errore: string): MisuraSito => ({ url, aperto: false, https: null, titolo: null, descrizione: null, telefonino: false,
    pagine: 0, funzioni: [], social: {}, piattaforma: null, anno: null, stima: 'medio', errore });
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(indirizzo) ? indirizzo : `https://${indirizzo}`); } catch { return vuota(indirizzo, 'indirizzo non valido'); }
  if (NON_E_UN_SITO.test(u.hostname)) return vuota(u.toString(), 'è un profilo o un elenco, non il sito dell’attività');
  const sicuro = new URL(u.toString()); sicuro.protocol = 'https:';
  let pagina = await leggiPagina(sicuro.toString());
  let https: boolean | null = pagina.ok ? pagina.url.startsWith('https:') : null;
  // «Non protetto» solo se https è stato provato e non si è aperto (mai per un ritardo), e in http sì.
  if (!pagina.ok && pagina.errore === 'non si apre') {
    const semplice = new URL(sicuro.toString()); semplice.protocol = 'http:';
    const seconda = await leggiPagina(semplice.toString(), { attesaMs: 3000 });
    if (seconda.ok) { pagina = seconda; https = seconda.url.startsWith('https:'); }
  }
  if (!pagina.ok || !pagina.html) return { ...vuota(pagina.url, pagina.errore ?? 'pagina vuota'), https };
  return { ...misuraHtml(pagina.html, pagina.url), aperto: true, https, errore: null };
}

// ———————————————————————————————— il sito che nessuno ha scritto da nessuna parte
//
// La prova vera del 26/11 (La Dolce Dispensa): l'AD vede solo gli estratti della ricerca e non apre le pagine,
// così non ha trovato né il sito né i profili, che esistono. Il programma invece le pagine le apre: prova gli
// indirizzi più probabili (ladolcedispensa.it, …), e tiene un sito solo se la pagina porta il nome
// dell'attività E la città. Dal sito trovato escono anche i profili social che il sito stesso collega.

const ARTICOLI = new Set(['la', 'il', 'lo', 'le', 'i', 'gli', 'l', 'un', 'una', 'al', 'da', 'dal', 'del', 'della']);
// 28/11/2026 — Il Raquel 💗 Cafè: «cafe» contava come parola del nome, e un sito intitolato «Raquel Caffè» veniva
// scartato perché «caffe» non contiene «cafe». Le grafie del caffè e del bar contano tutte come parole comuni.
const GENERICHE = new Set(['bar', 'caffe', 'cafe', 'caffetteria', 'cafeteria', 'coffee', 'bistrot', 'bistro', 'pub', 'lounge',
  'pasticceria', 'ristorante', 'pizzeria', 'trattoria', 'osteria', 'forno', 'panificio',
  'macelleria', 'gelateria', 'enoteca', 'negozio', 'boutique', 'parrucchiere', 'salone', 'centro', 'studio', 'farmacia', 'ottica', 'libreria']);
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' e ').replace(/['’`]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Le parole che distinguono il locale nel suo nome, senza articoli e parole comuni («Raquel 💗 Cafè» → ["raquel"]). */
export function paroleDistintive(nome: string): string[] {
  return slug(nome).split(' ').filter((p) => p.length >= 3 && !ARTICOLI.has(p) && !GENERICHE.has(p));
}

/** Un nome di profilo o un indirizzo porta una parola che distingue il locale? («raquel_cafe23» per «Raquel 💗 Cafè»: sì). */
export function portaIlNome(testoProfilo: string, nome: string): boolean {
  const s = slug(testoProfilo.replace(/[._-]+/g, ' ')).replace(/ /g, '');
  return paroleDistintive(nome).some((p) => p.length >= 4 && s.includes(p));
}

/** Il nome di un profilo social ridotto a una base per il dominio: «@raquel_cafe23» → «raquelcafe23». */
const baseDaProfilo = (profilo: string) => slug(profilo.replace(/^@+/, '').replace(/[._-]+/g, ' ')).replace(/ /g, '');

/**
 * Gli indirizzi da provare per un nome: al massimo 12, i più probabili per primi.
 * 28/11/2026 — Il Raquel 💗 Cafè: si provavano solo 6 indirizzi, mai il nome senza le parole comuni (raquel.it), mai le
 * parole invertite (caferaquel.it), mai il nome del profilo social. `profili` sono i nomi Instagram o TikTok già noti
 * (dal venditore, dall'AD o dalle pagine lette): un locale sceglie spesso lo stesso nome per il sito.
 */
export function candidatiDominio(nome: string, citta = 'Piacenza', profili: string[] = []): string[] {
  const parole = slug(nome).split(' ').filter(Boolean);
  const daProfili = profili.map(baseDaProfilo).filter(Boolean);
  if (!parole.length && !daProfili.length) return [];
  const senzaArticolo = ARTICOLI.has(parole[0]) ? parole.slice(1) : parole;
  const senzaGenere = senzaArticolo.length > 1 && GENERICHE.has(senzaArticolo[0]) ? senzaArticolo.slice(1) : senzaArticolo;
  // Solo le parole che distinguono il locale, in qualunque posizione («Raquel Cafè» → «raquel»).
  const distinte = senzaArticolo.filter((p) => !GENERICHE.has(p));
  const c = slug(citta).replace(/ /g, '');
  const basi = [
    parole.join(''), senzaArticolo.join(''), distinte.join(''),
    ...daProfili, ...daProfili.map((b) => b.replace(/\d+$/, '')),
    parole.join('-'), senzaGenere.join(''),
    senzaArticolo.length === 2 ? [...senzaArticolo].reverse().join('') : '',
    parole.join('') + c, distinte.join('') + c,
  ];
  const uniche = [...new Set(basi)].filter((b) => b.length >= 4 && b.length <= 40 && /[a-z]/.test(b));
  const fuori: string[] = [];
  for (const b of uniche) for (const tld of ['it', 'com']) fuori.push(`${b}.${tld}`);
  return [...new Set(fuori)].slice(0, 12);
}

const PARCHEGGIO = /dominio (in vendita|registrato|acquistato)|domain (is )?for sale|this domain|buy this domain|parked|sedo\.com|coming soon|in costruzione|under construction|website is (being )?built|default web page|it works!/i;

/**
 * La pagina è davvero di questa attività? Nome nelle parti che contano, città nella pagina, niente pagina di parcheggio.
 * `largo`: il nome si cerca in tutta la pagina e non solo nel titolo. Vale per un indirizzo che qualcuno ha già indicato
 * come il sito del locale (il venditore, l'AD, un elenco), mai per un indirizzo solo indovinato.
 */
export function eIlSitoDi(html: string, nome: string, citta = 'Piacenza', { largo = false }: { largo?: boolean } = {}): boolean {
  if (!html || PARCHEGGIO.test(html.slice(0, 60_000))) return false;
  const tutto = slug(html.slice(0, 300_000));
  // Largo: solo il testo che si legge, senza tag, script e indirizzi dei collegamenti (un link a un profilo non è il nome).
  const testa = largo ? slug(html.slice(0, 300_000).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')) : slug([html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], ...[...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:site_name|og:title)["'][^>]*content=["']([^"']*)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]*>/g, ' '))].filter(Boolean).join(' '));
  const parole = paroleDistintive(nome);
  if (!parole.length) return false;
  // Nel titolo basta il pezzo (un titolo «ladolcedispensa.it» vale); in tutta la pagina serve la parola intera,
  // perché in un testo lungo «raquel» può stare dentro un'altra parola.
  const trovate = parole.filter((p) => (largo ? new RegExp(`(^| )${p}( |$)`).test(testa) : testa.includes(p))).length;
  const conCitta = tutto.includes(slug(citta));
  return conCitta && trovate / parole.length >= 0.75;
}

/** Prova gli indirizzi probabili in parallelo, al massimo `attesaMs`. Restituisce la misura del primo che è davvero suo. */
export async function indovinaSito(nome: string | null, citta = 'Piacenza', attesaMs = 3500, profili: string[] = []): Promise<MisuraSito | null> {
  if (!nome) return null;
  const candidati = candidatiDominio(nome, citta, profili);
  if (!candidati.length) return null;
  const prove = await Promise.all(candidati.map(async (d, i) => {
    const pagina = await leggiPagina(`https://${d}/`, { attesaMs, maxByte: 600_000 });
    return pagina.ok && eIlSitoDi(pagina.html, nome, citta) ? { i, pagina } : null;
  }));
  const vinta = prove.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => a.i - b.i)[0];
  if (!vinta) return null;
  return { ...misuraHtml(vinta.pagina.html, vinta.pagina.url), aperto: true, https: vinta.pagina.url.startsWith('https:'), errore: null };
}

/** Come `indovinaSito`, ma prova solo gli indirizzi fatti dai nomi dei profili (quelli dal nome li ha già provati la prima scheda). */
export async function indovinaSitoDaiProfili(nome: string | null, citta = 'Piacenza', profili: string[] = [], attesaMs = 3500): Promise<MisuraSito | null> {
  if (!nome || !profili.length) return null;
  const candidati = candidatiDominio('', citta, profili);
  const prove = await Promise.all(candidati.map(async (d, i) => {
    const pagina = await leggiPagina(`https://${d}/`, { attesaMs, maxByte: 600_000 });
    return pagina.ok && eIlSitoDi(pagina.html, nome, citta) ? { i, pagina } : null;
  }));
  const vinta = prove.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => a.i - b.i)[0];
  if (!vinta) return null;
  return { ...misuraHtml(vinta.pagina.html, vinta.pagina.url), aperto: true, https: vinta.pagina.url.startsWith('https:'), errore: null };
}

/**
 * Un sito che qualcuno ha indicato (il venditore, l'AD, una pagina letta da n8n): si apre, si misura e si controlla
 * che porti il nome e la città del locale (`eIlSitoDi` largo). `null` se non si apre, se è un profilo o un elenco,
 * o se non è suo: un indirizzo sbagliato non deve finire nei canali della vetrina.
 */
export async function sitoIndicato(indirizzo: string, nome: string | null, citta = 'Piacenza'): Promise<MisuraSito | null> {
  if (!nome) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(indirizzo) ? indirizzo : `https://${indirizzo}`); } catch { return null; }
  if (NON_E_UN_SITO.test(u.hostname)) return null;
  const sicuro = new URL(u.toString()); sicuro.protocol = 'https:';
  let pagina = await leggiPagina(sicuro.toString(), { maxByte: 600_000 });
  let https: boolean | null = pagina.ok ? pagina.url.startsWith('https:') : null;
  if (!pagina.ok && pagina.errore === 'non si apre') {
    const semplice = new URL(sicuro.toString()); semplice.protocol = 'http:';
    const seconda = await leggiPagina(semplice.toString(), { attesaMs: 3000, maxByte: 600_000 });
    if (seconda.ok) { pagina = seconda; https = seconda.url.startsWith('https:'); }
  }
  if (!pagina.ok || !pagina.html || !eIlSitoDi(pagina.html, nome, citta, { largo: true })) return null;
  return { ...misuraHtml(pagina.html, pagina.url), aperto: true, https, errore: null };
}
