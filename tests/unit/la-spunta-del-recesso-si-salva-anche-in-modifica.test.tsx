/**
 * @vitest-environment jsdom
 */
/**
 * 31/10/2026 (sesta ondata, secondo giro) — LA SPUNTA DEL RECESSO ANCHE IN MODIFICA.
 *
 * Il fornaio crea la torta su ordinazione e si dimentica la spunta «Escluso dal
 * recesso». Riapre «Modifica prodotto» per metterla: la spunta non c'era, e se
 * ci fosse stata la porta unica del salvataggio (colonneAmmesse) l'avrebbe
 * buttata via dicendo «Modifiche salvate». Ora la porta la tiene e la pagina la
 * mostra, ma solo se la banca dati ha la colonna (migrazione 180): la colonna
 * non si rilegge per nome, se no prima della 180 ogni salvataggio si ferma.
 *
 * In piu' la controprova della voce «modifica entro 5 minuti»: con una copia
 * vecchia in memoria (prodotto ancora in vendita a 18 euro) e in banca dati
 * «esaurito» a 20, il modulo si apre una volta sola, coi valori della banca dati.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  aperture: [] as Array<Record<string, unknown>>,
  variantiRotte: false,
}));

vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
vi.mock('next-intl', async (importOriginal) => {
  const vero = await importOriginal<Record<string, unknown>>();
  const t = Object.assign((k: string) => k, { rich: (k: string) => k, raw: (k: string) => k, has: () => true });
  return { ...vero, useTranslations: () => t, useLocale: () => 'it' };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, refresh: () => undefined }),
  usePathname: () => '/seller/products',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: crea } = await vi.importActual<typeof import('react')>('react');
  return { default: ({ href, children }: { href: unknown; children?: ReactNode }) => crea('a', { href: String(href) }, children) };
});
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'seller-1' } } }) },
    from: (tavola: string) => ({
      select() {
        const filtri: Array<[string, unknown]> = [];
        const trova = () => (stato.tabelle[tavola] ?? []).filter((r) => filtri.every(([c, v]) => r[c] === v)).map((r) => ({ ...r }));
        const catena = {
          eq: (c: string, v: unknown) => (filtri.push([c, v]), catena),
          order: () => catena,
          single: async () => ({ data: trova()[0] ?? null, error: null }),
          maybeSingle: async () => ({ data: trova()[0] ?? null, error: null }),
          then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve({ data: trova(), error: null }).then(ok, ko),
        };
        return catena;
      },
    }),
  },
}));
vi.mock('@/lib/products/salva-dal-browser', () => ({ salvaProdottoDalBrowser: async () => [] }));
vi.mock('@/lib/products/persistVariants', () => ({
  loadProductVariants: async () => {
    if (stato.variantiRotte) throw new Error('Failed to fetch');
    return [
      { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 3, position: 0 },
      { id: 'v-l', options: { Taglia: 'L' }, label: 'L', stock: 2, position: 1 },
    ];
  },
}));
vi.mock('@/lib/products/persistVariantsServer', () => ({ saveProductVariantsServer: async () => undefined }));
vi.mock('@/lib/queries/consegna-veloce-del-negozio', () => ({
  useConsegnaVeloceDelNegozio: () => ({ offre: false, inLettura: false, nonLetta: false }),
}));
vi.mock('@/components/seller/ProductForm', () => ({
  default: function ModuloFinto(props: { initialValues?: Riga; recessoSegnabile?: boolean }) {
    stato.aperture.push({ ...(props.initialValues ?? {}), __spunta: props.recessoSegnabile === true });
    return null;
  },
}));

const ID = '11111111-1111-4111-8111-111111111111';

function maglietta(extra: Riga = {}): Riga {
  return {
    id: ID, seller_id: 'seller-1', name: 'Maglietta', description: 'Cotone pesante, stampata a mano.',
    price: 18, compare_at_price: null, unit: 'pezzo', condition: 'new', stock: 5, category_id: 'cat-1',
    images: ['https://mycity.test/maglietta.jpg'], attributes: {}, tags: [], express_enabled: null,
    status: 'available', ...extra,
  };
}

let root: Root | null = null;
let radice: HTMLElement | null = null;

async function finche(condizione: () => boolean) {
  for (let i = 0; i < 80 && !condizione(); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stato.tabelle = { categories: [], products: [maglietta()] };
  stato.aperture = [];
  stato.variantiRotte = false;
  radice = document.createElement('div');
  document.body.appendChild(radice);
  root = createRoot(radice);
});

afterEach(() => {
  act(() => root?.unmount());
  radice?.remove();
});


async function apri(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const { default: EditProductPage } = await import('@/app/seller/products/[id]/edit/page');
  act(() =>
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(EditProductPage as never, { params: { valore: { id: ID } } }))),
  );
  await finche(() => stato.aperture.length > 0 || (radice!.textContent ?? '').includes('Errore'));
}

describe('«Modifica prodotto»: la spunta «escluso dal recesso»', () => {
  it('IL CASO CHE ROMPEVA — con la colonna in banca dati la spunta compare, gia\' accesa sulla torta', async () => {
    stato.tabelle.products = [maglietta({ name: 'Torta su ordinazione', non_recedibile: true })];
    await apri();
    expect(stato.aperture.length).toBeGreaterThan(0);
    const aperto = stato.aperture[stato.aperture.length - 1];
    expect(aperto.__spunta, 'la spunta del recesso e\' nascosta in modifica').toBe(true);
    expect(aperto.nonRecedibile).toBe(true);
  });

  it('controprova: prima della 180 (riga senza la colonna) la spunta resta nascosta', async () => {
    await apri();
    expect(stato.aperture.length).toBeGreaterThan(0);
    expect(stato.aperture[stato.aperture.length - 1].__spunta).toBe(false);
  });

  it('controprova (entro 5 minuti): la copia vecchia in memoria non apre il modulo, vince la banca dati', async () => {
    const { queryKeys } = await import('@/lib/queries/keys');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: 300_000 } } });
    qc.setQueryData(queryKeys.seller.product(ID), maglietta({ status: 'available', price: 18 }));
    qc.setQueryData([...queryKeys.seller.product(ID), 'variants'], []);
    stato.tabelle.products = [maglietta({ status: 'sold', price: 20 })];
    await apri(qc);
    expect(stato.aperture.length).toBeGreaterThan(0);
    for (const aperto of stato.aperture) {
      expect(aperto.status, 'il modulo si e\' aperto con lo stato vecchio: «esaurito» torna in vendita').toBe('sold');
      expect(aperto.price).toBe(20);
    }
  });
});

describe('la porta unica del salvataggio e il recesso', () => {
  it('IL CASO CHE ROMPEVA — colonneAmmesse tiene non_recedibile (solo se vero o falso)', async () => {
    const { colonneAmmesse } = await import('@/lib/products/salvataggio-tracciato');
    expect(colonneAmmesse({ price: 3, non_recedibile: true }), 'la spunta del recesso viene buttata via').toEqual({ price: 3, non_recedibile: true });
    expect(colonneAmmesse({ non_recedibile: false })).toEqual({ non_recedibile: false });
    expect(colonneAmmesse({ non_recedibile: 'si' })).toEqual({});
  });

  it('controprova: la colonna non entra nella rilettura per nome (prima della 180 fermerebbe ogni salvataggio)', async () => {
    const { COLONNE_DA_RILEGGERE } = await import('@/lib/products/salvataggio-tracciato');
    expect(COLONNE_DA_RILEGGERE.split(',').map((c) => c.trim())).not.toContain('non_recedibile');
  });

  it('IL CASO CHE ROMPEVA — il cambio della spunta finisce nel registro delle modifiche', async () => {
    const { tracciaDellaModifica } = await import('@/lib/products/salvataggio-tracciato');
    const voce = tracciaDellaModifica({
      prodottoId: ID, attoreId: 'seller-1', origine: 'modulo', prima: maglietta(), dopo: { non_recedibile: true },
    });
    expect(voce?.metadata.campi, 'la spunta del recesso cambiata non lascia traccia').toEqual(['non_recedibile']);
  });
});
