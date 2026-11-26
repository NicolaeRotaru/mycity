// IL LINK DI GOOGLE MAPS — da quello che incolla il venditore al nome, all'indirizzo e al punto sulla mappa.
//
// Si legge SOLO l'indirizzo del link: i rinvii dei link corti (maps.app.goo.gl, goo.gl, g.co, share.google)
// si seguono leggendo l'intestazione «Location», senza mai aprire la pagina di Google né usare le API di
// Google Places (contratto del rapporto, regola 4: dei dati di Google si tiene al massimo il place_id).
// Il nome e il punto sono quelli che il venditore stesso ha mandato, scritti dentro il suo link.
//
// Si seguono solo rinvii verso domini di Google: un link che porta altrove si ferma (niente richieste
// verso indirizzi scelti da chi scrive nella casella).

export type LettoDalLink = {
  nome: string | null;
  indirizzo: string | null;
  lat: number | null;
  lon: number | null;
  /** L'identificativo del luogo scritto nel link (0x…:0x…, ftid, cid): serve solo a riconoscere lo stesso posto. */
  idLuogo: string | null;
  /** L'ultimo indirizzo letto: quello che il venditore apre per vedere la scheda Google dal telefono. */
  link: string | null;
};

const DOMINI_CORTI = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co', 'share.google', 'maps.google.com', 'maps.google.it']);
const eGoogle = (host: string) => /^(www\.|maps\.|consent\.)?google\.(com|it)$/.test(host) || DOMINI_CORTI.has(host);

const pulisci = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*[-–]\s*Google Maps$/i, '').trim();
const decodifica = (s: string) => {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s.replace(/\+/g, ' '); }
};
const numero = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const coordinateValide = (lat: number | null, lon: number | null) =>
  lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

/** I comuni della provincia di Piacenza più probabili: un nome che finisce con uno di questi ha la città dentro. */
export const COMUNI = ['Piacenza', "Fiorenzuola d'Arda", 'Fiorenzuola', 'Castel San Giovanni', 'Rottofreno', 'Podenzano', 'Pontenure', 'Gossolengo',
  'Gragnano Trebbiense', 'Calendasco', 'Caorso', 'Cortemaggiore', 'Carpaneto Piacentino', 'Borgonovo Val Tidone', 'Bobbio', 'Rivergaro',
  'San Giorgio Piacentino', "Monticelli d'Ongina", "Castell'Arquato", "Lugagnano Val d'Arda", 'Vigolzone', 'Agazzano', "Ponte dell'Olio", 'Sarmato', 'Alseno'];
const comuneEsatto = (t: string) => COMUNI.find((c) => c.toLowerCase() === t.trim().toLowerCase().replace(/\s+(pc|italia|italy)$/i, '')) ?? null;

