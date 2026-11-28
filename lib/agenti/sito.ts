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
  /** 28/11/2026 — Con che prova il sito è del locale (vedi `provaDelSito`); assente per il sito scritto sulla mappa libera. */
  prova?: ProvaDelSito;
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

// 28/11/2026 — Anche share.google e i giornali locali: un articolo sul locale non è il suo sito (collaudo).
// I siti fatti con Google Sites (sites.google.com/view/…) invece sono siti dei locali.
const ELENCHI_E_PROFILI = /(^|\.)(facebook|instagram|tiktok|youtube|google|goo|linktr|wa|whatsapp|tripadvisor|thefork|justeat|glovoapp|deliveroo|paginegialle|paginebianche|virgilio|yelp|booking|airbnb|matrimonio|sluurpy|restaurantguru|wanderlog|liberta|ilpiacenza|piacenzasera|piacenza24|ilpiacenzaonline)\.[a-z.]+$|(^|\.)share\.google$/i;
/** Domini che non sono «il sito» dell'attività: social, mappe, elenchi, giornali. Google Sites (sites.google.com) invece sì. */
export const NON_E_UN_SITO = { test: (host: string): boolean => String(host ?? '').toLowerCase().replace(/^www\./, '') !== 'sites.google.com' && ELENCHI_E_PROFILI.test(String(host ?? '')) };

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
  // 28/11/2026 — Dopo i rinvii la pagina può essere finita su un profilo o un elenco: allora non è il sito (collaudo).
  if (NON_E_UN_SITO.test(new URL(pagina.url).hostname)) return { ...vuota(pagina.url, 'rinvia a un profilo o a un elenco, non al sito dell’attività'), https };
  return { ...misuraHtml(pagina.html, pagina.url), aperto: true, https, errore: null };
}

// ———————————————————————————————— il sito che nessuno ha scritto da nessuna parte
//
// La prova vera del 26/11 (La Dolce Dispensa): l'AD vede solo gli estratti della ricerca e non apre le pagine,
// così non ha trovato né il sito né i profili, che esistono. Il programma invece le pagine le apre: prova gli
// indirizzi più probabili (ladolcedispensa.it, …), e tiene un sito solo se la pagina porta il nome
// dell'attività E la città. Dal sito trovato escono anche i profili social che il sito stesso collega.

// 28/11/2026 — Anche le preposizioni articolate («alla», «dell'», «dei»…): non distinguono un locale da un altro (collaudo).
const ARTICOLI = new Set(['la', 'il', 'lo', 'le', 'i', 'gli', 'l', 'un', 'una', 'al', 'da', 'dal', 'del', 'della', 'dell', 'dello', 'dei', 'degli', 'delle',
  'alla', 'allo', 'all', 'ai', 'agli', 'alle', 'dalla', 'dai', 'di', 'e', 'ed', 'in', 'a', 'nel', 'nella', 'sul', 'sulla']);
