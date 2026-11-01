/**
 * @vitest-environment jsdom
 * Collaudo finale 1/11/2026, sessione S3 — varianti scomode del caricamento da file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const insert = vi.fn(async (_rows: unknown) => ({ error: null }));
const CATEGORIE = [
  { id: 'c-al', slug: 'alimentari', parent_id: null },
  { id: 'c-casa', slug: 'casa', parent_id: null },
];
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (t: string) =>
      t === 'categories'
        ? { select: () => Promise.resolve({ data: CATEGORIE }) }
        : { insert: (rows: unknown) => insert(rows) },
  },
}));
const router = { push: vi.fn() };
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  CARICAMENTO_DA_FILE_ACCESO: true,
}));
import Pagina from '@/app/seller/products/import/page';

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

/** Il file come lo legge il browser: Blob.text() decodifica SEMPRE in UTF-8 (spec File API). */
async function caricaByte(bytes: Uint8Array) {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => { root.render(createElement(Pagina)); });
  await flush();
  const input = box.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', {
    configurable: true,
    // Un File vero: il lettore puo' leggere i byte (arrayBuffer) e riconoscere la codifica.
    value: [new File([bytes as unknown as BlobPart], 'prodotti.csv', { type: 'text/csv' })],
  });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
  const bottone = [...box.querySelectorAll('button')].find((b) => /Importa \d+ prodotti/.test(b.textContent ?? ''));
  if (bottone) { await act(async () => { bottone.click(); }); await flush(); }
  act(() => root.unmount());
  box.remove();
  return insert.mock.calls.length ? (insert.mock.calls[0][0] as Array<Record<string, unknown>>) : null;
}
const cp1252 = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

beforeEach(() => { insert.mockClear(); toast.success.mockClear(); toast.error.mockClear(); });

describe('variante: Excel italiano, «CSV (delimitato dal separatore di elenco)» = Windows-1252, senza BOM', () => {
  it('le lettere accentate arrivano intere nel database', async () => {
    const righe = await caricaByte(cp1252(
      'name;description;price;stock;category_slug;allergeni;ingredienti\r\n' +
      '"Caffè in grani";"Miscela 100% arabica, qualità superiore";12,50;10;alimentari;"Nessuno dei 14 allergeni";"Caffè"\r\n',
    ));
    expect(righe).not.toBeNull();
    expect(righe![0].name).toBe('Caffè in grani');
    expect(righe![0].description).toBe('Miscela 100% arabica, qualità superiore');
  });
});

describe('variante: una cella con l a capo (Alt+Invio in Excel)', () => {
  it('la descrizione su due righe resta un prodotto solo', async () => {
    const righe = await caricaByte(utf8(
      'name;description;price;stock;category_slug\r\n' +
      '"Tovaglia";"Tovaglia di lino\r\n140x180, lavabile";19,90;3;casa\r\n',
    ));
    expect(righe).not.toBeNull();
    expect(righe).toHaveLength(1);
    expect(String(righe![0].description)).toContain('140x180');
  });
});

describe('variante: prezzo formattato come valuta in Excel', () => {
  it('«19,90 €» si legge 19.9', async () => {
    const righe = await caricaByte(utf8(
      'name;description;price;stock;category_slug\r\n' +
      '"Tovaglia";"Tovaglia di lino, 140x180";"19,90 €";3;casa\r\n',
    ));
    expect(righe).not.toBeNull();
    expect(righe![0].price).toBe(19.9);
  });
});

describe('variante: alimento con ingredienti lunghi (etichetta UE vera, ~1800 caratteri)', () => {
  it('gli ingredienti arrivano interi e l alimento senza foto nasce bozza', async () => {
    const lunghi = 'Farina di grano tenero tipo 0, acqua, olio extravergine di oliva (5%), sale, lievito; '.repeat(20) + 'Può contenere tracce di frutta a guscio e sesamo.';
    const righe = await caricaByte(utf8(
      'name;description;price;stock;category_slug;allergeni;ingredienti\r\n' +
      `"Focaccia";"Focaccia genovese del forno";3;10;alimentari;"Glutine";"${lunghi}"\r\n`,
    ));
    expect(righe![0].status).toBe('draft');
    expect((righe![0].attributes as Record<string, string>).ingredienti).toBe(lunghi);
  });
});
