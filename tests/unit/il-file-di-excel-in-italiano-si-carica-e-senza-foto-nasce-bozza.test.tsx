/**
 * @vitest-environment jsdom
 *
 * 01/11/2026 — ondata 6, pacchetto «app/seller/products/import/page.tsx».
 *
 * 1) Il lettore divideva solo sulla virgola: il CSV dell'Excel italiano (punto e
 *    virgola, BOM in testa, decimali con la virgola) dava «Colonne mancanti» su un
 *    file giusto.
 * 2) Il caricamento da file metteva in vendita ('available') prodotti senza foto
 *    e senza descrizione: il modulo li ferma, il file no. Ora vale la stessa
 *    regola (cosaMancaPerVendere): chi non la passa nasce bozza, e la pagina dice
 *    quanti e perche'.
 * La prova guarda quello che arriva al database (il payload dell'insert) e i
 * messaggi mostrati al negoziante.
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

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};

/** Carica il file e, se compare, preme «Importa». Torna le righe arrivate all'insert (o null). */
async function caricaFile(csv: string): Promise<Array<Record<string, unknown>> | null> {
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
  if (bottone) {
    await act(async () => { bottone.click(); });
    await flush();
  }
  act(() => root.unmount());
  box.remove();
  return insert.mock.calls.length ? (insert.mock.calls[0][0] as Array<Record<string, unknown>>) : null;
}

beforeEach(() => {
  insert.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
});

describe('il file salvato da Excel in italiano si carica', () => {
  it('punto e virgola, BOM e decimali con la virgola: le colonne ci sono tutte', async () => {
    const righe = await caricaFile(
      '﻿name;description;price;stock;category_slug;allergeni;ingredienti\r\n' +
      '"Tovaglia";"Tovaglia di lino, 140x180";19,90;3;casa;;\r\n',
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(righe).toHaveLength(1);
    expect(righe![0]).toMatchObject({ name: 'Tovaglia', description: 'Tovaglia di lino, 140x180', price: 19.9, stock: 3, category_id: 'c-casa' });
  });

  it('il file con la virgola funziona ancora', async () => {
    const righe = await caricaFile(
      'name,description,price,stock,category_slug\n' +
      '"Tovaglia","Tovaglia di lino; 140x180",19.90,3,casa\n',
    );
    expect(righe![0]).toMatchObject({ name: 'Tovaglia', description: 'Tovaglia di lino; 140x180', price: 19.9 });
  });

  it('un separatore diverso (tabulazione) lo dice, non «Colonne mancanti»', async () => {
    const righe = await caricaFile('name\tdescription\tprice\tstock\tcategory_slug\n"Tovaglia"\t"Lino"\t19\t3\tcasa\n');
    expect(righe).toBeNull();
    expect(String(toast.error.mock.calls[0]?.[0])).toMatch(/separatore diverso/);
  });
});

describe('dal file non si va in vendita senza foto e descrizione', () => {
  it('un prodotto non alimentare senza foto nasce bozza, e la pagina dice quanti e perche', async () => {
    const righe = await caricaFile(
      'name;description;price;stock;category_slug\n' +
      '"Tovaglia";"Tovaglia di lino, 140x180";19,90;3;casa\n' +
      '"Vaso";"Vaso";9;2;casa\n',
    );
    expect(righe!.every((r) => r.status === 'draft')).toBe(true);
    const msg = String(toast.success.mock.calls[0]?.[0]);
    expect(msg).toMatch(/2 in bozza/);
    expect(msg).toMatch(/una foto \(2\)/);
    expect(msg).toMatch(/Descrizione di almeno 10 caratteri \(1\)/);
  });
});
