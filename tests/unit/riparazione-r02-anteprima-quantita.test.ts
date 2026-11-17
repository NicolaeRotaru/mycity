/**
 * @vitest-environment jsdom
 */
/**
 * R02-008 — Nell'anteprima del caricamento da file, una quantità scritta male dava l'errore della
 * riga («Quantità non valida»), ma la colonna della quantità mostrava 0: un numero che nel file
 * non c'è, accanto all'errore che dice il contrario. Ora la cella resta neutra (—), e le
 * quantità scritte bene si vedono come prima.
 *
 * La funzione resta spenta al lancio: qui la si accende solo nel finto del modulo (banco preso
 * da riparazione-r01-quantita-scritta-male-nel-file.test.tsx).
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })));
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
const router = vi.hoisted(() => ({ push: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
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
  `Vaso B;${DESCR};10,00;dieci;casa`,
  `Vaso C;${DESCR};10,00;;casa`,
  `Vaso E;${DESCR};10,00;12;casa`,
  `Vaso Z;${DESCR};10,00;0;casa`,
].join('\n');

describe('R02-008 · nell\'anteprima la quantità non valida non diventa 0', () => {
  it('la cella della quantità resta neutra accanto all\'errore; 12 e 0 scritti bene si vedono', async () => {
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

    const intestazioni = [...box.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim());
    const colonna = intestazioni.indexOf('Stock');
    expect(colonna, 'controprova: la colonna della quantità c\'è').toBeGreaterThan(-1);
    const righe = [...box.querySelectorAll('tbody tr')];
    expect(righe).toHaveLength(5);
    const riga = (nome: string) => righe.find((tr) => (tr.textContent ?? '').includes(nome))!;
    const quantita = (nome: string) => (riga(nome).querySelectorAll('td')[colonna]?.textContent ?? '').trim();
    const stato = (nome: string) => (riga(nome).querySelector('td:last-child')?.textContent ?? '').trim();

    for (const nome of ['Vaso A', 'Vaso B', 'Vaso C']) {
      expect(stato(nome), `${nome}: controprova, la riga ha l'errore della quantità`).toMatch(/quantit/i);
      expect(quantita(nome), `${nome}: accanto all'errore la cella non deve dire 0`).not.toBe('0');
      expect(quantita(nome)).not.toMatch(/^\d+$/);
    }
    expect(quantita('Vaso E')).toBe('12');
    expect(stato('Vaso E')).toBe('OK');
    // Uno 0 scritto nel file è una quantità vera: si vede 0.
    expect(quantita('Vaso Z')).toBe('0');
    act(() => root.unmount());
    box.remove();
  });
});
