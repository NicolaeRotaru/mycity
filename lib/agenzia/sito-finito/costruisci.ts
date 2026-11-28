import { faseLuna, firmaDi, puntoAureo, ritardiDiAccensione, rosaEtrusca, tokenCss, trama, tracciatoLuna } from '@/lib/armonia';
import { DAY_KEYS, orariImpostati, type HoursInterval, type StoreHours } from '@/lib/store-hours';
import type { PaginaDellaBozza } from '@/lib/agenzia/sito-dell-ordine-ad';

/**
 * IL SITO FINITO DEL CLIENTE — 28/11/2026.
 *
 * Nicola, 28/11 verso le 14:10: al sì del titolare deve uscire il sito, non l'elenco dei testi. «Che vuol dire che
 * mi esca il sito»: pagine vere, col menu, i colori, l'indirizzo e i contatti, già online. Qui si costruisce, pagina
 * per pagina, l'HTML intero: nessuno script, nessun font esterno, solo testo, stile e immagini del negozio. Lo serve
 * la rotta `app/sito/[indirizzo]/[[...pagina]]/route.ts`.
 *
 * Da dove viene ogni cosa:
 *  - i testi delle pagine: dall'AD (colonna `sito` dell'ordine). Le frasi da bozza («da confermare col titolare»,
 *    «sarà inserito dopo la conferma», «qui metteremo») si tolgono: su un sito online non si lasciano promesse a
 *    metà. Una sezione che resta vuota sparisce;
 *  - indirizzo, telefono, orari, logo, foto, social, colore: dal negozio su MyCity, cioè dati veri. Quello che non
 *    c'è non si scrive: niente «telefono da confermare», il blocco semplicemente non compare;
 *  - la grafica: dalla firma dell'armonia (skill `armonia`), col colore del marchio che comanda e la firma che dà
 *    solo il secondo tono. La trama sta nei margini della testata, al 6%, e non si muove per chi chiede meno movimento.
 */

export type DatiSitoFinito = {
  nome: string;
  sottotitolo: string;
  citta: string | null;
  indirizzo: string | null;
  telefono: string | null;
  orari: unknown;
  social: { label: string; href: string }[];
  logo: string | null;
  foto: string[];
  /** Il colore del marchio (esadecimale): comanda lui. */
  colore: string;
  /** La vetrina del negozio su MyCity, se è approvata: indirizzo intero. */
  vetrina: string | null;
  /** La data della firma: apertura o iscrizione a MyCity. Mai oggi. */
  nascita: string | null;
  pagine: PaginaDellaBozza[];
  /** «/sito/raquel-cafe-ffb27af9»: il menu ci costruisce sopra i collegamenti. */
  base: string;
};

// ———————————————————————————————— i testi

/** Le parole di una frase da bozza: su un sito online non si scrive che qualcosa «arriverà». */
const DA_BOZZA = /\b(da confermare|confermat\w*|conferm[ai]\w*|titolare|pubblicazion\w*|metteremo|inseriremo|aggiungeremo|sar[àa] inserit\w*|saranno inserit\w*|segnaposto)\b/i;

/** Il testo di una sezione senza le frasi da bozza. Stringa vuota se non resta niente. */
export function testoPubblico(testo: string): string {
  return testo
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((f) => f && !DA_BOZZA.test(f))
    .join(' ')
    .trim();
}

/** Le pagine dell'AD pronte per il sito: frasi da bozza tolte, sezioni vuote tolte, percorsi puliti. */
export function paginePubbliche(pagine: PaginaDellaBozza[]): PaginaDellaBozza[] {
  return pagine.map((p) => ({
    titolo: p.titolo,
    percorso: p.percorso,
    sezioni: p.sezioni
      .map((s) => ({ ...s, testo: testoPubblico(s.testo) }))
      .filter((s) => s.testo.length > 0 && !DA_BOZZA.test(s.titolo)),
  }));
}

// ———————————————————————————————— gli attrezzi

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const https = (u: unknown): string | null => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u.trim()) ? u.trim() : null);
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#C0492C');
const telefonoPerLink = (t: string) => t.replace(/[^\d+]/g, '');

/** Le foto del negozio: accetta indirizzi o oggetti con `url`, solo https, al massimo 8. */
export function fotoDalNegozio(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  return media
    .map((m) => https(typeof m === 'string' ? m : m && typeof m === 'object' ? (m as { url?: unknown }).url : null))
    .filter((u): u is string => !!u && !/\.(mp4|webm|mov)(\?|$)/i.test(u))
    .slice(0, 8);
}

