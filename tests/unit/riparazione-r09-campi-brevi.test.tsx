/**
 * @vitest-environment jsdom
 */
/**
 * R09-003 R09-004 — Galleria (titolo, descrizione di ogni foto), menu (etichetta) e impostazioni della
 * pagina (titolo, titolo SEO, descrizione SEO) tagliavano in silenzio con `maxLength`. Adesso il testo
 * resta intero e sotto il campo compare «Troppo lungo: N caratteri su T», come nel banner.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { defaultSite, newPage } from '@/lib/store-site';

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/seller/site/SitePreview', () => ({ default: () => null }));
vi.mock('@/components/seller/site/PageSectionsEditor', () => ({ default: () => null }));

import GalleryFields from '@/components/seller/site/GalleryFields';
import MenuEditor from '@/components/seller/site/MenuEditor';
import PageEditor from '@/components/seller/site/PageEditor';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const accesi: Root[] = [];
afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

async function monta(el: ReturnType<typeof createElement>) {
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  await act(async () => { root.render(el); });
  return radice;
}

function campoConEtichetta(radice: HTMLElement, etichetta: string) {
  const label = [...radice.querySelectorAll('label')].find((l) => l.textContent?.trim().startsWith(etichetta));
  expect(label, `l'etichetta «${etichetta}» c'è`).toBeTruthy();
  return document.getElementById(label!.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
}

function verifica(el: HTMLElement, tetto: number, lungo: string) {
  expect(el.getAttribute('maxlength'), 'maxlength: il browser taglia in silenzio').toBeNull();
  expect((el as HTMLInputElement).value, 'il testo resta intero').toHaveLength(lungo.length);
  const descr = el.getAttribute('aria-describedby') ?? '';
  const testo = descr.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
  expect(testo).toContain(`Troppo lungo: ${lungo.length} caratteri su ${tetto}`);
  expect(el.getAttribute('aria-invalid')).toBe('true');
}

const sezione = (config: object) => ({ id: 'g1', type: 'gallery', config }) as never;

describe('R09-003 R09-004 · i campi brevi della vetrina non tagliano in silenzio', () => {
  it('galleria: titolo e descrizione della foto oltre 120', async () => {
    const lungo = 'x'.repeat(125);
    const r = await monta(createElement(GalleryFields, {
      section: sezione({ heading: lungo, items: [{ url: 'https://x.it/1.jpg', alt: lungo }] }),
      onChange: () => undefined,
    }));
    verifica(campoConEtichetta(r, 'Titolo'), 120, lungo);
    verifica(r.querySelector('input[aria-label^="Descrizione"]') as HTMLElement, 120, lungo);
  });

  it('galleria: al tetto nessun errore', async () => {
    const giusto = 'x'.repeat(120);
    const r = await monta(createElement(GalleryFields, {
      section: sezione({ heading: giusto, items: [{ url: 'https://x.it/1.jpg', alt: giusto }] }),
      onChange: () => undefined,
    }));
    expect(r.querySelector('[role="alert"]')).toBeNull();
  });

  it('menu: etichetta oltre 30', async () => {
    const lungo = 'y'.repeat(35);
    const base = defaultSite();
    const site = { ...base, menu: { enabled: true, links: [{ id: 'l1', label: lungo, target: { kind: 'home' } }] } } as never;
    const r = await monta(createElement(MenuEditor, { site, onChange: () => undefined }));
    verifica(campoConEtichetta(r, 'Etichetta'), 30, lungo);
  });

  it('pagina: titolo (60), titolo SEO (70), descrizione SEO (180)', async () => {
    const base = defaultSite();
    const p0 = newPage('Chi siamo', base);
    const pagina = { ...p0, title: 'a'.repeat(65), seo: { noindex: false, title: 'b'.repeat(75), description: 'c'.repeat(185) } };
    const r = await monta(createElement(PageEditor, {
      site: { ...base, pages: [...base.pages, pagina] } as never, page: pagina as never, onChange: () => undefined, onBack: () => undefined,
      theme: 'classico' as never, accent: '#000', storeName: 'Forno', storeSlug: 'forno',
    }));
    const apri = [...r.querySelectorAll('button')].find((b) => /Impostazioni pagina/.test(b.textContent ?? ''))!;
    await act(async () => { apri.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    verifica(campoConEtichetta(r, 'Titolo'), 60, 'a'.repeat(65));
    verifica(campoConEtichetta(r, 'Titolo SEO'), 70, 'b'.repeat(75));
    verifica(campoConEtichetta(r, 'Descrizione SEO'), 180, 'c'.repeat(185));
  });
});
