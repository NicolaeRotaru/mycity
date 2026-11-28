import { faseLuna, firmaDi, puntoAureo, ritardiDiAccensione, rosaEtrusca, tokenCss, trama, tracciatoLuna } from '@/lib/armonia';
import { chiaveDiOggi, formatToday, isOpenNow, orariImpostati, romeNow, type HoursInterval, type StoreHours } from '@/lib/store-hours';
import type { Abbonamento } from '@/lib/agenzia/preventivo';
import type { PaginaDellaBozza } from '@/lib/agenzia/sito-dell-ordine-ad';
import { DOMINIO_MYCITY } from '@/lib/contatti-pubblici';
import { STANDARD, type PaginaStandard, type Sezione } from './standard';
import { PALETTE, contenutoDaPagine, type ContenutoSito, type Palette } from './contenuto';
import { disegnoHtml, type Disegno } from './disegni';

/**
 * IL SITO FINITO DEL CLIENTE — 28/11/2026, rifatto il pomeriggio sullo standard per abbonamento.
 *
 * Nicola, 28/11 verso le 15:30: il primo sito automatico (tre schede di testo) «non è bello … anche la versione base,
 * il sito è molto meglio di quello che c'è adesso … l'abbonamento business deve essere nella versione business, deve
 * essere bello figo». Il metro è il sito Business del Caffè di Piacenza. Qui si disegnano le pagine che dice
 * `standard.ts` per la fascia del cliente, ognuna con le sue sezioni: copertina con un titolo che racconta il posto,
 * i momenti della giornata coi disegni a un tratto, la striscia di immagini, il locale, cosa offre, perché venire, la
 * città coi suoi appuntamenti, i contatti con «Aperto ora» e la barra Chiama/Indicazioni sul telefono.
 *
 * HTML intero, senza script (i dati per Google sono JSON, non codice), coi caratteri e i disegni di public/siti.
 * Da dove viene ogni cosa:
 *  - i testi: dall'AD (`contenuto` nella colonna `sito`), o dai testi a pagine del primo sito, rimessi in forma da
 *    `contenutoDaPagine`. Le frasi da bozza («da confermare col titolare») si tolgono sempre;
 *  - indirizzo, telefono, orari, logo, foto, social: dal negozio su MyCity. Quello che non c'è non si scrive;
 *  - gli appuntamenti in città: dal piano editoriale dell'AD, solo quelli con la loro fonte;
 *  - le immagini: le foto vere del negozio quando ci sono; altrimenti i disegni a un tratto, mai foto prese a caso;
 *  - la grafica: la firma dell'armonia (skill `armonia`): il colore del marchio comanda, la firma dà il secondo tono.
 */

export type EventoInCitta = { data: string; testo: string };

export type DatiSitoFinito = {
  nome: string;
  sottotitolo: string;
  /** La fascia dell'abbonamento: decide le pagine (standard.ts). */
  fascia: Abbonamento;
  /** I contenuti scritti dall'AD nella forma nuova; `null` per i siti scritti a pagine. */
  contenuto?: ContenutoSito | null;
  citta: string | null;
  indirizzo: string | null;
  telefono: string | null;
  orari: unknown;
  social: { label: string; href: string }[];
  logo: string | null;
  foto: string[];
  /** Il colore del marchio scelto dal negozio (esadecimale), o `null`: allora comanda la tavolozza. */
  colore: string | null;
  /** La vetrina del negozio su MyCity, se è approvata: indirizzo intero. */
  vetrina: string | null;
  /** La data della firma: apertura o iscrizione a MyCity. Mai oggi. */
  nascita: string | null;
  /** I testi a pagine del primo sito: servono quando `contenuto` non c'è. */
  pagine: PaginaDellaBozza[];
  eventi?: EventoInCitta[];
  /** «/sito/raquel-cafe-ffb27af9»: i collegamenti ci costruiscono sopra. */
  base: string;
};

// ———————————————————————————————— i testi

/**
 * Le frasi da bozza. Collaudo del 28/11: la prima regola guardava parole sole («titolare», «confermato»,
 * «pubblicazione») e toglieva frasi buone («Il titolare vi accoglie ogni mattina», «Prenotazione confermata in pochi
 * minuti»), mentre lasciava passare «verrà aggiunto a breve» o «[da inserire]». Qui si guardano i modi di dire della bozza.
 */
const DA_BOZZA: readonly RegExp[] = [
  /\bda (confermare|definire|inserire|completare|verificare|aggiungere)\b/i,
  /\bconferm\w*\b[^.!?]*\btitolare\b|\btitolare\b[^.!?]*\bconferm\w*/i,
  /\b(dopo|prima del(la)?|in attesa del(la)?) (sua )?(conferma|pubblicazione|visita)\b/i,
  /\b(metteremo|inseriremo|aggiungeremo|pubblicheremo|inseriamo|arriveranno)\b/i,
  /\b(verr[àa]|sar[àa]|verranno|saranno) (presto )?(aggiunt|inserit|pubblicat|indicat|comunicat)\w*/i,
  /(?:^|\s)(è|sono) in arrivo\b|\bpresto potrete\b|\bsegnaposto\b|\blorem ipsum\b|\bTBD\b/i,
  /\[[^\]]*\]/,
];
const daBozza = (f: string) => DA_BOZZA.some((r) => r.test(f));