const GIORNI: Record<string, string> = { mon: 'Lunedì', tue: 'Martedì', wed: 'Mercoledì', thu: 'Giovedì', fri: 'Venerdì', sat: 'Sabato', sun: 'Domenica' };
const ORDINE_GIORNI = [...DAY_KEYS.slice(1), DAY_KEYS[0]];

function righeOrari(orari: unknown): string | null {
  const h = orariImpostati(orari) as StoreHours | null;
  if (!h) return null;
  const righe = ORDINE_GIORNI.map((k) => {
    const fasce = (Array.isArray(h[k]) ? h[k] : []) as HoursInterval[];
    const testo = fasce.length ? fasce.map(([a, b]) => `${esc(String(a))}–${esc(String(b))}`).join(', ') : 'Chiuso';
    return `<tr><th scope="row">${GIORNI[k]}</th><td>${testo}</td></tr>`;
  });
  return `<table class="orari">${righe.join('')}</table>`;
}

function mappa(d: DatiSitoFinito): string | null {
  if (!d.indirizzo) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.nome} ${d.indirizzo}`)}`;
}

// ———————————————————————————————— i blocchi

function bloccoContatti(d: DatiSitoFinito): string {
  const m = mappa(d);
  const orari = righeOrari(d.orari);
  const voci: string[] = [];
  if (d.indirizzo) voci.push(`<p class="voce"><span class="etichetta">Indirizzo</span>${esc(d.indirizzo)}</p>`);
  if (d.telefono) voci.push(`<p class="voce"><span class="etichetta">Telefono</span><a href="tel:${esc(telefonoPerLink(d.telefono))}">${esc(d.telefono)}</a></p>`);
  if (d.social.length) voci.push(`<p class="voce"><span class="etichetta">Seguici</span>${d.social.map((s) => `<a href="${esc(s.href)}" rel="noopener" target="_blank">${esc(s.label)}</a>`).join(' · ')}</p>`);
  const pulsanti = [
    m ? `<a class="pulsante" href="${esc(m)}" rel="noopener" target="_blank">Come arrivare</a>` : '',
    d.telefono ? `<a class="pulsante chiaro" href="tel:${esc(telefonoPerLink(d.telefono))}">Chiama</a>` : '',
    d.vetrina ? `<a class="pulsante chiaro" href="${esc(d.vetrina)}">Ordina su MyCity</a>` : '',
  ].join('');
  if (!voci.length && !orari && !pulsanti) return '';
  return `<section class="contatti" aria-labelledby="contatti-titolo">
  <h2 id="contatti-titolo">Come trovarci</h2>
  <div class="contatti-griglia">
    <div>${voci.join('')}${pulsanti ? `<p class="pulsanti">${pulsanti}</p>` : ''}</div>
    ${orari ? `<div><h3>Orari</h3>${orari}</div>` : ''}
  </div>
</section>`;
}

function galleria(d: DatiSitoFinito): string {
  if (!d.foto.length) return '';
  return `<section class="galleria" aria-label="Foto del locale">${d.foto.map((f, i) => `<img src="${esc(f)}" alt="${esc(d.nome)}, foto ${i + 1}" loading="lazy" decoding="async">`).join('')}</section>`;
}

/** La pagina che porta i contatti: quella che parla di «dove» o «contatti», altrimenti l'ultima. */
function paginaDeiContatti(pagine: PaginaDellaBozza[]): string {
  const p = pagine.find((x) => /dove|contatt/i.test(`${x.percorso} ${x.titolo}`)) ?? pagine[pagine.length - 1];
  return p?.percorso ?? '/';
}

// ———————————————————————————————— la pagina