// 28/11/2026 — Il Raquel 💗 Cafè: «cafe» contava come parola del nome, e un sito intitolato «Raquel Caffè» veniva
// scartato perché «caffe» non contiene «cafe». Le grafie del caffè e del bar contano tutte come parole comuni.
const GENERICHE = new Set(['bar', 'caffe', 'cafe', 'caffetteria', 'cafeteria', 'coffee', 'bistrot', 'bistro', 'pub', 'lounge',
  'pasticceria', 'ristorante', 'pizzeria', 'trattoria', 'osteria', 'forno', 'panificio',
  'macelleria', 'gelateria', 'enoteca', 'negozio', 'boutique', 'parrucchiere', 'salone', 'centro', 'studio', 'farmacia', 'ottica', 'libreria']);
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' e ').replace(/['’`]/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Le parole che distinguono il locale nel suo nome, senza articoli, parole comuni e la città («Raquel 💗 Cafè» → ["raquel"];
 * «Bar Duomo Piacenza» → ["duomo"]: la città non distingue niente, ricollaudo del 28/11).
 * Un nome fatto solo di parole comuni («Caffè Bistrot», «Coffee Lounge») le tiene tutte: altrimenti non si
 * riconoscerebbe più nessun sito, nemmeno quello scritto dal venditore (collaudo del 28/11).
 */
export function paroleDistintive(nome: string, citta = 'Piacenza'): string[] {
  const dellaCitta = new Set([...slug(citta).split(' '), 'piacenza', 'piacentino', 'piacentina']);
  const tutte = slug(nome).split(' ').filter((p) => p.length >= 3 && !ARTICOLI.has(p));
  const proprie = tutte.filter((p) => !GENERICHE.has(p) && !dellaCitta.has(p));
  return proprie.length ? proprie : tutte;
}

// Le famiglie dei tipi di attività: un profilo «gelateria_del_duomo» non è del «Bar del Duomo», un sito «Fratelli Rossi
// Gomme» non è della «Pasticceria Fratelli Rossi» (collaudi del 28/11).
const FAMIGLIE: string[][] = [
  ['bar', 'caffe', 'cafe', 'caffetteria', 'cafeteria', 'coffee', 'bistrot', 'bistro', 'pub', 'lounge'], ['pasticceria'],
  ['ristorante', 'trattoria', 'osteria'], ['pizzeria'], ['forno', 'panificio'], ['macelleria'], ['gelateria'], ['enoteca', 'bottiglieria'],
  ['parrucchiere', 'salone'], ['farmacia'], ['ottica'], ['libreria'], ['boutique', 'negozio'],
  ['gomme', 'gommista', 'pneumatici'], ['officina', 'carrozzeria', 'autofficina'], ['ferramenta'], ['abbigliamento'],
  ['immobiliare'], ['assicurazioni'], ['estetica', 'estetista'], ['tabaccheria'], ['edicola'], ['fiorista', 'fiori'],
  ['lavanderia'], ['palestra'], ['hotel', 'albergo'],
];
const famiglieIn = (parole: Set<string>) => FAMIGLIE.filter((f) => f.some((w) => parole.has(w)));

/**
 * Un nome di profilo o un dominio è di questo locale? Servono TUTTE le parole che distinguono il nome, e nessuna parola
 * di un altro tipo di attività («raquel_cafe23» per «Raquel 💗 Cafè»: sì; «gelateriadelduomo» per «Bar del Duomo»: no;
 * «rossi_gomme_piacenza» per «Pasticceria Fratelli Rossi»: no, manca «fratelli»).
 */
export function portaIlNome(testoProfilo: string, nome: string, citta = 'Piacenza'): boolean {
  const s = slug(testoProfilo.replace(/[._-]+/g, ' ')).replace(/ /g, '');
  const distinte = paroleDistintive(nome, citta);
  if (!distinte.length || !distinte.every((p) => s.includes(p))) return false;
  const delNome = famiglieIn(new Set(slug(nome).split(' ')));
  return !FAMIGLIE.some((f) => !delNome.includes(f) && f.some((w) => w.length >= 5 && s.includes(w)));
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

/** «Caffè», «Cafè», «Caffetteria», «Coffee» sono la stessa parola per chi scrive un titolo. */
const uguaglia = (s: string) => s.replace(/\b(caffe|caffetteria|cafeteria|coffee)\b/g, 'cafe');

const TIPI_DI_VIA = 'via|viale|piazza|piazzale|corso|strada|stradone|largo|vicolo|borgo|galleria|contrada|cantone|stradello';

// I numeri romani fino a 49 (XXIII, XXIV, IV…): non sono la parola che distingue una via.
const NUMERI_ROMANI = /^(?=[ivxl]+$)(?:xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

/**
 * La via e il numero civico di un indirizzo, come lo scrive Google: «Piazza Duomo, 23, 29121 Piacenza PC» →
 * { parola: «duomo», civico: «23» }. `parola` è l'ultima parola che conta del nome della via: così «Via Giuseppe Mazzini»
 * e «Via Mazzini», «Via IV Novembre» e «Via 4 Novembre», «Corso Vittorio Emanuele II» e «C.so V. Emanuele II» si
 * riconoscono (terzo collaudo del 28/11). Una via che comincia con un numero non scambia quel numero per il civico.
 */
function viaECivico(indirizzo: string | null | undefined): { parola: string; civico: string } | null {
  const pezzi = String(indirizzo ?? '').split(',').map((p) => slug(p)).filter(Boolean);
  if (!pezzi.length) return null;
  let via = pezzi[0];
  let civico = pezzi[1]?.match(/^(?:n |nr |numero )?(\d{1,4})(?:[a-z]| [abc])?$/)?.[1] ?? null;
  if (!civico) {
    const coda = via.match(/^(.*\S)\s+(?:n |nr |numero )?(\d{1,4})(?:[a-z]| [abc])?$/);
    if (coda && /[a-z]{3,}/.test(coda[1])) { via = coda[1]; civico = coda[2]; }
  }
  if (!civico) return null;
  const parole = via.split(' ').filter((w) => /^[a-z]{3,}$/.test(w) && !ARTICOLI.has(w) && !NUMERI_ROMANI.test(w) && !new RegExp(`^(?:${TIPI_DI_VIA})$`).test(w));
  const parola = parole[parole.length - 1];
  return parola ? { parola, civico } : null;
}

/**
 * L'indirizzo del locale scritto nella pagina: l'ultima parola della via e il numero civico vicini («Piazza Duomo, 23» →
 * «duomo 23»; valgono anche «n. 23», «nr. 23», «23/A», «23A», «Emanuele II 120»). Il numero conta: il Duomo di Piacenza
 * è al 33 della stessa piazza.
 */
export function indirizzoNellaPagina(testoPagina: string, indirizzo: string | null | undefined): boolean {
  const nostro = viaECivico(indirizzo);
  if (!nostro) return false;
  return new RegExp(`(^| )${nostro.parola}( [a-z0-9]+){0,2}?( n| nr| numero)? ${nostro.civico}([abc]| [abc])?( |$)`).test(slug(testoPagina));
}

/** Il testo che si legge in una pagina: senza tag, script e indirizzi dei collegamenti (un link a un profilo non è il nome). */
const testoVisibile = (html: string) => html.slice(0, 300_000).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');

/** Con che prova una pagina è del locale: l'ha data il venditore, porta il nostro indirizzo, o solo il nome. */
export type ProvaDelSito = 'venditore' | 'indirizzo' | 'nome';

/**
 * La pagina è davvero di questa attività? Città nella pagina, niente pagina di parcheggio, e il nome:
 *  · stretto (di serie): le parole che distinguono il nome nel titolo, nella descrizione o nell'h1, e nessun altro tipo
 *    di attività nel titolo. Col nostro indirizzo nella pagina la prova è «indirizzo», sennò «nome». Con una parola
 *    distintiva sola serve di più: il nome intero nel titolo, oppure la via col numero civico del locale;
 *  · `largo`: il nome come parola intera nel testo che si legge, nel testo alternativo delle immagini o nel titolo. Solo per
 *    un sito che il venditore ha copiato dalla scheda Google.
 * Restituisce la prova, o `false`.
 */
export function provaDelSito(html: string, nome: string, citta = 'Piacenza', { largo = false, indirizzo = null }: { largo?: boolean; indirizzo?: string | null } = {}): ProvaDelSito | false {
  if (!html || PARCHEGGIO.test(html.slice(0, 60_000))) return false;
  const tutto = slug(html.slice(0, 300_000));
  if (!tutto.includes(slug(citta))) return false;
  const parole = paroleDistintive(nome, citta);
  if (!parole.length) return false;
  const visibile = testoVisibile(html);
  if (largo) {
    const alt = [...html.slice(0, 300_000).matchAll(/<img[^>]+alt=["']([^"']*)["']/gi)].map((m) => m[1]).join(' ');
    const leggibile = slug(`${visibile} ${alt} ${html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''}`);
    return parole.filter((p) => new RegExp(`(^| )${p}( |$)`).test(leggibile)).length / parole.length >= 0.75 ? 'venditore' : false;
  }
  const testa = slug([html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], ...[...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:site_name|og:title)["'][^>]*content=["']([^"']*)["']/gi)].map((m) => m[1]),
    ...[...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]*>/g, ' '))].filter(Boolean).join(' '));
  // Nel titolo basta il pezzo: un titolo «ladolcedispensa.it» vale.
  if (parole.filter((p) => testa.includes(p)).length / parole.length < 0.75) return false;
  // Un altro tipo di attività nel titolo («Fratelli Rossi Gomme» per la «Pasticceria Fratelli Rossi»).
  const delNome = famiglieIn(new Set(slug(nome).split(' ')));
  const nelTitolo = famiglieIn(new Set(testa.split(' ')));
  // Vale solo se il nome dice il tipo: «La Dolce Dispensa» può avere «pasticceria» nel titolo.
  if (delNome.length && nelTitolo.some((f) => !delNome.includes(f)) && !nelTitolo.some((f) => delNome.includes(f))) return false;
  if (indirizzoNellaPagina(visibile, indirizzo)) return 'indirizzo';
  // Senza il nostro indirizzo la prova è il nome soltanto: il sito si mostra nella scheda «da controllare», ma non entra
  // nel negozio e non va al flusso 16 (decisione del 28/11, «restringi»: un omonimo esatto, un altro «Bar Sport», ha lo
  // stesso nome; scartare chi scrive un altro indirizzo faceva perdere il sito vero quando la via è scritta diversa).
  if (parole.length >= 2) return 'nome';
  return uguaglia(testa).includes(uguaglia(slug(nome))) ? 'nome' : false;
}

