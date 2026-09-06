/**
 * 6/9/2026 — IL TERZO SENSORE CONTAVA ANCORA OGNI FILTRO COME UNA PAGINA NUOVA.
 *
 * Il 27/8 (R171) la cura era arrivata a due sensori su tre: il beacon delle attività
 * (`components/ActivityTracker.tsx`) e Google Analytics (`components/GoogleAnalytics.tsx`)
 * erano passati a `chiaveDellaPaginaVista`, cioè percorso più la sola ricerca. PostHog no: la
 * prova di allora lo dice a chiare lettere, «lì il difetto resta aperto e questa prova non lo
 * copre».
 *
 * Restare a metà è il caso peggiore dei tre. Una ricerca con sette tocchi ai filtri contava
 * una pagina vista sul beacon, una su Google e otto su PostHog: gli stessi minuti della stessa
 * persona, tre numeri diversi. E quando due sistemi che si controllano a vicenda non tornano,
 * non si sa più quale dei due credere — la misura diventa inservibile proprio sulla pagina dove
 * la gente ha più intenzione di comprare.
 *
 * Questa prova chiude il giro: ① che la regola sia quella giusta (la esegue davvero) e ② che
 * tutti e tre i sensori ci passino, PostHog compreso.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chiaveDellaPaginaVista, __dimenticaLeRicerche } from '@/lib/analytics/tracciamento';

/** I sette tocchi ai filtri che la pagina dei risultati permette, uno dopo l'altro. */
const UNA_RICERCA_E_SETTE_FILTRI = [
  'q=pane',
  'q=pane&cat=gastronomia',
  'q=pane&cat=gastronomia&min=2',
  'q=pane&cat=gastronomia&min=2&max=20',
  'q=pane&cat=gastronomia&min=2&max=20&stelle=4',
  'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc',
  'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc&aperti=1',
  'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc&aperti=1&promo=1',
];

/**
 * La guardia di PostHog, rifatta qui uguale: una memoria dell'ultima pagina dichiarata, e si
 * parte solo quando è cambiata davvero. Restituisce quante pagine viste sarebbero partite.
 */
function quantePagineViste(indirizzi: string[]): number {
  let ultima: string | null = null;
  let partite = 0;
  for (const coda of indirizzi) {
    const pagina = chiaveDellaPaginaVista('/search', new URLSearchParams(coda));
    if (ultima === pagina) continue;
    ultima = pagina;
    partite += 1;
  }
  return partite;
}

describe('una ricerca sola è una pagina vista sola', () => {
  it('otto indirizzi, sette filtri, una pagina', () => {
    __dimenticaLeRicerche();
    expect(
      quantePagineViste(UNA_RICERCA_E_SETTE_FILTRI),
      'i filtri sono tornati a contare come pagine nuove',
    ).toBe(1);
  });

  it('cercare un altra cosa resta una pagina nuova', () => {
    __dimenticaLeRicerche();
    expect(quantePagineViste(['q=pane', 'q=pane&cat=gastronomia', 'q=vino'])).toBe(2);
  });
});

describe('tutti e tre i sensori usano la stessa chiave', () => {
  for (const file of [
    'components/ActivityTracker.tsx',
    'components/GoogleAnalytics.tsx',
    'lib/analytics/posthog.tsx',
  ]) {
    it(`${file} non conta più ogni indirizzo come una pagina`, () => {
      expect(readFileSync(file, 'utf8')).toContain('chiaveDellaPaginaVista');
    });
  }

  it("in PostHog la pagina vista parte solo dopo la guardia, non prima", () => {
    const src = readFileSync('lib/analytics/posthog.tsx', 'utf8');
    // L'effetto di navigazione: quello che ha percorso e parametri fra le dipendenze.
    const effetto = src.slice(
      src.indexOf('const ultimaPaginaVista'),
      src.indexOf('}, [pathname, searchParams]);') + 1,
    );
    expect(effetto, "l'effetto di navigazione di PostHog non si trova più: è stato riscritto")
      .toContain("chiaveDellaPaginaVista(pathname ?? '/', searchParams)");
    expect(effetto, 'manca la memoria dell\'ultima pagina: ogni filtro tornerebbe a contare')
      .toContain('if (ultimaPaginaVista.current === pagina) return;');
    expect(
      effetto.indexOf('ultimaPaginaVista.current === pagina'),
      'la pagina vista parte prima della guardia: la guardia non serve a niente',
    ).toBeLessThan(effetto.indexOf("ph.capture('$pageview')"));
  });
});