/** L'HTML intero di una pagina del sito, o `null` se il percorso non è una delle pagine. */
export function paginaDelSito(dati: DatiSitoFinito, percorso: string, adesso = Date.now()): string | null {
  const pagine = paginePubbliche(dati.pagine);
  const pagina = pagine.find((p) => p.percorso === percorso);
  if (!pagina) return null;
  const casa = percorso === '/';
  const colore = hex(dati.colore);
  const logo = https(dati.logo);

  // ARMONIA NASCOSTA: la firma dal nome e dalla data che non cambia. Tono e metallo sono il secondo colore.
  const firma = firmaDi({ nome: dati.nome, data: dati.nascita });
  const token = Object.entries(tokenCss(firma) as Record<string, string>).map(([k, v]) => `${k}:${v}`).join(';');
  const [cx, cy] = puntoAureo(610, 377, firma.seme + 1);
  const tramaSvg = `<svg class="trama" aria-hidden="true" focusable="false" viewBox="0 0 610 377" preserveAspectRatio="xMidYMid slice"><path d="${trama(firma.motivo, 610, 377, 34, firma.seme)}" fill="none" stroke="currentColor" stroke-width="1" vector-effect="non-scaling-stroke"/><path d="${rosaEtrusca(cx, cy, 377 * 0.3)}" fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>`;
  const luna = `<svg class="luna" aria-hidden="true" focusable="false" viewBox="-12 -12 24 24" width="10" height="10"><circle r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="${tracciatoLuna(faseLuna(adesso), 10)}" fill="currentColor"/></svg>`;
  const ritardi = ritardiDiAccensione(firma.pianeta, Math.max(1, pagina.sezioni.length));

  const link = (p: PaginaDellaBozza) => (p.percorso === '/' ? dati.base : `${dati.base}${p.percorso}`);
  const menu = pagine.length > 1
    ? `<nav aria-label="Pagine del sito"><ul>${pagine.map((p) => `<li><a href="${esc(link(p))}"${p.percorso === percorso ? ' aria-current="page"' : ''}>${esc(p.titolo)}</a></li>`).join('')}</ul></nav>`
    : '';
  const sezioni = pagina.sezioni
    .map((s, i) => `<section class="sezione" style="animation-delay:${ritardi[i] ?? 0}ms"><h2>${esc(s.titolo)}</h2><p>${esc(s.testo)}</p></section>`)
    .join('');
  const conContatti = paginaDeiContatti(pagine) === percorso || pagine.length === 1;
  const m = mappa(dati);
  const titoloPagina = casa ? `${dati.nome}${dati.citta ? ` · ${dati.citta}` : ''}` : `${pagina.titolo} · ${dati.nome}`;
  const anno = new Date(adesso).getFullYear();

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titoloPagina)}</title>
<meta name="description" content="${esc(dati.sottotitolo)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${colore}">
<meta property="og:title" content="${esc(titoloPagina)}">
<meta property="og:description" content="${esc(dati.sottotitolo)}">
<meta property="og:type" content="website">
${logo ? `<meta property="og:image" content="${esc(logo)}">` : ''}
<style>
:root{--marchio:${colore};--inchiostro:#2C2A28;--tenue:#5F5A55;--fondo:#FBF7F2;--carta:#fff;--bordo:#EDE4D8;--curva:cubic-bezier(.382,0,.618,1);${token}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--fondo);color:var(--inchiostro);font:400 1rem/1.618 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--marchio)}
h1,h2,h3{font-family:Georgia,"Times New Roman",serif;font-weight:700;line-height:1.236;margin:0}
.salta{position:absolute;left:-999px}.salta:focus{left:13px;top:13px;background:var(--carta);padding:8px 13px;z-index:9}
.contenitore{max-width:987px;margin:0 auto;padding:0 21px}
header.testata{position:relative;overflow:hidden;isolation:isolate;background:linear-gradient(160deg,color-mix(in srgb,var(--marchio) 10%,var(--fondo)),var(--fondo) 61.8%);border-bottom:1px solid var(--bordo)}
.trama{position:absolute;inset:0;width:100%;height:100%;z-index:-1;color:var(--armonia-tono);opacity:.06;pointer-events:none;-webkit-mask-image:radial-gradient(ellipse at center,transparent 38%,#000 82%);mask-image:radial-gradient(ellipse at center,transparent 38%,#000 82%)}
.barra{display:flex;align-items:center;justify-content:space-between;gap:13px;flex-wrap:wrap;padding:21px 0 13px}
.marchio{display:flex;align-items:center;gap:13px;text-decoration:none;color:var(--inchiostro);font:700 1.15rem/1.2 Georgia,serif}
.marchio img{width:55px;height:55px;object-fit:cover;border-radius:var(--armonia-raggio,13px);background:var(--carta)}
nav ul{display:flex;gap:8px;list-style:none;margin:0;padding:0;flex-wrap:wrap}
nav a{display:inline-block;padding:8px 13px;border-radius:999px;text-decoration:none;color:var(--inchiostro);font-weight:600;font-size:.95rem}
nav a:hover{background:color-mix(in srgb,var(--marchio) 10%,transparent)}
nav a[aria-current=page]{background:var(--marchio);color:#fff}
.copertina{padding:34px 0 55px}
.copertina h1{font-size:clamp(2.1rem,7vw,4.25rem);letter-spacing:-.01em}
.copertina p{max-width:38em;font-size:1.15rem;color:var(--tenue);margin:13px 0 0}
.titolo-pagina{padding:21px 0 34px}
.titolo-pagina h1{font-size:clamp(1.75rem,5vw,2.6rem)}
.pulsanti{display:flex;gap:8px;flex-wrap:wrap;margin:21px 0 0}
.pulsante{display:inline-block;padding:13px 21px;border-radius:var(--armonia-raggio,13px);background:var(--marchio);color:#fff;text-decoration:none;font-weight:700}
.pulsante.chiaro{background:var(--carta);color:var(--marchio);border:1px solid var(--bordo)}
main.contenitore{padding:34px 21px 55px}
.sezioni{display:grid;gap:21px}
@media (min-width:720px){.sezioni{grid-template-columns:1fr 1fr}.sezioni .sezione:first-child:nth-last-child(odd){grid-column:1/-1}}
.sezione{background:var(--carta);border:1px solid var(--bordo);border-radius:var(--armonia-raggio,13px);padding:21px 21px 13px;border-top:3px solid color-mix(in srgb,var(--armonia-tono) 61.8%,var(--marchio));animation:entra var(--armonia-durata,333ms) var(--curva) both}
.sezione h2{font-size:1.4rem}
.sezione p{margin:8px 0}
.galleria{display:grid;grid-template-columns:repeat(auto-fill,minmax(233px,1fr));gap:13px;margin-top:34px}
.galleria img{width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:var(--armonia-raggio,13px)}
.contatti{margin-top:34px;background:var(--carta);border:1px solid var(--bordo);border-radius:var(--armonia-raggio,13px);padding:21px}
.contatti h2{font-size:1.6rem;margin-bottom:13px}
.contatti h3{font-size:1.1rem;margin-bottom:8px}
.contatti-griglia{display:grid;gap:21px}
@media (min-width:720px){.contatti-griglia{grid-template-columns:61.8fr 38.2fr}}
.voce{margin:0 0 13px}.etichetta{display:block;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tenue)}
.orari{border-collapse:collapse;width:100%}.orari th,.orari td{text-align:left;padding:5px 0;border-bottom:1px solid var(--bordo);font-weight:400}.orari th{font-weight:600;padding-right:13px}
footer{border-top:1px solid var(--bordo);padding:21px 0 34px;color:var(--tenue);font-size:.9rem}
footer .riga{display:flex;justify-content:space-between;gap:13px;flex-wrap:wrap;align-items:center}
footer a{color:var(--tenue)}
.luna{color:var(--armonia-metallo);vertical-align:middle;margin-left:5px}
@keyframes entra{from{opacity:.4;transform:translateY(5px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sezione{animation:none}}
@media (forced-colors:active),(prefers-contrast:more){.trama{display:none}}
</style>
</head>
<body>
<a class="salta" href="#contenuto">Vai al contenuto</a>
<header class="testata">
${tramaSvg}
<div class="contenitore">
  <div class="barra">
    <a class="marchio" href="${esc(dati.base)}">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(dati.nome)}</span></a>
    ${menu}
  </div>
  ${casa
    ? `<div class="copertina"><h1>${esc(dati.nome)}</h1><p>${esc(dati.sottotitolo)}</p>${m || dati.telefono ? `<p class="pulsanti">${m ? `<a class="pulsante" href="${esc(m)}" rel="noopener" target="_blank">Come arrivare</a>` : ''}${dati.telefono ? `<a class="pulsante chiaro" href="tel:${esc(telefonoPerLink(dati.telefono))}">Chiama</a>` : ''}</p>` : ''}</div>`
    : `<div class="titolo-pagina"><h1>${esc(pagina.titolo)}</h1></div>`}
</div>
</header>
<main id="contenuto" class="contenitore">
  ${sezioni ? `<div class="sezioni">${sezioni}</div>` : ''}
  ${casa ? galleria(dati) : ''}
  ${conContatti ? bloccoContatti(dati) : ''}
</main>
<footer>
  <div class="contenitore riga">
    <span>© ${anno} ${esc(dati.nome)}${dati.indirizzo ? ` · ${esc(dati.indirizzo)}` : ''}</span>
    <span>Sito curato da <a href="https://www.mycity-marketplace.com/">MyCity</a>${luna}</span>
  </div>
</footer>
</body>
</html>`;
}
