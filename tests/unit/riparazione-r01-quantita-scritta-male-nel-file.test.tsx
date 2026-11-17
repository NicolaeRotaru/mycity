/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * R01-009 — Nel caricamento da file la quantità si leggeva con `parseInt(…) || 0`: «1.5» diventava
 * 1, «10abc» 10, «1.000» (mille, scritto all'italiana) 1, e nessuno lo diceva. Ora la quantità
 * si legge rigida (un intero non negativo, solo cifre) e una scritta male è un errore della riga.
 *
 * La funzione resta spenta al lancio (CARICAMENTO_DA_FILE_ACCESO = false): qui la si accende
 * solo nel finto del modulo, come fa minori-s06-caricamento-da-file.test.tsx (banco preso da lì).
 */
const inviate = vi.fn(async (_righe: unknown) => undefined);
vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
  await inviate((JSON.parse(String(init?.body ?? '{}')) as { righe?: unknown }).righe);
  return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 });
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1' } } }),
      getSession: async () => ({ data: { session: { access_token: 'gettone' } } }),
    },
    from: () => ({ select: () => Promise.resolve({ data: [{ id: 'c-casa', slug: 'casa', parent_id: null }] }) }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
// Lo stesso router a ogni giro: la pagina lo ha fra le dipendenze del suo effetto.
const router = vi.hoisted(() => ({ push: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never),
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  CARICAMENTO_DA_FILE_ACCESO: true,
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import Pagina from '@/app/seller/products/import/page';

const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

const DESCR = 'Vaso in ceramica fatto a mano';
const CSV = [
  'name;description;price;stock;category_slug',
  `Vaso A;${DESCR};10,00;1.5;casa`,
  `Vaso B;${DESCR};10,00;10abc;casa`,
  `Vaso C;${DESCR};10,00;1.000;casa`,
  `Vaso D;${DESCR};10,00;-3;casa`,
  `Vaso E;${DESCR};10,00;12;casa`,
  `Vaso F;${DESCR};10,00;" 7 ";casa`,
].join('\n');

beforeEach(() => { inviate.mockClear(); });

describe('R01-009 — la quantità scritta male nel file', () => {
  it('«1.5», «10abc», «1.000», «-3» sono errori della riga; «12» e « 7 » sono numeri', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => { root.render(createElement(Pagina)); });
    await flush();
    const input = box.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input, 'controprova: il campo del file deve essere a video').toBeTruthy();
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([CSV], 'prodotti.csv', { type: 'text/csv' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();

    const righe = [...box.querySelectorAll('tbody tr')];
    expect(righe, 'controprova: l\'anteprima deve mostrare le sei righe').toHaveLength(6);
    const stato = (nome: string) => {
      const r = righe.find((tr) => (tr.textContent ?? '').includes(nome));
      return (r?.querySelector('td:last-child')?.textContent ?? '').trim();
    };
    for (const nome of ['Vaso A', 'Vaso B', 'Vaso C', 'Vaso D']) {
      expect(stato(nome), `${nome}: la quantità scritta male deve essere un errore della riga`).not.toBe('OK');
    }
    expect(stato('Vaso A')).toMatch(/quantit/i);
    expect(stato('Vaso B')).toMatch(/quantit/i);
    expect(stato('Vaso C')).toMatch(/quantit/i);
    expect(stato('Vaso E')).toBe('OK');
    expect(stato('Vaso F')).toBe('OK');

    const importa = [...box.querySelectorAll('button')].find((b) => /Importa \d+ prodotti/.test(b.textContent ?? ''));
    expect(importa?.textContent).toContain('Importa 2 prodotti');
    await act(async () => { importa!.click(); });
    await flush();
    const mandate = inviate.mock.calls[0]?.[0] as Array<{ name: string; stock: number }>;
    expect(mandate.map((r) => [r.name, r.stock])).toEqual([['Vaso E', 12], ['Vaso F', 7]]);
    act(() => root.unmount());
    box.remove();
  });
});