/** Il testo di una sezione senza le frasi da bozza. Stringa vuota se non resta niente. */
export function testoPubblico(testo: string): string {
  return String(testo ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .filter((f) => f && !daBozza(f))
    .join(' ')
    .trim();
}

/** Il titolo di una pagina senza bozza: se lo è, il nome dal suo percorso («/chi-siamo» → «Chi siamo»). */
function titoloPubblico(titolo: string, percorso: string): string {
  if (!daBozza(titolo)) return titolo;
  if (percorso === '/') return 'Home';
  const t = percorso.slice(1).replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Le pagine dell'AD pronte per il sito: frasi da bozza tolte, sezioni vuote tolte, titoli puliti. */
export function paginePubbliche(pagine: PaginaDellaBozza[]): PaginaDellaBozza[] {
  return (pagine ?? []).map((p) => ({
    titolo: titoloPubblico(p.titolo, p.percorso),
    percorso: p.percorso,
    sezioni: p.sezioni
      .map((s) => ({ ...s, testo: testoPubblico(s.testo) }))
      .filter((s) => s.testo.length > 0 && !daBozza(s.titolo)),
  }));
}

/** La frase sotto il nome, senza bozza; se non resta niente, nome e città. */
export function sottotitoloPubblico(sottotitolo: string, nome: string, citta: string | null): string {
  return testoPubblico(sottotitolo) || `${nome}${citta ? `, a ${citta}` : ''}`;
}

/** Ogni testo del contenuto passa dal filtro: anche quelli scritti nella forma nuova. */
function contenutoPulito(c: ContenutoSito): ContenutoSito {
  const t = testoPubblico;
  const r = (x: { titolo: string; paragrafi: string[] } | null) => (x ? { titolo: t(x.titolo) || '', paragrafi: x.paragrafi.map(t).filter(Boolean) } : null);
  const locale = r(c.locale);
  const novita = r(c.novita);
  const citta = c.citta ? { ...r(c.citta)!, vicino: c.citta.vicino.map(t).filter(Boolean) } : null;
  return {
    ...c,
    occhiello: t(c.occhiello),
    titolo: t(c.titolo),
    sottotitolo: t(c.sottotitolo),
    momentiTitolo: t(c.momentiTitolo) || 'Cosa trovi da noi',
    momentiIntro: t(c.momentiIntro),
    momenti: c.momenti.map((m) => ({ ...m, titolo: t(m.titolo), testo: t(m.testo) })).filter((m) => m.titolo && m.testo),
    perche: c.perche.map((m) => ({ titolo: t(m.titolo), testo: t(m.testo) })).filter((m) => m.titolo && m.testo),
    locale: locale && locale.paragrafi.length ? locale : null,
    offerta: c.offerta.map((o) => ({ ...o, categoria: t(o.categoria), descrizione: t(o.descrizione), voci: o.voci.map(t).filter(Boolean) })).filter((o) => o.categoria && (o.descrizione || o.voci.length)),
    citta: citta && (citta.paragrafi.length || citta.vicino.length) ? citta : null,
    comeArrivare: c.comeArrivare ? t(c.comeArrivare) || null : null,
    novita: novita && novita.paragrafi.length ? novita : null,
    domande: c.domande.map((d) => ({ domanda: t(d.domanda), risposta: t(d.risposta) })).filter((d) => d.domanda && d.risposta),
  };
}

// ———————————————————————————————— gli attrezzi

const esc = (t: string) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const https = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u.trim()) ? u.trim() : null);
const hex = (c: string | null | undefined): string | null => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const telefonoPerLink = (t: string) => t.replace(/[^\d+]/g, '');

/** Le foto del negozio: accetta indirizzi o oggetti con `url`, solo https, al massimo 12. */
export function fotoDalNegozio(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => https(typeof m === 'string' ? m : m && typeof m === 'object' ? (m as { url?: unknown }).url : null))
    .filter((u): u is string => !!u && !/\.(mp4|webm|mov)(\?|$)/i.test(u))
    .slice(0, 12);
}

const GIORNI: Record<string, string> = { mon: 'Lunedì', tue: 'Martedì', wed: 'Mercoledì', thu: 'Giovedì', fri: 'Venerdì', sat: 'Sabato', sun: 'Domenica' };
const ORDINE_GIORNI: (keyof StoreHours)[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MESI_INTERI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

type Orari = { righe: string; adesso: string | null; aperto: boolean } | null;

function orariDi(orari: unknown, adesso: number): Orari {
  const h = orariImpostati(orari) as StoreHours | null;
  if (!h) return null;
  const ora = romeNow(new Date(adesso));
  const oggi = chiaveDiOggi(ora);
  const righe = ORDINE_GIORNI.map((k) => {
    const fasce = (Array.isArray(h[k]) ? h[k] : []) as HoursInterval[];
    const testo = fasce.length ? fasce.map(([a, b]) => `${esc(String(a))}–${esc(String(b))}`).join(', ') : 'Chiuso';
    const e = k === oggi;
    return `<tr${e ? ' class="oggi"' : ''}><th scope="row">${GIORNI[k]}${e ? ' <span>(oggi)</span>' : ''}</th><td>${testo}</td></tr>`;
  }).join('');
  const diOggi = (Array.isArray(h[oggi]) ? h[oggi] : []) as HoursInterval[];
  const aperto = isOpenNow(diOggi, ora);
  return { righe: `<table class="orari">${righe}</table>`, adesso: formatToday(diOggi, ora), aperto };
}

const mappa = (d: DatiSitoFinito) => (d.indirizzo ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.nome} ${d.indirizzo}`)}` : null);

// ———————————————————————————————— le pagine

type Contesto = {
  d: DatiSitoFinito;
  c: ContenutoSito;
  pagine: PaginaStandard[];
  orari: Orari;
  foto: string[];
  eventi: EventoInCitta[];
  link: (percorso: string) => string;
};

