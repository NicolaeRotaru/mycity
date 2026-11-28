/**
 * ARMONIA NASCOSTA — le forme (Nicola, 28/11/2026).
 *
 * Tracciati SVG costruiti col compasso: geometria sacra del Mediterraneo, motivi giapponesi,
 * islamici e cinesi, la rosa a sedici settori degli aruspici etruschi di Piacenza. Si disegnano
 * quasi trasparenti, dietro al contenuto, e sembrano solo una trama.
 *
 * Volutamente qui NON c'è un generatore di stelle a cinque o sei punte: il pentagramma e la stella
 * di David non si possono disegnare con questa libreria (vedi `simboli.ts`, VIETATI).
 */
import { PHI } from './numeri';

const n = (v: number) => Math.round(v * 10) / 10;

export const cerchio = (cx: number, cy: number, r: number): string =>
  `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)}Z`;

/** Un poligono regolare con almeno 3 lati, con un vertice in alto. */
export function poligono(cx: number, cy: number, r: number, lati: number, rotazione = -Math.PI / 2): string {
  const k = Math.max(3, Math.round(lati));
  let d = '';
  for (let i = 0; i < k; i++) {
    const a = rotazione + (i * 2 * Math.PI) / k;
    d += `${i ? 'L' : 'M'}${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`;
  }
  return `${d}Z`;
}

/** La mandorla (vesica piscis): l'incrocio di due cerchi di raggio r coi centri a distanza r. */
export function vesica(cx: number, cy: number, r: number, verticale = true): string {
  const h = (r * Math.sqrt(3)) / 2;
  return verticale
    ? `M${n(cx)} ${n(cy - h)}A${n(r)} ${n(r)} 0 0 1 ${n(cx)} ${n(cy + h)}A${n(r)} ${n(r)} 0 0 1 ${n(cx)} ${n(cy - h)}Z`
    : `M${n(cx - h)} ${n(cy)}A${n(r)} ${n(r)} 0 0 1 ${n(cx + h)} ${n(cy)}A${n(r)} ${n(r)} 0 0 1 ${n(cx - h)} ${n(cy)}Z`;
}

/** I centri del reticolo esagonale entro `anelli` passi dal centro. */
function centriEsagonali(cx: number, cy: number, r: number, anelli: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let j = -anelli; j <= anelli; j++) {
    for (let i = -2 * anelli; i <= 2 * anelli; i++) {
      const x = cx + r * (i + j / 2);
      const y = cy + (r * j * Math.sqrt(3)) / 2;
      if (Math.hypot(x - cx, y - cy) <= r * anelli + 0.01) out.push([x, y]);
    }
  }
  return out;
}

/** Il seme della vita: sette cerchi. */
export const semeDellaVita = (cx: number, cy: number, r: number): string =>
  centriEsagonali(cx, cy, r, 1).map(([x, y]) => cerchio(x, y, r)).join('');

/** Il fiore della vita: diciannove cerchi e il cerchio che li chiude. */
export const fioreDellaVita = (cx: number, cy: number, r: number): string =>
  centriEsagonali(cx, cy, r, 2).map(([x, y]) => cerchio(x, y, r)).join('') + cerchio(cx, cy, r * 3);

/** La rosa etrusca: i sedici settori del cielo sul bordo del Fegato di Piacenza. */
export function rosaEtrusca(cx: number, cy: number, r: number): string {
  let d = cerchio(cx, cy, r) + cerchio(cx, cy, r / PHI);
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    d += `M${n(cx + (Math.cos(a) * r) / PHI)} ${n(cy + (Math.sin(a) * r) / PHI)}L${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`;
  }
  return d;
}

export type Spirale = { tracciato: string; occhio: readonly [number, number]; quadrati: Array<readonly [number, number, number]> };

/**
 * La spirale aurea dentro un rettangolo: si toglie un quadrato dopo l'altro e in ognuno si traccia
 * un quarto di cerchio. Funziona bene se il rettangolo è aureo (lato lungo = corto × 1,618).
 */
