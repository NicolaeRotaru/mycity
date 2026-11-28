import type { Cliente, Stato } from './clienti';

/**
 * Come si mostrano i clienti sulla mappa e nella lista (28/11/2026). Senza React, per provarlo da solo.
 * Il colore del puntino dice lo stato, nell'ordine in cui conta per chi guarda:
 *  1. dopo la visita: sì o iscritta (verde), no (rosso scuro), visitata (ambra);
 *  2. altrimenti la prenotazione: presa da me (terracotta), presa da un altro (grigio), libera (blu inchiostro chiaro).
 */

export type Colore = 'si' | 'no' | 'visitata' | 'mia' | 'altro' | 'libera';

export function coloreDi(c: Pick<Cliente, 'stato' | 'presa'>): Colore {
  if (c.stato === 'si' || c.stato === 'iscritta') return 'si';
  if (c.stato === 'no') return 'no';
  if (c.stato === 'visitata') return 'visitata';
  if (c.presa === 'mia') return 'mia';
  if (c.presa === 'altro') return 'altro';
  return 'libera';
}

export const COLORI: Record<Colore, { tinta: string; parola: string }> = {
  libera: { tinta: '#3B6EA8', parola: 'libera' },
  mia: { tinta: '#C0492C', parola: 'presa da me' },
  altro: { tinta: '#8A8580', parola: 'presa da un altro' },
  visitata: { tinta: '#E8A33D', parola: 'visitata' },
  si: { tinta: '#5A7C42', parola: 'sì / iscritta' },
  no: { tinta: '#651C1A', parola: 'no' },
};

export type Ordine = 'priorita' | 'distanza' | 'vicino' | 'tipo' | 'stato' | 'mie';

export const ORDINI: { valore: Ordine; parola: string }[] = [
  { valore: 'priorita', parola: 'Priorità' },
  { valore: 'distanza', parola: 'Distanza da Pane Quotidiano' },
  { valore: 'vicino', parola: 'Vicino a me' },
  { valore: 'tipo', parola: 'Tipo' },
  { valore: 'stato', parola: 'Stato' },
  { valore: 'mie', parola: 'Le mie per prime' },
];

const PESO_STATO: Record<Colore, number> = { mia: 0, libera: 1, visitata: 2, si: 3, no: 4, altro: 5 };
const perPriorita = (a: Cliente, b: Cliente) => (b.punteggio ?? -1) - (a.punteggio ?? -1) || (a.distanzaM ?? 1e9) - (b.distanzaM ?? 1e9) || a.nome.localeCompare(b.nome, 'it');

/** Metri fra due punti (formula dell'emisenoverso), come nel flusso 16. */
export function metriFra(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Ordina senza toccare l'elenco di partenza. A parità, sempre la priorità. */
export function ordina(clienti: Cliente[], ordine: Ordine, io?: { lat: number; lon: number } | null): Cliente[] {
  const l = [...clienti];
  const daMe = (c: Cliente) => (io && c.lat !== null && c.lon !== null ? metriFra(io, { lat: c.lat, lon: c.lon }) : 1e9);
  switch (ordine) {
    case 'distanza': return l.sort((a, b) => (a.distanzaM ?? 1e9) - (b.distanzaM ?? 1e9) || perPriorita(a, b));
    case 'vicino': return io ? l.sort((a, b) => daMe(a) - daMe(b) || perPriorita(a, b)) : l.sort(perPriorita);
    case 'tipo': return l.sort((a, b) => (a.tipo ?? '~').localeCompare(b.tipo ?? '~', 'it') || perPriorita(a, b));
    case 'stato': return l.sort((a, b) => PESO_STATO[coloreDi(a)] - PESO_STATO[coloreDi(b)] || perPriorita(a, b));
    case 'mie': return l.sort((a, b) => Number(b.presa === 'mia') - Number(a.presa === 'mia') || perPriorita(a, b));
    default: return l.sort(perPriorita);
  }
}

/**
 * Chi si vede: tutte quelle in fila; quelle uscite dalla fila (chiuse, ora su MyCity) solo se qualcuno ci ha già
 * lavorato (prese, visitate o proposte), così la storia non sparisce. Le «escluse» non si mostrano mai.
 */
export const daMostrare = (c: Cliente) => c.stato !== 'esclusa' && (c.inFila || c.presa !== 'libera' || c.stato !== 'da_visitare' || Boolean(c.settimana));

export const metri = (m: number | null) => (m === null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`);

/** Il numero da toccare per chiamare: solo cifre e un «+» davanti. */
export function telDaChiamare(t: string | null): string | null {
  if (!t) return null;
  const pulito = t.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return pulito.replace(/\D/g, '').length >= 6 ? pulito : null;
}

export const STATI_DOPO_LA_VISITA: Stato[] = ['visitata', 'si', 'no', 'iscritta'];

/**
 * 28/11/2026, 02:15 — Nicola: «nella mappa al posto dei puntini è possibile vedere l'icona della categoria di
 * attività». La categoria si legge dal `tipo` e dal `segmento` del flusso 16; quello che non si riconosce va su
 * «altri negozi», mai a vuoto. Lo stato resta il colore dello sfondo dell'icona.
 */
export type Categoria = 'panetteria' | 'macelleria' | 'frutta' | 'formaggi' | 'pasticceria' | 'regali' | 'persona' | 'ristoro' | 'artigiani' | 'altri';

export const CATEGORIE: Record<Categoria, string> = {
  panetteria: 'panetteria',
  macelleria: 'macelleria',
  frutta: 'frutta e verdura',
  formaggi: 'formaggi e gastronomia',
  pasticceria: 'pasticceria',
  regali: 'enoteca, fiori e regali',
  persona: 'cura della persona',
  ristoro: 'bar e ristoranti',
  artigiani: 'artigiani',
  altri: 'altri negozi',
};

const PER_TIPO: [RegExp, Categoria][] = [
  [/panetteria|panificio|forno|forneria/, 'panetteria'],
  [/macelleria|salumeria/, 'macelleria'],
  [/frutta|verdura|fattoria|biologico|naturali/, 'frutta'],
  [/formaggi|gastronomia|latteria|alimentari|pasta fresca|drogheria/, 'formaggi'],
  [/pasticceria|cioccolat|dolciumi/, 'pasticceria'],
  [/enoteca|fiorist|fioraio|regali|vivaio|libreria|giocattoli|cartoleria|gioielleria|profumeria|caff[eè] in grani|^t[eè]$|bevande|alcolici|arte|antiquariato/, 'regali'],
  [/parrucchier|barbiere|estetic|ottica|cosmetic|erboristeria|farmacia|tatuaggi/, 'persona'],
  [/ristorante|^bar$|caffetteria|pub|gelateria|pizzeria|trattoria|asporto/, 'ristoro'],
  [/^artigian/, 'artigiani'],
];
const PER_SEGMENTO: Record<string, Categoria> = {
  regali: 'regali', 'cura della persona': 'persona', 'bar e ristoranti': 'ristoro', artigiani: 'artigiani', fresco: 'formaggi',
};

export function categoriaDi(c: Pick<Cliente, 'tipo' | 'segmento'>): Categoria {
  const tipo = (c.tipo ?? '').trim().toLowerCase();
  for (const [re, cat] of PER_TIPO) if (tipo && re.test(tipo)) return cat;
  return PER_SEGMENTO[(c.segmento ?? '').trim().toLowerCase()] ?? 'altri';
}