/** Coordinate scritte nel testo: «45.05, 9.69», «45.0526,+9.6930» o in gradi «45°03'09.0"N 9°41'29.0"E». */
export function coordinateDaTesto(t: string): { lat: number; lon: number } | null {
  const s = t.trim().replace(/\+/g, ' ');
  const dec = s.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (dec) return coordinateValide(Number(dec[1]), Number(dec[2])) ? { lat: Number(dec[1]), lon: Number(dec[2]) } : null;
  const g = s.match(/^(\d{1,2})°\s*(\d{1,2})['’′]\s*(\d{1,2}(?:[.,]\d+)?)["”″]?\s*([NS])\s*,?\s*(\d{1,3})°\s*(\d{1,2})['’′]\s*(\d{1,2}(?:[.,]\d+)?)["”″]?\s*([EOW])$/i);
  if (!g) return null;
  const gradi = (d: string, m: string, x: string) => Number(d) + Number(m) / 60 + Number(x.replace(',', '.')) / 3600;
  const lat = gradi(g[1], g[2], g[3]) * (g[4].toUpperCase() === 'S' ? -1 : 1);
  const lon = gradi(g[5], g[6], g[7]) * (g[8].toUpperCase() === 'W' ? -1 : 1);
  return coordinateValide(lat, lon) ? { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 } : null;
}

/**
 * «Nome, Via Roma 3, 29121 Piacenza PC» → nome e indirizzo. Un testo senza via né numeri resta tutto nome, ma la
 * città in coda («Bar Roma, Piacenza», «Bar Roma Piacenza») esce dal nome e diventa l'indirizzo.
 */
export function separaNomeIndirizzo(testo: string): { nome: string | null; indirizzo: string | null } {
  const t = pulisci(testo);
  if (!t) return { nome: null, indirizzo: null };
  // Un testo che è solo coordinate non è un nome.
  if (coordinateDaTesto(t)) return { nome: null, indirizzo: null };
  const parti = t.split(/\s*,\s*/);
  if (parti.length >= 2) {
    const resto = parti.slice(1).join(', ');
    const sembraIndirizzo = /\d|\b(via|viale|v\.le|piazza|p\.za|piazzale|corso|c\.so|strada|largo|vicolo|borgo|stradone|galleria|località|loc\.)\b/i.test(resto);
    if (sembraIndirizzo) return { nome: parti[0] || null, indirizzo: resto.replace(/,?\s*Ital(ia|y)$/i, '') || null };
    const comune = comuneEsatto(resto);
    if (comune && parti[0]) return { nome: parti[0], indirizzo: comune };
    return { nome: t, indirizzo: null };
  }
  // «Bar Roma Piacenza»: la città in coda al nome.
  for (const c of [...COMUNI].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`^(.{3,}?)\\s+${c.replace(/[.*+?^${}()|[\]\\']/g, (x) => (x === "'" ? "['’]" : `\\${x}`))}(?:\\s+pc)?$`, 'i');
    const m = t.match(re);
    if (m) return { nome: m[1].trim(), indirizzo: c };
  }
  return { nome: t, indirizzo: null };
}

/** Legge un indirizzo di Google (maps o search) senza aprirlo. */
export function leggiIndirizzoGoogle(indirizzo: string): LettoDalLink {
  const vuoto: LettoDalLink = { nome: null, indirizzo: null, lat: null, lon: null, idLuogo: null, link: null };
  let u: URL;
  try { u = new URL(indirizzo); } catch { return vuoto; }
  // La pagina del consenso europeo porta l'indirizzo vero in «continue».
  if (u.hostname.startsWith('consent.') && u.searchParams.get('continue')) return leggiIndirizzoGoogle(u.searchParams.get('continue') as string);
  const fuori: LettoDalLink = { ...vuoto, link: u.toString() };
  const percorso = u.pathname;

  // Il nome: /maps/place/<nome>/… oppure /maps/search/<testo>/…
  const posto = percorso.match(/\/maps\/(?:place|search)\/([^/]+)/);
  if (posto && !/^@/.test(posto[1])) {
    const testoPosto = decodifica(posto[1]);
    const punto = coordinateDaTesto(testoPosto);
    if (punto) { fuori.lat = punto.lat; fuori.lon = punto.lon; } else Object.assign(fuori, separaNomeIndirizzo(testoPosto));
  }
  // Oppure ?q= / ?query= (i link condivisi dall'app del telefono: «Nome, via, CAP città»).
  if (!fuori.nome) {
    const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
    const senzaPrefisso = q.replace(/^place_id:\S+/, '').trim();
    if (senzaPrefisso) {
      const punto = coordinateDaTesto(senzaPrefisso);
      if (punto) { fuori.lat = punto.lat; fuori.lon = punto.lon; } else Object.assign(fuori, separaNomeIndirizzo(senzaPrefisso));
    }
  }

  // Il punto: prima lo spillo del luogo (!3d…!4d…), poi il centro della mappa (@lat,lon).
  const tutto = decodifica(u.pathname + u.search);
  const spillo = tutto.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const centro = percorso.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const ll = u.searchParams.get('ll');
  const llm = ll ? ll.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/) : null;
  const coppia = spillo ?? centro ?? llm;
  if (coppia && fuori.lat === null) { fuori.lat = numero(coppia[1]); fuori.lon = numero(coppia[2]); }
  if (!coordinateValide(fuori.lat, fuori.lon)) { fuori.lat = null; fuori.lon = null; }

  // L'identificativo del luogo, solo per riconoscere lo stesso posto (non è un dato di Google Places).
  const fid = tutto.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1] ?? u.searchParams.get('ftid') ?? null;
  const cid = u.searchParams.get('cid');
  fuori.idLuogo = fid || (cid && /^\d{5,25}$/.test(cid) ? `cid:${cid}` : null);
  if (fuori.nome) fuori.nome = fuori.nome.slice(0, 120);
  if (fuori.indirizzo) fuori.indirizzo = fuori.indirizzo.slice(0, 200);
  return fuori;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Dal testo della casella al luogo. Accetta un link di Google Maps (anche corto) o, se non è un link,
 * il nome dell'attività con la città («Bar Roma Piacenza»).
 */