export function spiraleAurea(x0: number, y0: number, w0: number, h0: number, passi = 10): Spirale {
  let x = x0, y = y0, w = w0, h = h0;
  let dir = w >= h ? 0 : 1;
  let tracciato = '';
  const quadrati: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < passi; i++) {
    let s: number, a: [number, number], b: [number, number];
    if (dir === 0) { s = h; quadrati.push([x, y, s]); a = [x, y + s]; b = [x + s, y]; x += s; w -= s; }
    else if (dir === 1) { s = w; quadrati.push([x, y, s]); a = [x, y]; b = [x + s, y + s]; y += s; h -= s; }
    else if (dir === 2) { s = h; quadrati.push([x + w - s, y, s]); a = [x + w, y]; b = [x + w - s, y + s]; w -= s; }
    else { s = w; quadrati.push([x, y + h - s, s]); a = [x + s, y + h]; b = [x, y + h - s]; h -= s; }
    if (s <= 0.5 || w < 0 || h < 0) { quadrati.pop(); break; }
    tracciato += `${i === 0 ? `M${n(a[0])} ${n(a[1])}` : ''}A${n(s)} ${n(s)} 0 0 1 ${n(b[0])} ${n(b[1])}`;
    dir = (dir + 1) % 4;
  }
  return { tracciato, occhio: [x + Math.max(w, 0) / 2, y + Math.max(h, 0) / 2], quadrati };
}

/** Uno dei quattro incroci delle linee auree di un riquadro, scelto dal seme. */
export function puntoAureo(w: number, h: number, seme = 0): readonly [number, number] {
  const a = 1 / PHI, b = 1 - 1 / PHI;
  const scelte = [[a, b], [b, b], [a, a], [b, a]] as const;
  const [fx, fy] = scelte[Math.abs(seme) % 4];
  return [w * fx, h * fy];
}

// ---------- le trame: motivi che si ripetono su tutto un riquadro ----------

function triangoli(w: number, h: number, p: number): string {
  let d = '';
  const t = p * 0.32;
  for (let y = p; y < h + p; y += p * 1.3) for (let x = p * 0.6; x < w + p; x += p * 1.3)
    d += `M${n(x)} ${n(y - t)}L${n(x + t * 0.87)} ${n(y + t * 0.5)}L${n(x - t * 0.87)} ${n(y + t * 0.5)}Z`;
  return d;
}

function quadratini(w: number, h: number, p: number): string {
  let d = '';
  const t = p * 0.5;
  for (let y = p * 0.7; y < h + p; y += p * 1.3) for (let x = p * 0.7; x < w + p; x += p * 1.3)
    d += `M${n(x - t / 2)} ${n(y - t / 2)}h${n(t)}v${n(t)}h${n(-t)}Z`;
  return d;
}

function onde(w: number, h: number, p: number): string {
  let d = '';
  for (let y = p; y < h + p; y += p * 1.1) {
    d += `M0 ${n(y)}`;
    for (let x = 0; x < w + p; x += p * 2) d += `q${n(p / 2)} ${n(-p * 0.45)} ${n(p)} 0t${n(p)} 0`;
  }
  return d;
}

function cerchiConcentrici(w: number, h: number, p: number, cx: number, cy: number): string {
  let d = '';
  const max = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
  for (let r = p; r < max; r += p * PHI) d += cerchio(cx, cy, r);
  return d;
}

/** Kikkō, il guscio di tartaruga giapponese: lunga vita. */
function esagoni(w: number, h: number, p: number): string {
  let d = '';
  const a = p * 0.75;
  for (let i = 0; i * 1.5 * a < w + a; i++) for (let j = 0; j * Math.sqrt(3) * a < h + a; j++) {
    const cx = i * 1.5 * a;
    const cy = j * Math.sqrt(3) * a + (i % 2 ? (Math.sqrt(3) * a) / 2 : 0);
    d += poligono(cx, cy, a * 0.92, 6, 0);
  }
  return d;
}

