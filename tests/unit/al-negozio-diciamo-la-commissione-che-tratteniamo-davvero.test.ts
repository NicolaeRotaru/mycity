import { describe, it, expect } from 'vitest';
import { TOPICS } from '@/app/seller/help/domande';
import { computeApplicationFeeCents } from '@/lib/stripe/client';

/**
 * 30/8/2026 (R037) — «PAGHI L'8%» SCRITTO AL NEGOZIO, IL 10% TRATTENUTO IN CASSA.
 *
 * Il Centro venditori rispondeva alla domanda «Quanto tratteniamo?» con «L'8%
 * sul venduto effettivamente concluso», mentre il conto che divide i soldi di
 * ogni ordine — `computeApplicationFeeCents`, che legge `MARKETPLACE_FEE_BPS` —
 * ne tratteneva il 10. Su mille euro di venduto sono venti euro al mese di
 * differenza fra quello che il negoziante si aspetta e quello che gli arriva:
 * la scopre da solo, guardando il bonifico, e da quel momento non crede piu' a
 * nessun numero scritto da noi.
 *
 * Questa prova non guarda com'e' scritto il codice: prende la risposta vera che
 * il negoziante legge nel Centro venditori, ne estrae la percentuale, e la
 * confronta con i soldi che vengono davvero trattenuti su un ordine da 100 €.
 * Se le due cose tornano a divergere — perche' qualcuno riscrive la frase a
 * mano, o perche' la commissione cambia e la frase resta indietro — diventa
 * rossa.
 */

/** Le percentuali citate in una frase, es. «Il 10% sul venduto» → [10]. */
function percentualiCitate(testo: string): number[] {
  return [...testo.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Number(m[1].replace(',', '.')));
}

/** Quanto trattiene davvero la cassa, in percentuale, su un venduto di 100 €. */
const percentualeTrattenutaDavvero = (computeApplicationFeeCents(10_000) / 10_000) * 100;

const risposte = TOPICS.flatMap((t) => t.items);

describe('la commissione promessa al negozio e quella trattenuta', () => {
  it('la risposta «Quanto tratteniamo?» cita la percentuale che finisce davvero in cassa', () => {
    const risposta = risposte.find((r) => r.q.toLowerCase().includes('quanto tratteniamo'));
    expect(risposta, 'la domanda sulla commissione e sparita dal Centro venditori').toBeTruthy();
    expect(
      percentualiCitate(risposta!.a),
      `al negozio scriviamo «${risposta!.a}» ma su 100 € di venduto ne tratteniamo ${percentualeTrattenutaDavvero}%`,
    ).toEqual([percentualeTrattenutaDavvero]);
  });

  it('nessuna risposta sui soldi del negozio promette una percentuale diversa da quella vera', () => {
    const sbagliate = risposte
      .filter((r) => /venduto|trattenia|commissione|percentuale/i.test(`${r.q} ${r.a}`))
      .flatMap((r) => percentualiCitate(r.a).map((p) => ({ q: r.q, a: r.a, p })))
      .filter((x) => x.p !== percentualeTrattenutaDavvero);
    expect(
      sbagliate.map((x) => `«${x.q}» promette ${x.p}%`),
      `il negozio legge una percentuale, in cassa ne tratteniamo ${percentualeTrattenutaDavvero}%`,
    ).toEqual([]);
  });
});
