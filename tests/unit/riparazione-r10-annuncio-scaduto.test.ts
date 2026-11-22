/**
 * R10-004 — LA PAGINA DEL NEGOZIO IN CACHE NON MOSTRA UN ANNUNCIO GIÀ SCADUTO DOPO LA MEZZANOTTE.
 *
 * L'annuncio «fino al 21» vale tutto il 21 a Piacenza. La decisione la prende la pagina mentre si
 * costruisce (`announcementActive`, col giorno di Piacenza). Con una copia in cache
 * (`revalidate = 300`), la pagina che il cliente riceve alle 00:02 può essere stata costruita alle
 * 23:58 — e con la regola di Next «servi la vecchia e intanto rifalla», dopo una notte senza visite
 * anche molte ore prima. Allora l'annuncio scaduto c'è.
 *
 * Oggi `force-dynamic` in app/layout.tsx nasconde il difetto per tutto il sito; la regista lo
 * toglierà in un'onda dopo, e la vetrina deve reggere lo stesso. L'orologio è finto: mai quello vero.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { announcementActive, type StoreCustomization } from '@/lib/store-customization';

vi.mock('@/lib/supabase/lettura-per-metadati', () => ({ leggiPerMetadati: async () => null }));
vi.mock('@/lib/queries/precarico', () => ({ precaricaNegozio: async () => ({ mutations: [], queries: [] }) }));

const vetrina = await import('@/app/store/[id]/layout');
const paginaSuMisura = await import('@/app/store/[id]/[slug]/layout');

/** Il «revalidate» che vale per una pagina: Next prende il più basso fra i segmenti della rotta. */
const secondiDiCache = (...segmenti: { revalidate?: number | false }[]) =>
  Math.min(...segmenti.map((s) => (typeof s.revalidate === 'number' ? s.revalidate : Infinity)));

/**
 * Quando è stata costruita la pagina che il cliente riceve alla `visita`. Senza cache, alla visita.
 * Con una cache, può essere l'ultima copia fatta prima, a qualunque ora (stale-while-revalidate).
 */
function costruitaAlle(visita: Date, secondi: number, ultimaCopia: Date): Date {
  return secondi === 0 ? visita : ultimaCopia;
}

const ANNUNCIO: StoreCustomization = {
  announcement: { enabled: true, text: 'Domenica chiusi per inventario', until: '2026-11-21' },
};

// 21 novembre: a Piacenza è l'ora solare, UTC+1.
const SERA_DEL_21 = new Date('2026-11-21T22:58:00Z'); // 23:58 a Piacenza
const NOTTE_DEL_22 = new Date('2026-11-21T23:02:00Z'); // 00:02 del 22 a Piacenza (in UTC è ancora il 21)
const MATTINA_DEL_22 = new Date('2026-11-22T07:30:00Z'); // 08:30 a Piacenza

/** L'annuncio che il cliente vede nella pagina ricevuta alla `visita`. */
function annuncioVisto(visita: Date, ultimaCopia: Date, secondi: number): boolean {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(costruitaAlle(visita, secondi, ultimaCopia));
  return announcementActive(ANNUNCIO);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('R10-004 · l\'annuncio scaduto e la pagina del negozio', () => {
  it('la vetrina e le sue pagine su misura non si servono da una copia in cache', () => {
    expect(secondiDiCache(vetrina), 'la vetrina tiene una copia in cache').toBe(0);
    expect(secondiDiCache(vetrina, paginaSuMisura), 'le pagine su misura del negozio tengono una copia in cache').toBe(0);
  });

  it('alle 00:02 del 22 (ora di Piacenza) l\'annuncio «fino al 21» non si vede, anche se alle 23:58 c\'era una copia', () => {
    const secondi = secondiDiCache(vetrina);
    expect(annuncioVisto(SERA_DEL_21, SERA_DEL_21, secondi), 'la sera del 21 l\'annuncio vale ancora').toBe(true);
    expect(annuncioVisto(NOTTE_DEL_22, SERA_DEL_21, secondi), 'dopo mezzanotte si vede l\'annuncio già scaduto').toBe(false);
  });

  it('dopo una notte senza visite, la prima visita del mattino non riceve la copia della sera', () => {
    const secondi = secondiDiCache(vetrina, paginaSuMisura);
    expect(annuncioVisto(MATTINA_DEL_22, SERA_DEL_21, secondi), 'la mattina dopo si vede l\'annuncio di ieri').toBe(false);
  });
});