/** Le pagine che il sito mostra davvero: quelle dello standard, meno le facoltative senza niente di vero da dire. */
function pagineVisibili(fascia: Abbonamento, c: ContenutoSito, eventi: EventoInCitta[]): PaginaStandard[] {
  return (STANDARD[fascia] ?? STANDARD.base).filter((p) => {
    if (!p.facoltativa) return true;
    if (p.percorso === '/in-citta') return !!c.citta || eventi.length > 0;
    if (p.percorso === '/novita') return !!c.novita;
    if (p.percorso === '/domande') return c.domande.length > 0;
    return true;
  }).filter((p) => {
    // Collaudo 28/11: «Cosa offriamo» senza niente da offrire restava nel menu col solo titolo.
    if (p.percorso === '/cosa-offriamo') return c.offerta.length > 0 || c.momenti.length > 0;
    return true;
  });
}

function contenutoDi(d: DatiSitoFinito): ContenutoSito {
  const sottotitolo = sottotitoloPubblico(d.sottotitolo, d.nome, d.citta);
  const grezzo = d.contenuto ?? contenutoDaPagine(paginePubbliche(d.pagine), d.nome, sottotitolo);
  const c = contenutoPulito(grezzo);
  return { ...c, titolo: c.titolo || d.nome, sottotitolo: c.sottotitolo || sottotitolo };
}

/** Titolo e percorso delle pagine del sito, per il menu e per la pagina del titolare. */
export function pagineDelSito(d: DatiSitoFinito): { percorso: string; titolo: string }[] {
  const c = contenutoDi(d);
  return pagineVisibili(d.fascia, c, (d.eventi ?? []).filter((e) => e.testo)).map((p) => ({ percorso: p.percorso, titolo: p.titolo }));
}

// ———————————————————————————————— le sezioni

function immagine(ctx: Contesto, i: number, classe: string, alt: string): string {
  const f = ctx.foto[i];
  return f ? `<img${classe ? ` class="${classe}"` : ''} src="${esc(f)}" alt="${esc(alt)}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async">` : '';
}

function pulsantiPrincipali(ctx: Contesto): string {
  const paginaOfferta = ctx.pagine.some((p) => p.percorso === '/cosa-offriamo');
  const haOfferta = ctx.c.offerta.length > 0 || ctx.c.momenti.length > 0;
  const haContatti = ctx.pagine.some((p) => p.percorso === '/contatti');
  const contatti = `<a class="pulsante${haOfferta ? ' chiaro' : ''}" href="${esc(haContatti ? ctx.link('/contatti') : '#contatti')}">${ctx.orari ? 'Orari e indirizzo' : 'Come arrivare'}</a>`;
  // Collaudo 28/11: senza niente da offrire il pulsante puntava a un'ancora che non c'era.
  const offerta = haOfferta ? `<a class="pulsante" href="${esc(paginaOfferta ? ctx.link('/cosa-offriamo') : '#offerta')}">Guarda cosa offriamo</a>` : '';
  return `<p class="pulsanti">${offerta}${contatti}</p>`;
}

function copertina(ctx: Contesto): string {
  const { c, orari } = ctx;
  const d0: Disegno = c.momenti[0]?.disegno ?? 'tazza';
  const d1: Disegno = c.momenti[1]?.disegno ?? 'stella';
  const d2: Disegno = c.momenti[2]?.disegno ?? 'fiore';
  const visivo = ctx.foto.length
    ? `<div class="vista con-foto">${immagine(ctx, 0, 'grande', ctx.d.nome)}${ctx.foto[1] ? immagine(ctx, 1, 'piccola uno', ctx.d.nome) : ''}${ctx.foto[2] ? immagine(ctx, 2, 'piccola due', ctx.d.nome) : ''}</div>`
    : `<div class="vista disegnata" aria-hidden="true"><div class="tondo">${disegnoHtml(d0, 'disegno grande')}</div><div class="tessera uno">${disegnoHtml(d1, 'disegno')}</div><div class="tessera due">${disegnoHtml(d2, 'disegno')}</div></div>`;
  const stato = orari?.adesso ? `<p class="stato${orari.aperto ? ' aperto' : ''}"><span aria-hidden="true"></span>${esc(orari.aperto ? orari.adesso.replace(/^Aperto fino alle/, 'Aperto ora · chiude alle') : orari.adesso)}</p>` : '';
  return `<section class="copertina contenitore">
  <div class="testo">${c.occhiello ? `<p class="occhiello">${esc(c.occhiello)}</p>` : ''}<h1>${esc(c.titolo)}</h1><p class="sotto">${esc(c.sottotitolo)}</p>${stato}${pulsantiPrincipali(ctx)}</div>
  ${visivo}
</section>`;
}

function momenti(ctx: Contesto, ritardi: number[]): string {
  const { c } = ctx;
  if (!c.momenti.length) return '';
  return `<section class="banda contenitore" aria-labelledby="momenti">
  <h2 id="momenti">${esc(c.momentiTitolo)}</h2>${c.momentiIntro ? `<p class="intro">${esc(c.momentiIntro)}</p>` : ''}
  <div class="schede tre">${c.momenti.map((m, i) => `<article class="scheda entra" style="animation-delay:${ritardi[i] ?? 0}ms">${disegnoHtml(m.disegno)}<h3>${esc(m.titolo)}</h3><p>${esc(m.testo)}</p></article>`).join('')}</div>
</section>`;
}