/** La pagina è davvero di questa attività? (vedi `provaDelSito`) */
export function eIlSitoDi(html: string, nome: string, citta = 'Piacenza', opzioni: { largo?: boolean; indirizzo?: string | null } = {}): boolean {
  return provaDelSito(html, nome, citta, opzioni) !== false;
}

/** Una pagina aperta è ancora un sito? Dopo i rinvii può essere finita su un profilo, un elenco o un giornale. */
const finitaAltrove = (url: string) => { try { return NON_E_UN_SITO.test(new URL(url).hostname); } catch { return true; } };

/** Prova una lista di indirizzi in parallelo e tiene il primo che è davvero del locale (controllo stretto). */
async function provaIndirizzi(candidati: string[], nome: string, citta: string, attesaMs: number, indirizzo: string | null): Promise<MisuraSito | null> {
  const prove = await Promise.all(candidati.map(async (d, i) => {
    const pagina = await leggiPagina(`https://${d}/`, { attesaMs, maxByte: 600_000 });
    const prova = pagina.ok && !finitaAltrove(pagina.url) ? provaDelSito(pagina.html, nome, citta, { indirizzo }) : false;
    return prova ? { i, pagina, prova } : null;
  }));
  // Prima chi porta il nostro indirizzo, poi l'ordine dei più probabili.
  const vinta = prove.filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => (a.prova === 'indirizzo' ? 0 : 1) - (b.prova === 'indirizzo' ? 0 : 1) || a.i - b.i)[0];
  if (!vinta) return null;
  return { ...misuraHtml(vinta.pagina.html, vinta.pagina.url), aperto: true, https: vinta.pagina.url.startsWith('https:'), errore: null, prova: vinta.prova };
}

