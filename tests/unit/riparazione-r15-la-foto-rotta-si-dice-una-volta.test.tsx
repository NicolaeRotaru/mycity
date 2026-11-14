/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

/**
 * R15-001, secondo giro — «una volta sola per foto» deve valere davvero.
 *
 * Il collaudo ha trovato due buchi. ① La corsa: l'immagine diventa rotta, l'evento error è ancora
 * in coda, la tessera si ridisegna. Il ramo `ref` vede la foto rotta e la dice; poi arriva l'evento
 * e `onError` la ridice, perché non guardava il ricordo (e il `ref` non sapeva dell'errore in
 * coda). ② Il rimontaggio: il ricordo stava nello stato del componente, e tornando in home la
 * stessa foto era di nuovo «nuova».
 *
 * Qui la pagina arriva dal server (renderToString) e si idrata con `hydrateRoot`, come in home.
 * Ogni prova usa indirizzi suoi: il ricordo vale per tutta la vita della pagina.
 */

const stato = vi.hoisted(() => ({
  avvisi: [] as unknown[][],
  /** L'indirizzo della foto di ogni categoria, cambiato a ogni prova. */
  foto: { casa: '', libri: '' },
  /** Se le immagini sono già finite (e, larghe zero in jsdom, quindi rotte). */
  rotte: false,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly string[] }) =>
    o.queryKey.join('/') === 'categories/con-prodotti'
      ? { data: undefined, isLoading: false, isError: false }
      : {
          data: [
            { id: 'c1', slug: 'casa-cucina', name: 'Casa & Cucina', parent_id: null, image_url: stato.foto.casa },
            { id: 'c2', slug: 'alimentari', name: 'Alimentari', parent_id: null },
            { id: 'c3', slug: 'libri', name: 'Libri', parent_id: null, image_url: stato.foto.libri },
          ],
          isLoading: false,
          isError: false,
        },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: (...a: unknown[]) => { stato.avvisi.push(a); }, error: () => {}, info: () => {}, debug: () => {} },
}));

const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
const Vetrina = CategoryShowcase as (p: { titolo?: string }) => ReturnType<typeof CategoryShowcase>;

// jsdom non scarica le immagini e la larghezza vera è sempre zero: «completa» vuol dire rotta.
Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => stato.rotte });

const BASE = 'https://abcdefgh.supabase.co/storage/v1/object/public/categorie';
let giro = 0;

let radice: Root | null;
let contenitore: HTMLDivElement;
let erroreDiConsole: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  giro++;
  stato.foto = { casa: `${BASE}/casa-${giro}.jpg`, libri: `${BASE}/libri-${giro}.jpg` };
  stato.avvisi.length = 0;
  stato.rotte = false;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // React 18 non conosce ancora `fetchPriority`: lo dice in console, non è quello che si prova qui.
  erroreDiConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = null;
});
afterEach(() => {
  if (radice) act(() => radice!.unmount());
  contenitore.remove();
  erroreDiConsole.mockRestore();
});

/** La home come arriva: l'HTML del server, poi l'idratazione. */
function idrata(el = createElement(CategoryShowcase)) {
  contenitore.innerHTML = renderToString(el);
  act(() => {
    radice = hydrateRoot(contenitore, el);
  });
}

const fotoDelle = () => [...contenitore.querySelectorAll('img')] as HTMLImageElement[];
const dette = () => stato.avvisi.filter((a) => String(a[0]).includes('non si è caricata'));
const detteDi = (src: string) => dette().filter((a) => (a[1] as { src?: string }).src === src);

describe('R15-001 — la foto rotta si dice una volta sola', () => {
  it('la corsa: ridisegno fra la foto rotta e l’evento error, e l’avviso esce una volta per foto', () => {
    idrata();
    expect(fotoDelle()).toHaveLength(2);
    expect(dette(), 'all’idratazione le foto stanno ancora caricando').toEqual([]);

    // Le foto falliscono adesso: l'evento error è in coda, e prima che arrivi la tessera si ridisegna.
    stato.rotte = true;
    act(() => radice!.render(createElement(Vetrina, { titolo: 'Cosa cerchi oggi?' })));
    act(() => {
      for (const img of fotoDelle()) img.dispatchEvent(new Event('error'));
    });

    expect(detteDi(stato.foto.casa), 'la stessa foto rotta detta due volte').toHaveLength(1);
    expect(detteDi(stato.foto.libri), 'la stessa foto rotta detta due volte').toHaveLength(1);
    expect(dette()).toHaveLength(2);
    for (const img of fotoDelle()) expect(img.style.display).toBe('none');
  });

  it('e nell’ordine inverso: prima l’evento, poi il ridisegno', () => {
    idrata();
    stato.rotte = true;
    act(() => {
      for (const img of fotoDelle()) img.dispatchEvent(new Event('error'));
    });
    act(() => radice!.render(createElement(Vetrina, { titolo: 'Le categorie' })));
    expect(dette()).toHaveLength(2);
  });

  it('il rimontaggio: tornando in home la stessa foto rotta non è di nuovo «nuova»', () => {
    // Fallita prima dell'idratazione: la dice il ramo `ref`.
    stato.rotte = true;
    idrata();
    expect(dette()).toHaveLength(2);

    // Si va altrove e si torna in home: la vetrina rinasce da capo, nel browser.
    act(() => radice!.unmount());
    radice = createRoot(contenitore);
    act(() => radice!.render(createElement(CategoryShowcase)));
    act(() => {
      for (const img of fotoDelle()) img.dispatchEvent(new Event('error'));
    });
    expect(dette(), 'a ogni ritorno in home le stesse foto rotte di nuovo nei log').toHaveLength(2);
    for (const img of fotoDelle()) expect(img.style.display).toBe('none');
  });

  it('una foto nuova al posto di quella rotta si dice, se è rotta anche lei', () => {
    stato.rotte = true;
    idrata();
    expect(dette()).toHaveLength(2);

    const nuova = `${BASE}/casa-${giro}-bis.jpg`;
    stato.foto = { ...stato.foto, casa: nuova };
    act(() => radice!.render(createElement(Vetrina, { titolo: 'Cosa cerchi oggi?' })));
    expect(detteDi(nuova), 'il ricordo è per foto, non uno per tutte').toHaveLength(1);
    expect(dette()).toHaveLength(3);
  });

  it('la tessera senza foto nel dato non manda nessun avviso', () => {
    stato.rotte = true;
    idrata();
    expect(contenitore.querySelector('a[href="/category/alimentari"] img')).toBeNull();
    expect(stato.avvisi.filter((a) => JSON.stringify(a).includes('alimentari'))).toEqual([]);
  });
});