function striscia(ctx: Contesto): string {
  const { c, d } = ctx;
  if (ctx.foto.length >= 4) return `<section class="striscia" aria-label="Foto">${ctx.foto.slice(0, 4).map((_, i) => immagine(ctx, i, '', d.nome)).join('')}</section>`;
  const voci = [...c.offerta.map((o) => ({ t: o.categoria, d: o.disegno })), ...c.momenti.map((m) => ({ t: m.titolo, d: m.disegno }))];
  const uniche = voci.filter((v, i) => voci.findIndex((x) => x.d === v.d) === i).slice(0, 3);
  const tessere = [...uniche, { t: d.citta ? `In centro a ${d.citta}` : 'Ti aspettiamo', d: 'stella' as Disegno }].slice(0, 4);
  if (tessere.length < 2) return '';
  return `<section class="striscia" aria-hidden="true">${tessere.map((x, i) => `<div class="tessera-s t${i}">${disegnoHtml(x.d)}<span>${esc(x.t)}</span></div>`).join('')}</section>`;
}

function latoDisegnato(ctx: Contesto, indiceFoto: number, disegno: Disegno): string {
  return ctx.foto[indiceFoto]
    ? immagine(ctx, indiceFoto, 'foto-lato', ctx.d.nome)
    : `<div class="riquadro-disegno" aria-hidden="true">${disegnoHtml(disegno, 'disegno grande')}</div>`;
}

function locale(ctx: Contesto, completa: boolean): string {
  const { c } = ctx;
  const r = c.locale ?? { titolo: 'Chi siamo', paragrafi: [c.sottotitolo, c.momentiIntro].filter(Boolean) };
  if (!r.paragrafi.length) return '';
  return `<section class="banda contenitore due-colonne" aria-labelledby="locale">
  <div><h2 id="locale">${esc(r.titolo || 'Chi siamo')}</h2>${r.paragrafi.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
  ${latoDisegnato(ctx, completa ? 3 : 1, c.momenti[1]?.disegno ?? c.momenti[0]?.disegno ?? 'tazza')}
</section>`;
}

