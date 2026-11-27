// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R13-004 — I campi brevi delle categorie (nome, slug, icona, foto) non tagliano più in silenzio:
 * il testo incollato oltre il tetto resta intero e sotto il campo c'è l'avviso.
 */
const righe = [{ id: 'c1', slug: 'pane', name: 'Pane', icon: null, parent_id: null, sort_order: 0, featured: false }];

vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: { href: string; children?: unknown }) => ce('a', { href }, children as never) };
});
vi.mock('sonner', () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: () => ({ select: async () => ({ data: righe, error: null }) }),
  },
}));

const { default: Pagina } = await import('@/app/admin/categories/page');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let c: HTMLDivElement;
const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function monta() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c = document.createElement('div');
  document.body.appendChild(c);
  root = createRoot(c);
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Pagina))));
  for (let i = 0; i < 6; i++) await pausa();
}
afterEach(async () => { await act(async () => root.unmount()); c.remove(); });

async function scrivi(el: HTMLInputElement, testo: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, testo);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const campo = (etichetta: string) => {
  const l = Array.from(c.querySelectorAll('label')).find((x) => x.textContent?.startsWith(etichetta))!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
};

describe('R13-004 · categorie: campi brevi senza taglio silenzioso', () => {
  it('il nome oltre 60 caratteri resta intero e si legge l avviso', async () => {
    await monta();
    const nome = campo('Nuova categoria');
    expect(nome.hasAttribute('maxlength')).toBe(false);
    await scrivi(nome, 'a'.repeat(70));
    expect(nome.value.length).toBe(70);
    expect(c.textContent).toContain('Troppo lungo: 70 caratteri su 60');
  });

  it('l icona oltre 8 caratteri e la foto oltre 500 non vengono tagliate', async () => {
    await monta();
    const icona = campo('Icona');
    await scrivi(icona, 'x'.repeat(12));
    expect(icona.value.length).toBe(12);
    expect(c.textContent).toContain('Troppo lungo: 12 caratteri su 8');
    const foto = campo('Foto (facoltativa)');
    await scrivi(foto, 'h'.repeat(520));
    expect(foto.value.length).toBe(520);
    expect(c.textContent).toContain('su 500');
  });

  it('dentro il limite non compare nessun avviso', async () => {
    await monta();
    await scrivi(campo('Nuova categoria'), 'Animali');
    expect(c.textContent).not.toContain('Troppo lungo');
  });

  it('nelle righe già esistenti nessun campo breve ha maxlength', async () => {
    await monta();
    for (const e of ['Nome', 'Slug']) expect(campo(e).hasAttribute('maxlength')).toBe(false);
    const slug = campo('Slug');
    await scrivi(slug, 's'.repeat(65));
    expect(slug.value.length).toBe(65);
    expect(c.textContent).toContain('Troppo lungo: 65 caratteri su 60');
  });
});