/** Asanoha, la foglia di canapa giapponese: crescita e protezione. Triangoli con le loro mediane. */
function asanoha(w: number, h: number, p: number): string {
  const s = p * 1.6;
  const hh = (s * Math.sqrt(3)) / 2;
  let d = '';
  for (let j = 0; j * hh < h + hh; j++) {
    const off = j % 2 ? -s / 2 : 0;
    const y = j * hh;
    for (let x = off; x < w + s; x += s) {
      const su: Array<[number, number]> = [[x, y + hh], [x + s, y + hh], [x + s / 2, y]];
      const giu: Array<[number, number]> = [[x + s / 2, y], [x + (3 * s) / 2, y], [x + s, y + hh]];
      for (const t of [su, giu]) {
        const gx = (t[0][0] + t[1][0] + t[2][0]) / 3;
        const gy = (t[0][1] + t[1][1] + t[2][1]) / 3;
        d += `M${n(t[0][0])} ${n(t[0][1])}L${n(t[1][0])} ${n(t[1][1])}L${n(t[2][0])} ${n(t[2][1])}Z`;
        for (const [vx, vy] of t) d += `M${n(vx)} ${n(vy)}L${n(gx)} ${n(gy)}`;
      }
    }
  }
  return d;
}

/** Seigaiha, le onde del mare giapponesi: calma e fortuna. Ventagli di archi concentrici. */
function seigaiha(w: number, h: number, p: number): string {
  const r = p;
  let d = '';
  for (let j = 0; (j * r) / 2 < h + r; j++) {
    const off = j % 2 ? r : 0;
    const cy = (j * r) / 2 + r;
    for (let cx = off - r; cx < w + r; cx += 2 * r)
      for (const k of [1, 0.75, 0.5]) d += `M${n(cx - r * k)} ${n(cy)}A${n(r * k)} ${n(r * k)} 0 0 1 ${n(cx + r * k)} ${n(cy)}`;
  }
  return d;
}

/** Le stelle a otto punte delle piastrelle islamiche: due quadrati incrociati, ripetuti come trama. */
function stelleOtto(w: number, h: number, p: number): string {
  let d = '';
  const passo = p * 1.618;
  const r = passo * 0.36;
  for (let y = passo / 2; y < h + passo; y += passo) for (let x = passo / 2; x < w + passo; x += passo)
    d += poligono(x, y, r, 4, 0) + poligono(x, y, r, 4, Math.PI / 4);
  return d;
}

export type Motivo =
  | 'fiore-della-vita' | 'seme-della-vita' | 'rosa-etrusca' | 'cerchi'
  | 'triangoli' | 'quadrati' | 'onde' | 'esagoni' | 'asanoha' | 'seigaiha' | 'stelle-otto';

/** Il tracciato di un motivo dentro un riquadro w×h. `passo` è la misura del modulo, `seme` sposta il centro. */
export function trama(motivo: Motivo, w: number, h: number, passo = 34, seme = 0): string {
  const [cx, cy] = puntoAureo(w, h, seme);
  const m = Math.min(w, h);
  switch (motivo) {
    case 'fiore-della-vita': return fioreDellaVita(cx, cy, m * 0.09);
    case 'seme-della-vita': return semeDellaVita(cx, cy, m * 0.12);
    case 'rosa-etrusca': return rosaEtrusca(cx, cy, m * 0.3);
    case 'cerchi': return cerchiConcentrici(w, h, passo, cx, cy);
    case 'triangoli': return triangoli(w, h, passo);
    case 'quadrati': return quadratini(w, h, passo);
    case 'onde': return onde(w, h, passo);
    case 'esagoni': return esagoni(w, h, passo);
    case 'asanoha': return asanoha(w, h, passo);
    case 'seigaiha': return seigaiha(w, h, passo);
    case 'stelle-otto': return stelleOtto(w, h, passo);
  }
}