/** Prova gli indirizzi probabili in parallelo, al massimo `attesaMs`. Restituisce la misura del primo che è davvero suo. */
export async function indovinaSito(nome: string | null, citta = 'Piacenza', attesaMs = 3500, profili: string[] = [], indirizzo: string | null = null): Promise<MisuraSito | null> {
  if (!nome) return null;
  const candidati = candidatiDominio(nome, citta, profili);
  return candidati.length ? provaIndirizzi(candidati, nome, citta, attesaMs, indirizzo) : null;
}

/** Come `indovinaSito`, ma prova solo gli indirizzi fatti dai nomi dei profili (quelli dal nome li ha già provati la prima scheda). */
export async function indovinaSitoDaiProfili(nome: string | null, citta = 'Piacenza', profili: string[] = [], attesaMs = 3000, indirizzo: string | null = null): Promise<MisuraSito | null> {
  if (!nome || !profili.length) return null;
  const candidati = candidatiDominio('', citta, profili);
  return candidati.length ? provaIndirizzi(candidati, nome, citta, attesaMs, indirizzo) : null;
}

/**
 * La pagina da cui si giudica un sito indicato: la home del dominio, non la pagina che qualcuno ha indicato (un articolo
 * del giornale sul locale non diventa il suo sito). Per i siti fatti su Google Sites o Wix si tiene il nome del sito.
 */
export function radiceDelSito(u: URL): string {
  const h = u.hostname.toLowerCase();
  const pezzi = u.pathname.split('/').filter(Boolean);
  if (h === 'sites.google.com' && (pezzi[0] === 'view' || pezzi[0] === 'site') && pezzi[1]) return `https://${h}/${pezzi[0]}/${pezzi[1]}/`;
  if (/(^|\.)wixsite\.com$/.test(h) && pezzi[0]) return `https://${h}/${pezzi[0]}/`;
  return `https://${u.hostname}/`;
}

/**
 * Un sito che qualcuno ha indicato (il venditore, l'AD, una pagina dei risultati): si apre la sua home, si misura e si
 * controlla che sia del locale. `fidato` (solo il sito copiato dal venditore dalla scheda Google): il nome può stare in
 * tutta la pagina. Per gli altri vale il controllo stretto, con l'indirizzo del locale. `null` se non si apre, se è un
 * profilo, un elenco o un giornale, o se non è suo: un indirizzo sbagliato non deve finire nei canali della vetrina.
 */
export async function sitoIndicato(dove: string, nome: string | null, citta = 'Piacenza',
  { fidato = false, indirizzo = null, attesaMs = 4500 }: { fidato?: boolean; indirizzo?: string | null; attesaMs?: number } = {}): Promise<MisuraSito | null> {
  if (!nome) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(dove) ? dove : `https://${dove}`); } catch { return null; }
  if (NON_E_UN_SITO.test(u.hostname)) return null;
  const casa = radiceDelSito(u);
  let pagina = await leggiPagina(casa, { attesaMs, maxByte: 600_000 });
  let https: boolean | null = pagina.ok ? pagina.url.startsWith('https:') : null;
  if (!pagina.ok && pagina.errore === 'non si apre') {
    const semplice = new URL(casa); semplice.protocol = 'http:';
    const seconda = await leggiPagina(semplice.toString(), { attesaMs: Math.min(3000, attesaMs), maxByte: 600_000 });
    if (seconda.ok) { pagina = seconda; https = seconda.url.startsWith('https:'); }
  }
  if (!pagina.ok || !pagina.html || finitaAltrove(pagina.url)) return null;
  const prova = provaDelSito(pagina.html, nome, citta, fidato ? { largo: true } : { indirizzo });
  if (!prova) return null;
  return { ...misuraHtml(pagina.html, pagina.url), aperto: true, https, errore: null, prova };
}
