/**
 * 27/8/2026 (R171) — OGNI TOCCO A UN FILTRO CONTAVA COME UNA PAGINA VISTA. SU TRE SISTEMI.
 *
 * La pagina dei risultati riscrive l'indirizzo a ogni cambio di filtro — categoria, prezzo, stelle,
 * ordinamento, «solo aperti», «solo in promozione», «solo disponibili». Quel cambio muove i
 * parametri della pagina, e i parametri erano nelle dipendenze di tutti e tre gli effetti che
 * dichiarano una pagina vista.
 *
 * Le pagine viste si gonfiavano proprio dove la gente ha più intenzione di comprare: pagine per
 * sessione, frequenza di rimbalzo e il denominatore di OGNI tasso di conversione uscivano falsi —
 * e la tabella delle attività cresceva per niente.
 *
 * Una pagina nuova è un percorso nuovo, o una ricerca nuova. Un filtro no: è la stessa pagina
 * guardata da un'altra angolazione.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { chiaveDellaPaginaVista } from '@/lib/analytics/tracciamento';

describe('quando un indirizzo è davvero una pagina nuova', () => {
  it('sette tocchi ai filtri restano una pagina sola', () => {
    const primo = chiaveDellaPaginaVista('/search', new URLSearchParams('q=pane'));
    const dopoISette = [
      'q=pane&cat=gastronomia',
      'q=pane&cat=gastronomia&min=2',
      'q=pane&cat=gastronomia&min=2&max=20',
      'q=pane&cat=gastronomia&min=2&max=20&stelle=4',
      'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc',
      'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc&aperti=1',
      'q=pane&cat=gastronomia&min=2&max=20&stelle=4&ordine=price_asc&aperti=1&promo=1',
    ].map((coda) => chiaveDellaPaginaVista('/search', new URLSearchParams(coda)));

    expect(new Set([primo, ...dopoISette]).size, 'una ricerca sola contava otto pagine viste').toBe(1);
  });

  it('cercare un altra cosa invece è una pagina nuova davvero', () => {
    expect(chiaveDellaPaginaVista('/search', new URLSearchParams('q=pane')))
      .not.toBe(chiaveDellaPaginaVista('/search', new URLSearchParams('q=vino')));
  });

  it('due percorsi diversi restano due pagine', () => {
    expect(chiaveDellaPaginaVista('/store/1', null)).not.toBe(chiaveDellaPaginaVista('/store/2', null));
  });

  it('senza parametri la chiave è il percorso, senza punti interrogativi appesi', () => {
    expect(chiaveDellaPaginaVista('/categorie', new URLSearchParams(''))).toBe('/categorie');
    expect(chiaveDellaPaginaVista('/categorie', null)).toBe('/categorie');
  });

  it("l'ordine in cui la persona tocca i filtri non cambia la chiave", () => {
    expect(chiaveDellaPaginaVista('/search', new URLSearchParams('cat=fiori&q=rose')))
      .toBe(chiaveDellaPaginaVista('/search', new URLSearchParams('q=rose&cat=fiori')));
  });
});

describe('i sensori del sito usano quella chiave', () => {
  // Controllo di struttura, dichiarato: in questa repo i componenti React non si montano dentro una
  // prova. ⚠️ Il terzo sensore, PostHog (`lib/analytics/posthog.tsx`), è in mano a un altro lotto:
  // lì il difetto resta aperto e questa prova non lo copre.
  for (const file of ['components/ActivityTracker.tsx', 'components/GoogleAnalytics.tsx']) {
    it(`${file} non conta più ogni indirizzo come una pagina`, () => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('chiaveDellaPaginaVista');
      expect(src, "l'indirizzo intero, filtri compresi, è tornato a essere la chiave")
        .not.toContain('searchParams?.toString() ? `?${searchParams}`');
    });
  }
});