function offerta(ctx: Contesto): string {
  const { c } = ctx;
  const categorie = c.offerta.length ? c.offerta : c.momenti.map((m) => ({ categoria: m.titolo, descrizione: m.testo, voci: [] as string[], disegno: m.disegno }));
  if (!categorie.length) return '';
  return `<section class="banda contenitore" id="offerta" aria-labelledby="offerta-t">
  <h2 id="offerta-t">Cosa offriamo</h2>
  <div class="menu">${categorie.map((o) => `<section class="menu-sez">${disegnoHtml(o.disegno, 'disegno piccolo')}<h3>${esc(o.categoria)}</h3>${o.descrizione ? `<p>${esc(o.descrizione)}</p>` : ''}${o.voci.length ? `<ul>${o.voci.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</div>
</section>`;
}

function perche(ctx: Contesto): string {
  const { c } = ctx;
  if (!c.perche.length) return '';
  return `<section class="banda contenitore" aria-labelledby="perche">
  <h2 id="perche">Perché venire da noi</h2>
  <ol class="motivi">${c.perche.map((m, i) => `<li><span class="numero" aria-hidden="true">0${i + 1}</span><h3>${esc(m.titolo)}</h3><p>${esc(m.testo)}</p></li>`).join('')}</ol>
</section>`;
}

function dataCorta(iso: string): { giorno: string; mese: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? { giorno: String(Number(m[3])), mese: MESI[Number(m[2]) - 1] ?? '' } : null;
}

function citta(ctx: Contesto, anteprima: boolean): string {
  const { c, eventi, pagine } = ctx;
  if (!c.citta && !eventi.length) return '';
  const lista = (anteprima ? eventi.slice(0, 4) : eventi).map((e) => {
    const g = dataCorta(e.data);
    return `<li>${g ? `<span class="data"><b>${g.giorno}</b> ${g.mese}</span>` : ''}<span>${esc(e.testo)}</span></li>`;
  });
  const paragrafi = c.citta?.paragrafi ?? [];
  const haPagina = pagine.some((p) => p.percorso === '/in-citta');
  return `<section class="tinta citta" aria-labelledby="citta"><div class="contenitore due-colonne">
  <div>
    <h2 id="citta">${esc(c.citta?.titolo || (ctx.d.citta ? `In città, a ${ctx.d.citta}` : 'In città'))}</h2>
    ${(anteprima ? paragrafi.slice(0, 1) : paragrafi).map((p) => `<p>${esc(p)}</p>`).join('')}
    ${!anteprima && c.citta?.vicino.length ? `<ul class="chips">${c.citta.vicino.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : ''}
    ${anteprima && haPagina ? `<p class="pulsanti"><a class="pulsante" href="${esc(ctx.link('/in-citta'))}">Scopri la zona</a></p>` : ''}
  </div>
  ${lista.length ? `<div><h3>I prossimi appuntamenti</h3><ul class="eventi">${lista.join('')}</ul></div>` : ''}
</div></section>`;
}

function novita(ctx: Contesto, adesso: number): string {
  const n = ctx.c.novita;
  if (!n) return '';
  const mese = MESI_INTERI[romeNow(new Date(adesso)).getMonth()];
  return `<section class="banda contenitore" aria-labelledby="novita"><article class="novita">
  <p class="occhiello">Novità di ${esc(mese)}</p><h2 id="novita">${esc(n.titolo)}</h2>${n.paragrafi.map((p) => `<p>${esc(p)}</p>`).join('')}
</article></section>`;
}

function domande(ctx: Contesto): string {
  if (!ctx.c.domande.length) return '';
  return `<section class="banda contenitore" aria-labelledby="domande"><h2 id="domande">Domande frequenti</h2>
  <div class="domande">${ctx.c.domande.map((q) => `<details><summary>${esc(q.domanda)}</summary><p>${esc(q.risposta)}</p></details>`).join('')}</div>
</section>`;
}

function galleria(ctx: Contesto): string {
  if (ctx.foto.length < 2) return '';
  return `<section class="banda contenitore" aria-label="Foto del locale"><div class="galleria">${ctx.foto.map((_, i) => immagine(ctx, i, '', ctx.d.nome)).join('')}</div></section>`;
}

function contatti(ctx: Contesto): string {
  const { d, c, orari } = ctx;
  const m = mappa(d);
  return `<section class="banda contenitore due-colonne" id="contatti" aria-labelledby="contatti-t">
  <div>
    <h2 id="contatti-t">Ti aspettiamo</h2>
    ${c.comeArrivare ? `<p>${esc(c.comeArrivare)}</p>` : ''}
    ${d.indirizzo ? `<p class="voce"><span class="etichetta">Indirizzo</span>${esc(d.indirizzo)}</p>` : ''}
    ${d.telefono ? `<p class="voce"><span class="etichetta">Telefono</span><a href="tel:${esc(telefonoPerLink(d.telefono))}">${esc(d.telefono)}</a></p>` : ''}
    ${d.social.length ? `<p class="voce"><span class="etichetta">Seguici</span>${d.social.map((s) => `<a href="${esc(s.href)}" rel="noopener" target="_blank">${esc(s.label)}</a>`).join(' · ')}</p>` : ''}
    ${orari ? `<div class="riquadro-orari"><h3>Orari</h3>${orari.righe}</div>` : ''}
    <p class="pulsanti">${d.telefono ? `<a class="pulsante" href="tel:${esc(telefonoPerLink(d.telefono))}">Chiama</a>` : ''}${m ? `<a class="pulsante${d.telefono ? ' chiaro' : ''}" href="${esc(m)}" rel="noopener" target="_blank">Indicazioni</a>` : ''}${d.vetrina ? `<a class="pulsante chiaro" href="${esc(d.vetrina)}">Ordina su MyCity</a>` : ''}</p>
  </div>
  ${latoDisegnato(ctx, 2, c.momenti[2]?.disegno ?? 'tazza')}
</section>`;
}

function sezione(ctx: Contesto, s: Sezione, casa: boolean, adesso: number, ritardi: number[]): string {
  switch (s) {
    case 'copertina': return copertina(ctx);
    case 'momenti': return momenti(ctx, ritardi);
    case 'striscia': return striscia(ctx);
    case 'locale': return locale(ctx, !casa);
    case 'offerta': return offerta(ctx);
    case 'perche': return perche(ctx);
    case 'citta': return citta(ctx, casa && ctx.pagine.length > 1);
    case 'novita': return novita(ctx, adesso);
    case 'domande': return domande(ctx);
    case 'galleria': return galleria(ctx);
    case 'contatti': return contatti(ctx);
  }
}

// ———————————————————————————————— lo stile

function stile(p: (typeof PALETTE)[Palette], marchio: string, token: string): string {
  return `@font-face{font-family:"Fraunces";src:url(/siti/caratteri/fraunces-latin-600-normal.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:"Fraunces";src:url(/siti/caratteri/fraunces-latin-700-normal.woff2) format("woff2");font-weight:700;font-display:swap}
@font-face{font-family:"Fraunces";src:url(/siti/caratteri/fraunces-latin-400-italic.woff2) format("woff2");font-weight:400;font-style:italic;font-display:swap}
@font-face{font-family:"Inter";src:url(/siti/caratteri/inter-latin-wght-normal.woff2) format("woff2");font-weight:100 900;font-display:swap}
:root{--fondo:${p.fondo};--carta:${p.carta};--tenue:${p.tenue};--inchiostro:${p.inchiostro};--marchio:${marchio};--accento:${p.accento};--scuro:${p.scuro};--bordo:color-mix(in srgb,var(--inchiostro) 12%,transparent);--curva:cubic-bezier(.382,0,.618,1);${token}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--fondo);color:var(--inchiostro);font:400 16px/1.618 "Inter",system-ui,-apple-system,"Segoe UI",sans-serif;padding-bottom:76px}
@media (min-width:860px){body{padding-bottom:0}}
img{max-width:100%;display:block}a{color:var(--marchio)}
h1,h2,h3{font-family:"Fraunces",Georgia,serif;font-weight:600;line-height:1.1;margin:0 0 13px;text-wrap:balance;letter-spacing:-.01em}
h1{font-size:clamp(40px,6.2vw,72px);font-weight:700}h2{font-size:clamp(30px,4vw,46px)}h3{font-size:21px}
p{margin:0 0 13px}
.salta{position:absolute;left:-999px}.salta:focus{left:13px;top:13px;background:var(--carta);padding:8px 13px;z-index:99}
.contenitore{max-width:1180px;margin:0 auto;padding:0 21px}
.testata{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--fondo) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--bordo)}
.barra{display:flex;align-items:center;justify-content:space-between;gap:13px;min-height:72px}
.marchio{display:flex;align-items:center;gap:13px;text-decoration:none;color:var(--inchiostro);font:700 22px/1.1 "Fraunces",Georgia,serif}
.marchio img{width:52px;height:52px;object-fit:cover;border-radius:50%}
nav ul{display:flex;gap:2px;list-style:none;margin:0;padding:0}
nav a{display:inline-block;padding:10px 13px;text-decoration:none;color:var(--inchiostro);font-weight:600;font-size:15px;border-bottom:2px solid transparent}
nav a[aria-current=page]{color:var(--marchio);border-bottom-color:var(--marchio)}
.barra .pulsante{padding:10px 18px;min-height:44px}
@media (max-width:859px){.barra{flex-wrap:wrap;padding:8px 21px}nav{order:3;width:100%;overflow-x:auto}nav ul{width:max-content}.barra .pulsante{display:none}}
.pulsanti{display:flex;gap:10px;flex-wrap:wrap;margin:21px 0 0}
.pulsante{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 24px;border-radius:999px;background:var(--marchio);color:#fff;text-decoration:none;font-weight:700;border:2px solid var(--marchio)}
.pulsante.chiaro{background:transparent;color:var(--inchiostro);border-color:var(--inchiostro)}
.pulsante:focus-visible,nav a:focus-visible{outline:3px solid var(--marchio);outline-offset:3px}
.occhiello{font:italic 400 clamp(20px,2.4vw,27px)/1.3 "Fraunces",Georgia,serif;color:var(--marchio);margin:0 0 8px}
.copertina{display:grid;gap:34px;align-items:center;padding-top:55px;padding-bottom:55px}
@media (min-width:860px){.copertina{grid-template-columns:1.1fr .9fr;min-height:560px}}
.copertina .sotto{font-size:clamp(18px,1.6vw,21px);max-width:34em;color:var(--tenue)}
.stato{display:inline-flex;align-items:center;gap:10px;padding:10px 18px;border:1px solid var(--bordo);border-radius:999px;background:var(--carta);font-weight:600;margin:8px 0 0}
.stato span{width:10px;height:10px;border-radius:50%;background:#8a8a8a}.stato.aperto span{background:#3E7B4F}
.vista{position:relative;min-height:340px}
@media (max-width:859px){.vista{min-height:0;max-width:420px;width:100%;margin:0 auto}.vista.disegnata .tondo{width:78%;margin:0 auto}.vista .tessera{width:120px}.riquadro-disegno{aspect-ratio:16/9}}
.vista.con-foto .grande{width:86%;margin-left:auto;aspect-ratio:4/5;object-fit:cover;border-radius:26px;box-shadow:0 30px 60px -30px rgba(0,0,0,.45)}
.vista.con-foto .piccola{position:absolute;width:42%;aspect-ratio:1;object-fit:cover;border-radius:18px;border:6px solid var(--carta);box-shadow:0 20px 40px -20px rgba(0,0,0,.4)}
.vista.con-foto .uno{left:0;bottom:8%}.vista.con-foto .due{right:-2%;bottom:-6%;width:32%}
.vista.disegnata .tondo{width:min(420px,88%);aspect-ratio:1;margin-left:auto;border-radius:50%;background:radial-gradient(circle at 35% 30%,var(--carta),var(--accento) 72%);display:grid;place-items:center;color:var(--inchiostro)}
.vista.disegnata .tondo .disegno{width:62%;height:auto;max-height:none}
.vista .tessera{position:absolute;width:150px;padding:14px;background:var(--carta);border-radius:20px;box-shadow:0 18px 36px -18px rgba(0,0,0,.35);color:var(--inchiostro)}
.vista .tessera .disegno{width:100%;height:80px;object-fit:contain;margin:0}
.vista .tessera.uno{left:2%;bottom:6%;transform:rotate(-5deg)}.vista .tessera.due{right:0;top:2%;transform:rotate(4deg)}
.banda{padding-top:55px;padding-bottom:55px}
.intro{max-width:44em;color:var(--tenue);font-size:18px}
.schede{display:grid;gap:21px;margin-top:21px}@media (min-width:760px){.schede.tre{grid-template-columns:repeat(3,1fr)}}
.scheda{background:var(--carta);border:1px solid var(--bordo);border-radius:var(--armonia-raggio,20px);padding:26px 24px;text-align:center}
.scheda p{color:var(--tenue)}
.disegno{display:block;width:auto;max-width:min(200px,80%);height:120px;object-fit:contain;margin:0 auto 13px;color:var(--inchiostro)}
svg.disegno{width:180px}
.disegno.piccolo{height:70px;max-width:120px;margin:0 0 8px}svg.disegno.piccolo{width:100px}
.striscia{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}@media (min-width:760px){.striscia{grid-template-columns:repeat(4,1fr)}}
.striscia img{width:100%;aspect-ratio:1;object-fit:cover}
.tessera-s{aspect-ratio:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:21px;text-align:center;font:italic 400 20px/1.2 "Fraunces",Georgia,serif;color:var(--inchiostro)}
.tessera-s.t0{background:var(--accento)}.tessera-s.t1{background:color-mix(in srgb,var(--accento) 55%,var(--carta))}.tessera-s.t2{background:color-mix(in srgb,var(--marchio) 18%,var(--carta))}.tessera-s.t3{background:var(--scuro);color:var(--fondo)}
.tessera-s .disegno{height:90px;margin:0;color:inherit}
.due-colonne{display:grid;gap:34px;align-items:center}@media (min-width:860px){.due-colonne{grid-template-columns:1.15fr .85fr}}
.due-colonne p{font-size:18px}
.foto-lato{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:26px}
.riquadro-disegno{aspect-ratio:4/5;max-height:460px;border-radius:26px;background:radial-gradient(circle at 50% 40%,var(--carta),var(--accento));display:grid;place-items:center;color:var(--inchiostro)}
.riquadro-disegno .disegno{width:66%;height:auto;max-height:none}
.menu{display:grid;gap:21px;margin-top:21px}@media (min-width:760px){.menu{grid-template-columns:repeat(2,1fr)}}
.menu-sez{background:var(--carta);border:1px solid var(--bordo);border-radius:20px;padding:24px}
.menu-sez p{color:var(--tenue)}.menu-sez ul{margin:8px 0 0;padding-left:18px;columns:2;column-gap:21px}
.tinta{background:color-mix(in srgb,var(--accento) 45%,var(--fondo));padding:55px 0}
.motivi{list-style:none;margin:21px 0 0;padding:0;display:grid;gap:21px}@media (min-width:760px){.motivi{grid-template-columns:repeat(3,1fr)}}
.motivi .numero{display:block;font:700 44px/1 "Fraunces",Georgia,serif;color:var(--marchio);margin-bottom:8px}
.chips{list-style:none;padding:0;margin:13px 0 0;display:flex;flex-wrap:wrap;gap:8px}.chips li{background:var(--carta);border:1px solid var(--bordo);border-radius:999px;padding:6px 14px;font-size:15px}
.eventi{list-style:none;margin:0;padding:0}.eventi li{display:flex;gap:16px;padding:13px 0;border-bottom:1px solid var(--bordo)}
.eventi .data{flex:0 0 64px;color:var(--marchio);font:400 15px/1.1 "Fraunces",Georgia,serif}.eventi .data b{display:block;font-size:26px}
.novita{background:var(--carta);border:1px solid var(--bordo);border-left:6px solid var(--marchio);border-radius:20px;padding:34px}
.domande details{background:var(--carta);border:1px solid var(--bordo);border-radius:16px;padding:16px 20px;margin-bottom:10px}.domande summary{font-weight:700;cursor:pointer}
.galleria{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}.galleria img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:14px}
.voce{margin:0 0 13px}.etichetta{display:block;font-size:14px;font-weight:700;color:var(--tenue)}
.riquadro-orari{background:var(--carta);border:1px solid var(--bordo);border-radius:20px;padding:21px;margin:21px 0}
.orari{border-collapse:collapse;width:100%}.orari th,.orari td{text-align:left;padding:9px 0;border-bottom:1px solid var(--bordo);font-weight:400}.orari td{text-align:right}
.orari tr.oggi th,.orari tr.oggi td{color:var(--marchio);font-weight:700}.orari th span{font-weight:400}
.piede{background:var(--scuro);color:color-mix(in srgb,var(--fondo) 88%,transparent);padding:55px 0 34px;margin-top:34px}
.piede a{color:inherit}.piede .colonne{display:grid;gap:34px}@media (min-width:760px){.piede .colonne{grid-template-columns:1.2fr 1fr 1fr}}
.piede .nome{font:600 28px/1.1 "Fraunces",Georgia,serif;color:var(--fondo);margin-bottom:8px}.piede ul{list-style:none;padding:0;margin:0}.piede li{margin-bottom:6px}
.piede .fondo{margin-top:34px;padding-top:21px;border-top:1px solid color-mix(in srgb,var(--fondo) 18%,transparent);font-size:14px;display:flex;justify-content:space-between;gap:13px;flex-wrap:wrap}
.luna{color:var(--armonia-metallo);vertical-align:middle;margin-left:6px}
.barra-telefono{position:fixed;left:0;right:0;bottom:0;z-index:30;display:flex;gap:10px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:var(--scuro)}
.barra-telefono .pulsante{flex:1}.barra-telefono .pulsante.chiaro{color:var(--fondo);border-color:var(--fondo)}
@media (min-width:860px){.barra-telefono{display:none}}
.sfondo-copertina{position:relative;isolation:isolate;overflow:hidden;background:linear-gradient(170deg,color-mix(in srgb,var(--accento) 35%,var(--fondo)),var(--fondo) 61.8%)}
.trama{position:absolute;inset:0;width:100%;height:100%;z-index:-1;color:var(--armonia-tono);opacity:.06;pointer-events:none;-webkit-mask-image:linear-gradient(90deg,#000,transparent 8%,transparent 92%,#000);mask-image:linear-gradient(90deg,#000,transparent 8%,transparent 92%,#000)}
.titolo-pagina{padding-top:55px;padding-bottom:13px}.titolo-pagina h1{font-size:clamp(36px,5vw,58px)}
@keyframes entra{from{opacity:.4;transform:translateY(6px)}to{opacity:1;transform:none}}
.entra{animation:entra var(--armonia-durata,333ms) var(--curva) both}
@media (prefers-reduced-motion:reduce){.entra{animation:none}html{scroll-behavior:auto}}
@media (forced-colors:active),(prefers-contrast:more){.trama{display:none}}`;
}

// ———————————————————————————————— la pagina

/** L'HTML intero di una pagina del sito, o `null` se il percorso non è una delle sue pagine. */
export function paginaDelSito(dati: DatiSitoFinito, percorso: string, adesso = Date.now()): string | null {
  const c = contenutoDi(dati);
  const eventi = (dati.eventi ?? []).filter((e) => e.testo).slice(0, 8);
  const pagine = pagineVisibili(dati.fascia, c, eventi);
  const pagina = pagine.find((p) => p.percorso === percorso);
  if (!pagina) return null;
  const casa = percorso === '/';
  const p = PALETTE[c.palette] ?? PALETTE.crema;
  const marchio = hex(dati.colore) ?? p.marchio;
  const logo = https(dati.logo);
  const foto = dati.foto.filter((f) => !!https(f));
  const orari = orariDi(dati.orari, adesso);
  const link = (perc: string) => (perc === '/' ? dati.base : `${dati.base}${perc}`);
  const ctx: Contesto = { d: dati, c, pagine, orari, foto, eventi, link };

  // ARMONIA NASCOSTA: la firma dal nome e dalla data che non cambia. Tono e metallo sono il secondo colore.
  const firma = firmaDi({ nome: dati.nome, data: dati.nascita });
  const token = Object.entries(tokenCss(firma) as Record<string, string>).map(([k, v]) => `${k}:${v}`).join(';');
  const [cx, cy] = puntoAureo(610, 377, firma.seme + 1);
  const tramaSvg = `<svg class="trama" aria-hidden="true" focusable="false" viewBox="0 0 610 377" preserveAspectRatio="xMidYMid slice"><path d="${trama(firma.motivo, 610, 377, 34, firma.seme)}" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/><path d="${rosaEtrusca(cx, cy, 377 * 0.3)}" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  const luna = `<svg class="luna" aria-hidden="true" focusable="false" viewBox="-12 -12 24 24" width="10" height="10"><circle r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="${tracciatoLuna(faseLuna(adesso), 10)}" fill="currentColor"/></svg>`;
  const ritardi = ritardiDiAccensione(firma.pianeta, Math.max(1, c.momenti.length));

  const m = mappa(dati);
  const tel = dati.telefono ? telefonoPerLink(dati.telefono) : null;
  const menu = pagine.length > 1
    ? `<nav aria-label="Pagine del sito"><ul>${pagine.map((x) => `<li><a href="${esc(link(x.percorso))}"${x.percorso === percorso ? ' aria-current="page"' : ''}>${esc(x.titolo)}</a></li>`).join('')}</ul></nav>`
    : '';
  const inAlto = tel ? `<a class="pulsante" href="tel:${esc(tel)}">Chiama</a>` : m ? `<a class="pulsante" href="${esc(m)}" rel="noopener" target="_blank">Come arrivare</a>` : '';

  const corpo = pagina.sezioni.map((s) => sezione(ctx, s, casa, adesso, ritardi)).filter(Boolean);
  const testaPagina = `<div class="titolo-pagina contenitore">${c.occhiello ? `<p class="occhiello">${esc(c.occhiello)}</p>` : ''}<h1>${esc(pagina.titolo)}</h1></div>`;
  const [primo, ...resto] = casa ? corpo : [testaPagina, ...corpo];

  const titoloPagina = casa ? `${dati.nome}${dati.citta ? ` · ${dati.citta}` : ''}` : `${pagina.titolo} · ${dati.nome}`;
  const anno = romeNow(new Date(adesso)).getFullYear();
  // I dati del locale per Google (schema.org): JSON, non codice. «<» scritto come <, così non chiude mai il blocco.
  const datiGoogle = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: dati.nome,
    description: c.sottotitolo,
    ...(dati.indirizzo ? { address: { '@type': 'PostalAddress', streetAddress: dati.indirizzo, addressLocality: dati.citta ?? undefined, addressCountry: 'IT' } } : {}),
    ...(dati.telefono ? { telephone: dati.telefono } : {}),
    ...(logo ? { image: logo } : {}),
    ...(dati.social.length ? { sameAs: dati.social.map((s) => s.href) } : {}),
  }).replace(/</g, '\\u003c');
  const ogImmagine = foto[0] ?? logo;

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titoloPagina)}</title>
<meta name="description" content="${esc(c.sottotitolo)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${esc(p.fondo)}">
<meta property="og:title" content="${esc(titoloPagina)}">
<meta property="og:description" content="${esc(c.sottotitolo)}">
<meta property="og:type" content="website">
${ogImmagine ? `<meta property="og:image" content="${esc(ogImmagine)}">` : ''}
<link rel="preload" href="/siti/caratteri/fraunces-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
<script type="application/ld+json">${datiGoogle}</script>
<style>${stile(p, marchio, token)}</style>
</head>
<body>
<a class="salta" href="#contenuto">Vai al contenuto</a>
<header class="testata"><div class="contenitore barra">
  <a class="marchio" href="${esc(dati.base)}">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(dati.nome)}</span></a>
  ${menu}
  ${inAlto}
