/**
 * I DISEGNI A UN TRATTO DEI SITI — 28/11/2026.
 *
 * Il sito Business del Caffè di Piacenza (27/11) usa disegni a una linea sola su fondo crema: a Nicola sono piaciuti,
 * e finché un locale non ha le foto vere (le fa SDG alla visita) sono loro a dare vita al sito. Cornetto, panino e
 * calice sono quelli di quel sito (public/siti/disegni, fatti da noi); gli altri sono tracciati qui, con lo stesso
 * tratto. Mai un disegno che finge di essere una foto del locale.
 */

export const DISEGNI = ['tazza', 'cornetto', 'panino', 'calice', 'vino', 'pizza', 'gelato', 'torta', 'pane', 'fiore', 'borsa', 'forbici', 'stella'] as const;
export type Disegno = (typeof DISEGNI)[number];

/** Quelli che sono immagini (public/siti/disegni/<nome>.png), con la loro misura. */
const IMMAGINI: Partial<Record<Disegno, [number, number]>> = {
  cornetto: [600, 297],
  panino: [600, 226],
  calice: [600, 452],
};

const cerchio = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** I tracciati, in un riquadro 160 × 110. */
const TRACCIATI: Partial<Record<Disegno, string[]>> = {
  tazza: ['M26 94Q80 106 134 94', 'M46 52L51 84Q80 95 109 84L114 52', 'M46 52Q80 61 114 52', 'M113 60Q132 59 130 72Q128 83 108 81', 'M70 42Q63 32 71 24Q79 16 73 7', 'M90 42Q83 32 91 24Q99 16 93 9'],
  vino: ['M62 10L98 10Q101 46 80 55Q59 46 62 10Z', 'M64 30Q80 35 96 30', 'M80 55L80 92', 'M60 95Q80 88 100 95'],
  pizza: ['M38 20Q80 4 122 20L80 102Z', 'M40 20Q80 6 120 20Q123 29 116 31Q80 17 44 31Q37 29 40 20', cerchio(70, 42, 6), cerchio(92, 46, 5), cerchio(80, 66, 5)],
  gelato: ['M58 50L80 103L102 50', 'M64 63L96 61', 'M69 77L91 75', 'M56 50Q52 30 70 28Q74 13 89 17Q106 17 105 34Q112 44 104 50Z'],
  torta: ['M26 92L134 92', 'M36 92L36 56Q80 45 124 56L124 92', 'M36 67Q47 74 58 67Q69 74 80 67Q91 74 102 67Q113 74 124 67', 'M80 49L80 33', 'M80 33Q73 25 80 16Q87 25 80 33'],
  pane: ['M26 70Q26 38 80 36Q134 38 134 70Q134 88 80 88Q26 88 26 70Z', 'M54 50Q61 60 56 72', 'M80 46Q87 58 82 72', 'M106 50Q113 60 108 72'],
  fiore: ['M80 104Q77 72 80 50', 'M80 84Q60 77 54 63Q72 64 80 77', 'M80 74Q101 66 108 52Q90 54 80 68', cerchio(80, 40, 6), ...[0, 72, 144, 216, 288].map((g) => `ROT${g}M80 34Q70 16 80 6Q90 16 80 34`)],
  borsa: ['M42 40L118 40L124 102L36 102Z', 'M62 40Q62 16 80 16Q98 16 98 40', 'M56 58Q80 66 104 58'],
  forbici: [cerchio(46, 80, 13), cerchio(84, 92, 13), 'M56 71L132 18', 'M93 82L136 36', 'M70 66L88 58'],
  stella: ['M80 12Q86 46 118 52Q86 58 80 94Q74 58 42 52Q74 46 80 12Z', 'M124 18Q126 28 134 30Q126 32 124 42Q122 32 114 30Q122 28 124 18Z'],
};

/** Il disegno come HTML: l'immagine o l'SVG col colore del testo. `alt` vuoto: è decorazione. */
export function disegnoHtml(d: Disegno, classe = 'disegno'): string {
  const img = IMMAGINI[d];
  if (img) return `<img class="${classe}" src="/siti/disegni/${d}.png" width="${img[0]}" height="${img[1]}" alt="" loading="lazy" decoding="async">`;
  const tracce = (TRACCIATI[d] ?? TRACCIATI.stella)!
    .map((t) => {
      const m = /^ROT(\d+)(.*)$/.exec(t);
      return m ? `<path d="${m[2]}" transform="rotate(${m[1]} 80 40)"/>` : `<path d="${t}"/>`;
    })
    .join('');
  return `<svg class="${classe}" viewBox="0 0 160 110" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${tracce}</svg>`;
}

/** Il disegno che va meglio con una parola («Colazione» → cornetto). Senza indizi, la stella. */
export function disegnoPer(testo: string): Disegno {
  const t = testo.toLowerCase();
  const regole: [RegExp, Disegno][] = [
    [/colazion|brioch|cornett|pasticc|dolc[ei] da forno|croiss/, 'cornetto'],
    [/aperitiv|cocktail|spritz|drink|seral|serat|\bbirr/, 'calice'],
    [/vin[oi]\b|enotec|cantin|calic/, 'vino'],
    [/pranz|panin|focacc|piadin|tramezz|salat/, 'panino'],
    [/pizz/, 'pizza'],
    [/gelat/, 'gelato'],
    [/tort|pasticcer|dolc/, 'torta'],
    [/pane|forn[oi]\b|panific/, 'pane'],
    [/fior|floreal|piant|verde|bouquet/, 'fiore'],
    [/parrucch|capell|barbier|estetic/, 'forbici'],
    [/negozi|boutique|abbigliam|regal|bottega/, 'borsa'],
    [/\bcaff|cappucc|espresso|\bbar\b|\btè\b|\bthe\b/, 'tazza'],
  ];
  return regole.find(([r]) => r.test(t))?.[1] ?? 'stella';
}
