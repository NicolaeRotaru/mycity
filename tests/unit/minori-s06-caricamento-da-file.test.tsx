/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCsv } from '@/app/seller/products/import/csv';
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

/**
 * S06 — Caricamento da file.
 * 579:  intestazioni italiane accettate; una riga con una colonna in più (il
 *       prezzo 4,50 spezzato in un file a virgole) si rifiuta invece di entrare a 4 €.
 * 2631: una cella vuota fra virgolette resta vuota (già chiusa: la prova la tiene).
 */
describe('579 — l\'Excel italiano fatto a mano', () => {
  it('«nome;descrizione;prezzo;scorta;categoria» si carica', async () => {
    const righe = await caricaByte(utf8('nome;descrizione;prezzo;scorta;categoria\r\n"Tovaglia";"Tovaglia di lino, 140x180";19,90;3;casa\r\n'));
    expect(righe).not.toBeNull();
    expect(righe![0].name).toBe('Tovaglia');
    expect(righe![0].price).toBe(19.9);
  });
  it('4,50 senza virgolette in un file a virgole non entra a 4 €', async () => {
    const righe = await caricaByte(utf8('name,description,price,stock,category_slug\r\nPane casereccio,Pane fresco di giornata,4,50,,\r\n'));
    expect(righe).toBeNull();
  });
});

describe('2631 — cella vuota fra virgolette', () => {
  it('resta vuota', () => {
    const r = parseCsv('name;description;price;stock;category_slug;allergeni;ingredienti\n"Pane";"Pane fresco";4,50;20;alimentari;"";""\n');
    expect(r.rows[0].slice(5)).toEqual(['', '']);
  });
});
