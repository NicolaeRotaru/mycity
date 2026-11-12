/**
 * @vitest-environment jsdom
 *
 * 01/11/2026 — ondata 5, pacchetto «lib/category-attributes.ts».
 *
 * Il caricamento da file (/seller/products/import) inseriva i prodotti dal browser
 * con status 'available' e nessun attributo: un alimento andava in vendita senza
 * allergeni né ingredienti, che il modulo pretende (Reg. UE 1169/2011).
 * Ora il file può portare le colonne allergeni/ingredienti; se per un alimento
 * (anche di sottocategoria) ne manca una, il prodotto nasce BOZZA.
 * La prova guarda quello che arriva al database: il payload dell'insert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const insert = vi.fn(async (_rows: unknown) => ({ error: null }));
// 12/11/2026 (R09-006) — Le righe non vanno più al database dal browser: la pagina le manda a
// POST /api/seller/products/import. Qui si guarda quello che la pagina manda alla rotta.
vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
  await insert((JSON.parse(String(init?.body ?? '{}')) as { righe?: unknown }).righe);
  return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
}));
const CATEGORIE = [
  { id: 'c-al', slug: 'alimentari', parent_id: null },
  { id: 'c-pane', slug: 'pane', parent_id: 'c-al' },
  { id: 'c-casa', slug: 'casa', parent_id: null },
];

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } } }),
    },
    from: (t: string) =>
      t === 'categories'
        ? { select: () => Promise.resolve({ data: CATEGORIE }) }
        : { insert: (rows: unknown) => insert(rows) },
  },
}));
const router = { push: vi.fn() };
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/navigation',() => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  CARICAMENTO_DA_FILE_ACCESO: true,
}));

import * as attributi from '@/lib/category-attributes';
import Pagina from '@/app/seller/products/import/page';

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};

async function caricaFile(csv: string): Promise<Array<Record<string, unknown>>> {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => { root.render(createElement(Pagina)); });
  await flush();
  const input = box.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [{ size: csv.length, text: async () => csv }],
  });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await flush();
  const bottone = [...box.querySelectorAll('button')].find((b) => /Importa \d+ prodotti/.test(b.textContent ?? ''));
  expect(bottone, 'il bottone di importazione deve comparire').toBeTruthy();
  await act(async () => { bottone!.click(); });
  await flush();
  act(() => root.unmount());
  box.remove();
  expect(insert).toHaveBeenCalledTimes(1);
  return insert.mock.calls[0][0] as Array<Record<string, unknown>>;
}

beforeEach(() => { insert.mockClear(); });

describe('caricamento da file: un alimento senza allergeni e ingredienti non va in vendita', () => {
  // Dall'ondata 6 il file non porta foto: tutto nasce bozza, e la foto si
  // aggiunge dalla scheda. Qui si controlla che l'alimento resti bozza e che
  // allergeni e ingredienti del file vengano salvati.
  it('file nel formato vecchio (senza colonne): l alimento nasce bozza, e anche il resto finche manca la foto', async () => {
    const righe = await caricaFile(
      'name,description,price,stock,category_slug\n' +
      '"Pane casereccio","Pane",4.50,20,pane\n' +
      '"Tovaglia","Cotone",19.90,3,casa\n',
    );
    const pane = righe.find((r) => r.name === 'Pane casereccio')!;
    const tovaglia = righe.find((r) => r.name === 'Tovaglia')!;
    expect(pane.status).toBe('draft');
    expect(tovaglia.status).toBe('draft');
  });

  it('con allergeni e ingredienti dal file: gli attributi si salvano, la vendita aspetta la foto', async () => {
    const righe = await caricaFile(
      'name,description,price,stock,category_slug,allergeni,ingredienti\n' +
      '"Focaccia","Focaccia",3,10,alimentari,"Glutine","Farina, acqua, olio, sale"\n' +
      '"Grissini","Grissini",2,10,alimentari,"Glutine",\n' +
      '"Biscotti","Biscotti",2,10,alimentari,"   ","Farina, burro"\n',
    );
    const focaccia = righe.find((r) => r.name === 'Focaccia')!;
    expect(focaccia.status).toBe('draft');
    expect(focaccia.attributes).toEqual({ allergeni: 'Glutine', ingredienti: 'Farina, acqua, olio, sale' });
    expect(righe.find((r) => r.name === 'Grissini')!.status).toBe('draft');
    expect(righe.find((r) => r.name === 'Biscotti')!.status).toBe('draft');
  });
});

describe('statoAlCaricamentoDaFile', () => {
  it('nomina i campi mancanti e risale alla categoria madre', () => {
    const r = attributi.statoAlCaricamentoDaFile(CATEGORIE, 'c-pane', { allergeni: 'Glutine' });
    expect(r).toEqual({ status: 'draft', mancanti: ['Ingredienti'] });
    expect(attributi.statoAlCaricamentoDaFile(CATEGORIE, 'c-casa', {}).status).toBe('available');
    expect(
      attributi.statoAlCaricamentoDaFile(CATEGORIE, 'c-al', { allergeni: attributi.NESSUN_ALLERGENE, ingredienti: 'Acqua' }).status,
    ).toBe('available');
  });
});