export async function risolviLink(testo: string, { fetchFn = fetch as Fetch, attesaMs = 4000 } = {}): Promise<LettoDalLink & { errore?: string }> {
  const t = String(testo ?? '').trim().slice(0, 2000);
  const vuoto: LettoDalLink = { nome: null, indirizzo: null, lat: null, lon: null, idLuogo: null, link: null };
  if (!t) return { ...vuoto, errore: 'La casella è vuota: incolla il link di Google Maps dell’attività.' };
  const dentro = t.match(/https?:\/\/\S+/i)?.[0];
  if (!dentro) {
    // Niente link: il venditore ha scritto il nome. Va bene lo stesso.
    if (t.length < 3) return { ...vuoto, errore: 'Scrivi almeno il nome dell’attività, oppure incolla il link di Google Maps.' };
    return { ...vuoto, ...separaNomeIndirizzo(t) };
  }
  let attuale: URL;
  try { attuale = new URL(dentro.replace(/[)\].,;]+$/, '')); } catch { return { ...vuoto, errore: 'Questo non sembra un link valido.' }; }
  if (attuale.protocol === 'http:') attuale.protocol = 'https:';
  if (!eGoogle(attuale.hostname)) return { ...vuoto, errore: 'Il link non è di Google Maps. Apri l’attività su Google Maps, premi «Condividi» e incolla quel link.' };

  for (let giro = 0; giro < 6; giro++) {
    const host = attuale.hostname;
    // Un indirizzo «lungo» di Google si legge e basta: la pagina di Google non si apre.
    if (/google\.(com|it)$/.test(host) && !host.startsWith('maps.') && /^\/(maps|search)/.test(attuale.pathname)) break;
    if (host.startsWith('consent.')) break;
    let risposta: Response;
    try {
      risposta = await fetchFn(attuale.toString(), {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(attesaMs),
        headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36', 'accept-language': 'it-IT,it;q=0.9' },
      });
    } catch {
      return { ...vuoto, errore: 'Il link corto non risponde. Riprova, oppure scrivi il nome dell’attività e la città.' };
    }
    const dove = risposta.headers.get('location');
    try { await risposta.body?.cancel(); } catch { /* niente */ }
    if (risposta.status >= 300 && risposta.status < 400 && dove) {
      let prossimo: URL;
      try { prossimo = new URL(dove, attuale); } catch { break; }
      if (!eGoogle(prossimo.hostname)) return { ...vuoto, errore: 'Il link porta fuori da Google Maps: incolla il link del pulsante «Condividi».' };
      attuale = prossimo;
      continue;
    }
    if (risposta.status >= 400) return { ...vuoto, errore: 'Google dice che questo link non esiste più. Ricopialo da Google Maps con «Condividi».' };
    break;
  }
  const letto = leggiIndirizzoGoogle(attuale.toString());
  if (!letto.nome && letto.lat === null) {
    return { ...letto, errore: 'Dal link non riesco a leggere il nome dell’attività. Scrivi nella casella il nome e la città.' };
  }
  return letto;
}

/** La città dall'indirizzo («…, 29122 Piacenza PC» → Piacenza); di serie Piacenza. */
export function cittaDa(indirizzo: string | null) {
  const t = String(indirizzo ?? '');
  const m = t.match(/\b\d{5}\s+([A-Za-zÀ-ÿ'’ ]+?)(?:\s+[A-Z]{2})?\s*(?:,|$)/);
  return m?.[1]?.trim() || comuneEsatto(t) || 'Piacenza';
}
