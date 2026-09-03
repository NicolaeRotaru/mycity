/**
 * 3/9/2026 — SUI PRODOTTI SCONTATI IL «+» DELLA CARD FINIVA FUORI DALLA CARD.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────
 * Nella griglia del catalogo, su un telefono da 360 punti, le schede stanno a due colonne: dentro
 * ognuna restano 138 punti. Sull'ultima riga della scheda ci sono tre cose in fila: il prezzo, il
 * prezzo pieno barrato e il pulsante «+» che aggiunge al carrello.
 *
 * Nessuno dei due prezzi poteva stringersi, e «€129.90» è una parola sola: non ha un punto dove
 * andare a capo. La riga chiedeva più larghezza di quella disponibile, e la scheda taglia quello che
 * sborda (`overflow-hidden`). Il pezzo tagliato era l'ultimo della fila, cioè il «+».
 *
 * Quindi: i prodotti SCONTATI — quelli che si vogliono far comprare di più — erano gli unici che dal
 * telefono non si potevano aggiungere al carrello. I prodotti senza sconto stavano dentro.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────
 * Rifà il conto, con le misure lette dalle classi vere (la griglia, l'imbottitura della scheda, lo
 * spazio della riga, il lato del pulsante). Non cerca parole:
 *
 *   ① il conto parte da numeri letti dai file, non riscritti qui;
 *   ② con un prezzo scontato a tre cifre la coppia dei prezzi chiede più spazio di quello che c'è:
 *      è la diagnosi, ed è la ragione per cui servono le protezioni qui sotto;
 *   ③ quello che cede è il prezzo, mai il pulsante: la riga sta dentro la scheda perché la coppia
 *      dei prezzi può stringersi (`min-w-0`), non perché il «+» si rimpicciolisce (`shrink-0`);
 *   ④ il prezzo grande, da solo, ci sta: il barrato va a capo (`flex-wrap`) invece di essere tagliato;
 *   ⑤ e quello che avanza viene tagliato dal riquadro dei prezzi (`overflow-hidden`), non stampato
 *      sopra il pulsante.
 *
 * ⚠️ Cosa NON prova: che a schermo sia bello. La larghezza del testo è stimata da una costante
 * dichiarata qui sotto, non misurata da un browser — l'occhio su un telefono vero resta da fare.
 * Nelle file orizzontali della home la scheda è larga 160 punti, cioè due più che in griglia: il
 * conto peggiore è quello della griglia, ed è quello che si fa qui.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatPrice } from '@/lib/format';

const CARD = readFileSync('components/ProductCard.tsx', 'utf8');
const GRIGLIA = readFileSync('lib/griglia-prodotti.ts', 'utf8');

/**
 * Le assunzioni del conto, dichiarate. Il telefono più stretto in giro è 360 punti; il contenitore
 * delle pagine di catalogo a quella misura è largo quanto lo schermo, meno `px-4`. La larghezza di
 * un carattere in grassetto è stimata al 58% del corpo: è una stima, non una misura di browser (la
 * stessa che usa `da-ogni-larghezza-si-riesce-a-comprare`).
 */
const SCHERMO = 360;
const IMBOTTITURA_PAGINA = 4; // px-4, in scala Tailwind
const PER_CARATTERE = 0.58;
const larghezzaTesto = (testo: string, corpoPx: number) => testo.length * corpoPx * PER_CARATTERE;
const spaziatura = (n: number) => n * 4; // scala Tailwind: 1 = 0.25rem

/** Le classi del div aperto per ultimo prima di un pezzo di codice: il contenitore che lo avvolge. */
function contenitoreDi(pezzo: string, indietro = 1): string {
  const i = CARD.indexOf(pezzo);
  expect(i, `nella scheda non c'è più «${pezzo}»: questa prova non misura niente`).toBeGreaterThan(-1);
  const aperti = [...CARD.slice(0, i).matchAll(/<div className="([^"]+)"/g)];
  return aperti[aperti.length - indietro]?.[1] ?? '';
}

/** Il corpo della scheda: quello con l'imbottitura che toglie spazio alla riga del prezzo. */
const corpo = CARD.match(/<div className="relative z-10 flex flex-1 flex-col gap-1 p-([\d.]+)"/)?.[1];

/** Il riquadro dei prezzi e la riga che lo contiene insieme al pulsante. */
const riquadroPrezzi = contenitoreDi('{formatPrice(bigPrice)}', 1);
const rigaPrezzo = contenitoreDi('{formatPrice(bigPrice)}', 2);

/** Le classi del pulsante «+», prese dal suo `onClick`. */
const pulsante = (() => {
  const i = CARD.indexOf('onClick={handleAdd}');
  expect(i, 'il pulsante «+» non si trova più: la prova va riscritta').toBeGreaterThan(-1);
  return CARD.slice(i).match(/className="([^"]+)"/)?.[1] ?? '';
})();