</div></header>
<main id="contenuto">
<div class="sfondo-copertina">${tramaSvg}${primo ?? ''}</div>
${resto.join('\n')}
</main>
<footer class="piede"><div class="contenitore">
  <div class="colonne">
    <div><p class="nome">${esc(dati.nome)}</p><p>${esc(c.occhiello || c.sottotitolo)}</p>${orari?.adesso ? `<p>${esc(orari.adesso)}</p>` : ''}</div>
    <div><ul>${dati.indirizzo ? `<li>${esc(dati.indirizzo)}</li>` : ''}${tel ? `<li><a href="tel:${esc(tel)}">${esc(dati.telefono!)}</a></li>` : ''}${dati.social.map((s) => `<li><a href="${esc(s.href)}" rel="noopener" target="_blank">${esc(s.label)}</a></li>`).join('')}${m ? `<li><a href="${esc(m)}" rel="noopener" target="_blank">Indicazioni</a></li>` : ''}</ul></div>
    <div><ul>${pagine.map((x) => `<li><a href="${esc(link(x.percorso))}">${esc(x.titolo)}</a></li>`).join('')}${dati.vetrina ? `<li><a href="${esc(dati.vetrina)}">La vetrina su MyCity</a></li>` : ''}</ul></div>
  </div>
  <div class="fondo"><span>© ${anno} ${esc(dati.nome)}</span><span>Sito curato da <a href="https://${DOMINIO_MYCITY}/">MyCity</a>${luna}</span></div>
</div></footer>
${tel || m ? `<div class="barra-telefono">${tel ? `<a class="pulsante" href="tel:${esc(tel)}">Chiama</a>` : ''}${m ? `<a class="pulsante${tel ? ' chiaro' : ''}" href="${esc(m)}" rel="noopener" target="_blank">Indicazioni</a>` : ''}</div>` : ''}
</body>
</html>`;
}
