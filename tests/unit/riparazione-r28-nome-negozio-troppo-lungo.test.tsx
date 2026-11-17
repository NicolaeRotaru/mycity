/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { friendlyError } from '@/lib/errors';

/**
 * R28-011 — Il nome del negozio troppo lungo (o fatto di soli spazi) si ferma già nel modulo, con un avviso
 * che dice cosa correggere; la rotta, se ci arriva, usa la stessa frase e friendlyError (che toglie le
 * parentesi) non la riduce a «Nome del negozio».
 */
vi.mock('@/components/StoreLocationPickerLazy', () => ({ default: () => null }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('@/components/StoreAvatar', () => ({ default: () => null }));
vi.mock('@/components/StoreMediaManager', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined }) }));
vi.mock('react-dropzone', () => ({
  useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false, open: () => undefined }),
}));
vi.mock('@/lib/storage/carica-immagine', () => ({ ANNO_IN_SECONDI: 31536000, caricaImmagine: async () => '' }));

import SellerApplicationForm from '@/components/SellerApplicationForm';

const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function inviaConNome(storeName: string) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => {
    root.render(createElement(SellerApplicationForm as never, { onSubmit: () => undefined, defaultValues: { storeName } }));
  });
  const modulo = radice.querySelector('form')!;
  await act(async () => {
    modulo.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
  return radice.textContent ?? '';
}

describe('R28-011 — nome del negozio troppo lungo', () => {
  it('con 81 caratteri il modulo dice di accorciare, e dice quanti ne sono permessi', async () => {
    const testo = await inviaConNome('x'.repeat(81));
    expect(testo).toContain('al massimo 80 caratteri');
  });

  it('con 80 caratteri il modulo non si lamenta del nome', async () => {
    const testo = await inviaConNome('x'.repeat(80));
    expect(testo).not.toContain('al massimo 80 caratteri');
  });

  it('di soli spazi vale come vuoto, come per la rotta', async () => {
    const testo = await inviaConNome('      ');
    expect(testo).toContain('almeno 3 caratteri');
  });

  it('la frase della rotta arriva intera all\'avviso (friendlyError non la riduce a «Nome del negozio»)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/api/seller/apply/route.ts', 'utf8');
    const frase = /max\(80, '([^']+)'\)/.exec(src)![1];
    expect(frase).toContain('80');
    expect(friendlyError(new Error(frase))).toContain('80');
  });
});