/** Quanto è larga una scheda in griglia, sul telefono più stretto. */
const larghezzaScheda = (() => {
  const colonne = Number(GRIGLIA.match(/grid-cols-(\d+)/)?.[1]);
  const distanza = Number(GRIGLIA.match(/DISTANZA_GRIGLIA = 'gap-(\d+)'/)?.[1]);
  expect(colonne, 'le colonne della griglia non si leggono più: la prova va riscritta').toBeGreaterThan(0);
  expect(distanza, 'la distanza fra le schede non si legge più').toBeGreaterThan(0);
  const utile = SCHERMO - 2 * spaziatura(IMBOTTITURA_PAGINA) - (colonne - 1) * spaziatura(distanza);
  return utile / colonne;
})();

/** Quanto spazio resta dentro la scheda, tolte le due imbottiture del corpo. */
const dentroLaScheda = larghezzaScheda - 2 * spaziatura(Number(corpo));

const latoPulsante = spaziatura(Number(pulsante.match(/\bw-(\d+)\b/)?.[1]));
const spazioRiga = spaziatura(Number(rigaPrezzo.match(/gap-([\d.]+)/)?.[1]));
const spazioFraIPrezzi = spaziatura(Number(riquadroPrezzi.match(/gap-x-([\d.]+)/)?.[1] ?? 0));

/** Quello che resta ai prezzi quando il pulsante ha preso il suo, e non lo cede a nessuno. */
const disponibileAiPrezzi = dentroLaScheda - latoPulsante - spazioRiga;

/** Il caso peggiore vero: un prodotto scontato a tre cifre. `text-base` = 16, il barrato 11. */
const prezzoGrande = larghezzaTesto(formatPrice(129.9), 16);
const prezzoBarrato = larghezzaTesto(formatPrice(185), 11);
const coppiaSuUnaRiga = prezzoGrande + spazioFraIPrezzi + prezzoBarrato;

describe('① il conto si fa su numeri letti dai file, non riscritti qui', () => {
  it('la scheda, il pulsante e gli spazi si leggono davvero', () => {
    expect(Math.round(larghezzaScheda)).toBe(158);
    expect(Math.round(dentroLaScheda)).toBe(138);
    expect(latoPulsante, 'il «+» deve restare un bersaglio da 44 punti, toccabile col pollice').toBe(44);
    expect(spazioRiga).toBeGreaterThan(0);
    expect(spazioFraIPrezzi).toBeGreaterThan(0);
  });

  it('il riquadro dei prezzi e il pulsante stanno davvero nella stessa riga', () => {
    expect(rigaPrezzo, 'la riga del prezzo non è più una fila: la prova va riscritta').toContain('flex');
    expect(riquadroPrezzi, 'i prezzi non stanno più in un riquadro loro').toContain('flex');
  });
});

describe('② col prezzo scontato la riga chiede più spazio di quello che c’è', () => {
  it('la coppia dei prezzi, tutta su una riga, non ci sta accanto al pulsante', () => {
    expect(
      Math.round(coppiaSuUnaRiga),
      `la coppia dei prezzi sta in ${Math.round(disponibileAiPrezzi)} punti: il conto è cambiato, ` +
        'questa prova va rifatta insieme al motivo per cui esiste',
    ).toBeGreaterThan(disponibileAiPrezzi);
  });
});

describe('③ quello che cede è il prezzo, mai il pulsante', () => {
  it('il «+» non si rimpicciolisce e non si sposta fuori', () => {
    expect(pulsante, 'senza questo il pulsante si comprime prima del prezzo').toContain('shrink-0');
    expect(pulsante).toMatch(/\bh-11\b/);
  });

  it('la riga sta dentro la scheda perché i prezzi possono stringersi', () => {
    // Il modello: se il riquadro dei prezzi può stringersi prende al massimo quello che resta;
    // se non può, pretende tutta la sua larghezza e spinge il pulsante oltre il bordo.
    const puoStringersi = /\bmin-w-0\b/.test(riquadroPrezzi);
    const presoDaiPrezzi = puoStringersi ? Math.min(coppiaSuUnaRiga, disponibileAiPrezzi) : coppiaSuUnaRiga;
    const richiesto = presoDaiPrezzi + spazioRiga + latoPulsante;
    expect(
      Math.round(richiesto),
      `la riga chiede ${Math.round(richiesto)} punti dentro una scheda larga ${Math.round(dentroLaScheda)}: ` +
        'quello che sborda lo taglia il bordo della scheda, e l’ultimo della fila è il «+»',
    ).toBeLessThanOrEqual(Math.round(dentroLaScheda));
  });
});

describe('④ il prezzo resta leggibile: il barrato va a capo, non sotto il taglio', () => {
  it('il prezzo grande, da solo, ci sta', () => {
    expect(Math.round(prezzoGrande)).toBeLessThanOrEqual(disponibileAiPrezzi);
  });

  it('e la coppia è libera di andare a capo', () => {
    expect(
      riquadroPrezzi,
      'senza questo il prezzo pieno barrato viene tagliato a metà invece di scendere sotto',
    ).toContain('flex-wrap');
  });
});

describe('⑤ quello che avanza lo taglia il riquadro dei prezzi, non finisce sopra il pulsante', () => {
  it('il riquadro dei prezzi tiene dentro il suo contenuto', () => {
    expect(
      riquadroPrezzi,
      'un riquadro che si stringe senza tagliare stampa la cifra sopra il «+»: il pulsante c’è ma non si vede',
    ).toContain('overflow-hidden');
  });
});
