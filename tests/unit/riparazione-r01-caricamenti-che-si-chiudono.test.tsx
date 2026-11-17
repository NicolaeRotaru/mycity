/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * R01-004 — «Sui caricamenti la X non chiude niente»: la parte del provider (la X si chiama
 * «Chiudi avviso» e non si mostra finché l'avviso è un caricamento) era già fatta. Restava il
 * caricamento che il modulo prodotto chiudeva con `toast(msg, { id })`: in sonner 1.7.4 l'avviso
 * con lo stesso id si aggiorna tenendo il tipo, quindi restava «loading» per sempre — senza X e
 * senza scadenza — con sopra la frase finale («Nessuna variante sensata…», «Codice EAN salvato…»).
 *
 * Qui girano il sonner vero, il ToastProvider vero e il modulo prodotto vero con l'assistente
 * acceso (al lancio è spento: è l'interruttore `aiAccesa`). La rete risponde come il server quando
 * non trova niente; la prova guarda l'avviso che resta a video: ha la X, e dopo la sua durata se
 * ne va da solo. Orologio finto, così la scadenza si misura senza aspettare otto secondi veri.
 */
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }), getUser: async () => ({ data: { user: { id: 's1' } } }) } },
}));
// La fotocamera non c'è: il lettore finto «legge» un codice appena lo si apre.
vi.mock('@/components/seller/BarcodeScanner', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: ({ open, onDetected }: { open: boolean; onDetected: (c: string) => void }) =>
      open ? ce('button', { type: 'button', onClick: () => onDetected('8001234567890') }, 'Lettore finto: leggi il codice') : null,
  };
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { toast } = await import('sonner');
const { default: ToastProvider, DURATA_AVVISI_MS } = await import('@/components/providers/ToastProvider');
const { default: ProductForm } = await import('@/components/seller/ProductForm');

// «Casa» ha sia il codice EAN sia i campi che diventano varianti (dimensioni, colore).
const CATEGORIE = [{ id: 'c1', name: 'Casa', slug: 'casa', parent_id: null }];

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

const avanti = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function montaModulo() {
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(Fragment, null,
      createElement(ToastProvider),
      createElement(ProductForm, {
        mode: 'edit', categories: CATEGORIE, aiAccesa: true, sellerOffersExpress: true, consegnaDelNegozioNonLetta: false,
        onSubmit: () => {},
        initialValues: { name: 'Vaso', description: 'Vaso in ceramica fatto a mano', price: 10, unit: 'pezzo', stock: 1,
          category_id: 'c1', images: [], attributes: {}, tags: [], status: 'available', variants: [] },
      }),
    ));
  });
  await avanti(50);
}

/** Il server risponde dopo un po', come in rete: intanto a video c'è il caricamento. */
const LATENZA_MS = 300;
function rispondi(corpo: unknown) {
  vi.stubGlobal('fetch', async () => {
    await new Promise((r) => setTimeout(r, LATENZA_MS));
    return new Response(JSON.stringify(corpo), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}
/** Controprova: mentre il server pensa c'è un caricamento, senza X; poi arriva la risposta. */
async function caricamentoPoiRisposta() {
  const caricamenti = avvisi().filter((a) => a.getAttribute('data-type') === 'loading');
  expect(caricamenti, 'controprova: mentre il server pensa ci deve essere un caricamento').toHaveLength(1);
  expect(xVisibile(caricamenti[0]), 'il caricamento non ha una X che non chiude').toBe(false);
  await avanti(LATENZA_MS + 50);
}
const pulsante = (testo: RegExp) => [...div!.querySelectorAll('button')].find((b) => testo.test(b.textContent ?? ''));
async function premi(testo: RegExp) {
  const b = pulsante(testo);
  expect(b, `controprova: il pulsante ${testo} deve essere a video`).toBeTruthy();
  await act(async () => { b!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await avanti(50);
}
const avvisi = () => [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].filter((a) => a.getAttribute('data-removed') !== 'true');
const avvisoCon = (testo: string) => avvisi().find((a) => (a.textContent ?? '').includes(testo));
/** Una X che il negoziante può vedere e premere: c'è, non è nascosta, si chiama «Chiudi avviso». */
const xVisibile = (avviso: HTMLElement) => {
  const x = avviso.querySelector<HTMLButtonElement>('button[data-close-button]');
  return !!x && x.style.display !== 'none' && !x.hidden && x.getAttribute('aria-label') === 'Chiudi avviso';
};

/** L'avviso finale c'è, non è più un caricamento, ha la X e se ne va da solo dopo la sua durata. */
async function chiusoDavvero(frase: string) {
  const avviso = avvisoCon(frase);
  expect(avviso, `controprova: l'avviso «${frase}» deve essere a video`).toBeTruthy();
  expect(avviso!.getAttribute('data-type'), 'l\'avviso finale è rimasto un caricamento').not.toBe('loading');
  expect(xVisibile(avviso!), 'l\'avviso finale deve avere la sua X').toBe(true);
  expect(avvisi().filter((a) => a.getAttribute('data-type') === 'loading'), 'nessun caricamento resta a video').toHaveLength(0);
  await avanti(DURATA_AVVISI_MS + 500);
  expect(avvisoCon(frase), `l'avviso «${frase}» deve scadere da solo`).toBeUndefined();
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });

afterEach(async () => {
  await act(async () => { toast.dismiss(); });
  await avanti(500);
  act(() => radice?.unmount());
  div?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('R01-004 — i caricamenti del modulo prodotto finiscono in un avviso che si chiude', () => {
  it('«Suggerisci varianti» senza proposte: «Nessuna variante sensata…» ha la X e scade', async () => {
    await montaModulo();
    rispondi({ axes: [] });
    await premi(/Suggerisci varianti/);
    await caricamentoPoiRisposta();
    await chiusoDavvero('Nessuna variante sensata per questo prodotto.');
  });

  it('codice EAN non trovato online: «Codice EAN salvato. Non ho trovato…» ha la X e scade', async () => {
    await montaModulo();
    rispondi({ found: false });
    await premi(/Scansiona codice EAN/);
    await premi(/Lettore finto/);
    await caricamentoPoiRisposta();
    await chiusoDavvero('Non ho trovato il prodotto online');
  });

  it('codice EAN trovato ma niente da cambiare: «Codice EAN salvato» ha la X e scade', async () => {
    await montaModulo();
    rispondi({ found: true, patch: {} });
    await premi(/Scansiona codice EAN/);
    await premi(/Lettore finto/);
    await caricamentoPoiRisposta();
    await chiusoDavvero('Codice EAN salvato');
  });
});
