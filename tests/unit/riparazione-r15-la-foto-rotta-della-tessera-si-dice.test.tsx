/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R15-001 — una foto di categoria che non si carica non sparisce in silenzio.
 *
 * Le tessere arrivano già nell'HTML del server: una foto sparita fallisce quasi sempre prima che
 * React si idrati, e allora `onError` non scatta. Il componente la riconosce al montaggio
 * (immagine «completa» con larghezza zero) e la nasconde: qui si guarda che lo DICA nei log,
 * con l'indirizzo da correggere, e una volta sola anche se la tessera si ridisegna.
 */

const avvisi = vi.hoisted(() => [] as unknown[][]);

vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly string[] }) =>
    o.queryKey.join('/') === 'categories/con-prodotti'
      ? { data: undefined, isLoading: false, isError: false }
      : {
          data: [
            { id: 'c1', slug: 'casa-cucina', name: 'Casa & Cucina', parent_id: null,
              image_url: 'https://abcdefgh.supabase.co/storage/v1/object/public/categorie/casa.jpg' },
            { id: 'c2', slug: 'alimentari', name: 'Alimentari', parent_id: null },
          ],
          isLoading: false,
          isError: false,
        },
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: (...a: unknown[]) => { avvisi.push(a); }, error: () => {}, info: () => {}, debug: () => {} },
}));

const { default: CategoryShowcase } = await import('@/components/CategoryShowcase');
const Vetrina = CategoryShowcase as (p: { titolo?: string }) => ReturnType<typeof CategoryShowcase>;

// jsdom non scarica le immagini: qui ogni foto è «completa» e larga zero, cioè già fallita
// prima dell'idratazione, il caso in cui onError non scatta più.
Object.defineProperty(HTMLImageElement.prototype, 'complete', { configurable: true, get: () => true });

let radice: Root;
let contenitore: HTMLDivElement;
beforeEach(() => {
  avvisi.length = 0;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
});
afterEach(() => {
  act(() => radice.unmount());
  contenitore.remove();
});

const avvisiDellaFotoRotta = () =>
  avvisi.filter((a) => String(a[0]).includes('non si è caricata'));

describe('R15-001 — la foto rotta di una tessera finisce nei log', () => {
  it('fallita prima dell’idratazione: la tessera torna al gradiente e il log dice quale foto', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    const img = contenitore.querySelector('a[href="/category/casa-cucina"] img') as HTMLImageElement;
    expect(img.style.display).toBe('none');
    const detti = avvisiDellaFotoRotta();
    expect(detti).toHaveLength(1);
    expect(detti[0][1]).toMatchObject({
      slug: 'casa-cucina',
      src: 'https://abcdefgh.supabase.co/storage/v1/object/public/categorie/casa.jpg',
    });
  });

  it('una tessera che si ridisegna non ripete l’avviso', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    act(() => radice.render(createElement(Vetrina, { titolo: 'Cosa cerchi oggi?' })));
    act(() => radice.render(createElement(Vetrina, { titolo: 'Le categorie' })));
    expect(avvisiDellaFotoRotta()).toHaveLength(1);
  });

  it('la tessera senza foto nel dato non manda nessun avviso', () => {
    act(() => radice.render(createElement(CategoryShowcase)));
    expect(contenitore.querySelector('a[href="/category/alimentari"] img')).toBeNull();
    expect(avvisi.filter((a) => JSON.stringify(a).includes('alimentari'))).toEqual([]);
  });
});
