/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSite, newPage, type SitePage, type SiteSection } from '@/lib/store-site';

/**
 * S06 — Il costruttore della vetrina, scrivendo.
 * 327: nell'indirizzo della pagina il trattino si scrive; l'indirizzo vuoto si segnala subito.
 * 342: a caricamento della foto finito, quello che si è scritto nel frattempo resta.
 */
const stato = vi.hoisted(() => ({
  drop: null as null | ((f: File[]) => Promise<void>),
  rilascia: (_u: string) => {},
}));
vi.mock('react-dropzone', () => ({
  useDropzone: (o: { onDrop: (f: File[]) => Promise<void> }) => {
    stato.drop = o.onDrop;
    return { getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false };
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/seller/site/ImageUpload', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadSiteImage: () => new Promise<string>((r) => { stato.rilascia = r; }),
}));
vi.mock('@/components/seller/site/SitePreview', () => ({ default: () => null }));
vi.mock('@/components/seller/site/PageSectionsEditor', () => ({ default: () => null }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function scrivi(campo: HTMLInputElement, valore: string) {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(campo, valore);
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
}

describe('327 — indirizzo della pagina', () => {
  it('il trattino resta mentre si scrive, e il vuoto si segnala', async () => {
    const { default: PageEditor } = await import('@/components/seller/site/PageEditor');
    const base = defaultSite();
    const pagina = newPage('Chi siamo', base);
    const sito = { ...base, pages: [...base.pages, pagina] };
    let ultima: SitePage = pagina;
    function Contenitore() {
      const [p, setP] = useState(pagina);
      ultima = p;
      return createElement(PageEditor, {
        site: sito, page: p, onChange: setP, onBack: () => {}, theme: 'classico' as never, accent: '#000', storeName: 'Forno', storeSlug: 'forno',
      });
    }
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    await act(async () => { root.render(createElement(Contenitore)); });
    const apri = [...div.querySelectorAll('button')].find((b) => /Impostazioni pagina/.test(b.textContent ?? ''))!;
    await act(async () => { apri.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const campo = [...div.querySelectorAll('input')].find((i) => i.value === pagina.slug) as HTMLInputElement;
    await act(async () => { scrivi(campo, 'chi-'); });
    expect(campo.value).toBe('chi-');
    await act(async () => { scrivi(campo, 'chi-siamo'); });
    expect(ultima.slug).toBe('chi-siamo');
    await act(async () => { scrivi(campo, ''); });
    expect(div.textContent).toContain('Scrivi un indirizzo per la pagina');
    root.unmount();
  });
});

describe('342 — galleria che carica', () => {
  it('il titolo scritto durante il caricamento non torna indietro', async () => {
    const { default: GalleryFields } = await import('@/components/seller/site/GalleryFields');
    const iniziale = { id: 'g1', type: 'gallery', config: { title: 'Prima', items: [] } } as unknown as SiteSection;
    let attuale = iniziale;
    let cambia: (s: SiteSection) => void = () => {};
    function Contenitore() {
      const [s, setS] = useState(iniziale);
      attuale = s;
      cambia = setS;
      return createElement(GalleryFields, { section: s as never, onChange: setS });
    }
    const div = document.createElement('div');
    const root = createRoot(div);
    await act(async () => { root.render(createElement(Contenitore)); });
    let fatto: Promise<void> = Promise.resolve();
    await act(async () => { fatto = stato.drop!([new File(['x'], 'a.jpg', { type: 'image/jpeg' })]); });
    await act(async () => { cambia({ ...attuale, config: { ...(attuale as { config: object }).config, title: 'Dopo' } } as SiteSection); });
    await act(async () => { stato.rilascia('https://x/1.jpg'); await fatto; });
    const cfg = (attuale as unknown as { config: { title: string; items: { url: string }[] } }).config;
    expect(cfg.title).toBe('Dopo');
    expect(cfg.items.map((i) => i.url)).toEqual(['https://x/1.jpg']);
    root.unmount();
  });
});
