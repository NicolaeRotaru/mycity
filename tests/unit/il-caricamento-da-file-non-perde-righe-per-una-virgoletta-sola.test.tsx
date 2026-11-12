/**
 * @vitest-environment jsdom
 * Collaudo finale 1/11/2026: una virgoletta sola in una cella senza virgolette
 * («Televisore 5" di schermo») apriva una cella che non si chiudeva piu', e le
 * righe dopo sparivano dentro quella cella.
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

describe('una virgoletta sola dentro una cella', () => {
  it('resta un carattere e non si mangia le righe dopo', async () => {
    const righe = await caricaByte(utf8(
      'name;description;price;stock;category_slug\r\n' +
      'Televisore 5" portatile;Schermo piccolo da cucina;49,00;2;casa\r\n' +
      'Tovaglia;Tovaglia di lino 140x180;19,90;3;casa\r\n',
    ));
    expect(righe).not.toBeNull();
    expect(righe).toHaveLength(2);
    expect(righe![0].name).toBe('Televisore 5" portatile');
    expect(righe![1].name).toBe('Tovaglia');
  });
});
