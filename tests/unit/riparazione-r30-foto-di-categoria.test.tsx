/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R30-001 — una foto di categoria sparita o scartata arriva a chi gestisce il sito, una volta sola.
 *
 * ① La foto SCARTATA dal dato (indirizzo su un host che il browser bloccherà): l'avviso stava in un
 * effetto su `tessere`, e si ridiceva quando arrivavano le categorie piene (tessere ricalcolate) e a
 * ogni ritorno in home. Tre avvisi per la stessa foto.
 * ② Il canale: `logger.warn` è solo `console.warn` nel browser del visitatore. Deve passare da
 * `logger.error` con un Error, che dal browser arriva a Sentry (lib/logger.ts → captureError).
 */

const stato = vi.hoisted(() => ({
  avvisi: [] as unknown[][],
  errori: [] as unknown[][],
  /** Le categorie piene: prima non si sa, poi arrivano. */
  piene: undefined as string[] | undefined,
  /** Se le immagini sono già finite (e, larghe zero in jsdom, quindi rotte). */
  rotte: false,
}));

const SCARTATA = 'https://altro-sito.example/casa.jpg';
const ROTTA = 'https://abcdefgh.supabase.co/storage/v1/object/public/categorie/libri.jpg';

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly string[] }) =>
    o.queryKey.join('/') === 'categories/con-prodotti'
      ? { data: stato.piene, isLoading: false, isError: false }
      : {
          data: [
            { id: 'c1', slug: 'casa-cucina', name: 'Casa & Cucina', parent_id: null, image_url: SCARTATA },
            { id: 'c2', slug: 'alimentari', name: 'Alimentari', parent_id: null },
            { id: 'c3', slug: 'libri', name: 'Libri', parent_id: null, image_url: ROTTA },
          ],
          isLoading: false,
          isError: false,
        },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: (...a: unknown[]) => { stato.avvisi.push(a); },
    error: (...a: unknown[]) => { stato.errori.push(a); },
    info: () => {},
    debug: () => {},
  },
}));

Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => stato.rotte });

type Componente = typeof import('@/components/CategoryShowcase').default;
let CategoryShowcase: Componente;
let radice: Root;
let contenitore: HTMLDivElement;
let erroreDiConsole: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  // Ogni prova è una pagina appena aperta: il ricordo delle foto già dette vale per la vita della pagina.
  vi.resetModules();
  ({ default: CategoryShowcase } = await import('@/components/CategoryShowcase'));
  stato.avvisi.length = 0;
  stato.errori.length = 0;
  stato.piene = undefined;
  stato.rotte = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // React 18 non conosce ancora `fetchPriority`: lo dice in console, non è quello che si prova qui.
  erroreDiConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
});
afterEach(() => {
  act(() => radice.unmount());
  contenitore.remove();
  erroreDiConsole.mockRestore();
});

/** Tutto quello che è uscito, dal canale giusto o da quello sbagliato, con la frase in chiaro. */
const detti = (frase: string) =>
  [...stato.avvisi, ...stato.errori].filter((a) => String(a[0] instanceof Error ? a[0].message : a[0]).includes(frase));
/** Solo quello che arriva a Sentry: logger.error con un Error vero. */
const aSentry = (frase: string) =>
  stato.errori.filter((a) => a[0] instanceof Error && (a[0] as Error).message.includes(frase));

describe('R30-001 — la foto scartata si dice una volta sola', () => {
  it('non si ridice quando arrivano le piene, né tornando in home', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    expect(detti('scartata')).toHaveLength(1);

    // Arrivano le categorie piene: le tessere si ricalcolano, la foto è la stessa.
    stato.piene = ['c1', 'c3'];
    act(() => radice.render(createElement(CategoryShowcase)));
    expect(detti('scartata'), 'la stessa foto scartata ridetta quando arrivano le piene').toHaveLength(1);

    // Si va altrove e si torna in home: la vetrina rinasce da capo.
    act(() => radice.unmount());
    radice = createRoot(contenitore);
    act(() => radice.render(createElement(CategoryShowcase)));
    expect(detti('scartata'), 'a ogni ritorno in home la stessa foto scartata di nuovo').toHaveLength(1);
  });
});

describe('R30-001 — la foto sparita o scartata arriva a Sentry, non solo alla console', () => {
  it('la foto scartata esce da logger.error con un Error, con l’indirizzo da correggere', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    const arrivati = aSentry('scartata');
    expect(arrivati, 'la foto scartata resta nella console del visitatore').toHaveLength(1);
    expect(arrivati[0][1]).toMatchObject({ slug: 'casa-cucina' });
    expect(String((arrivati[0][1] as { dettaglio?: string }).dettaglio)).toContain(SCARTATA);
    expect(stato.avvisi).toEqual([]);
  });

  it('la foto rotta esce da logger.error con un Error, con slug e indirizzo', () => {
    stato.rotte = true;
    act(() => radice.render(createElement(CategoryShowcase)));
    const arrivati = aSentry('non si è caricata');
    expect(arrivati, 'la foto rotta resta nella console del visitatore').toHaveLength(1);
    expect(arrivati[0][1]).toMatchObject({ slug: 'libri', src: ROTTA });
    expect(stato.avvisi).toEqual([]);
  });
});
