/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSite, newPage, newSection, type StoreSite, type SiteSection } from '@/lib/store-site';

/**
 * R04 — Eliminando una pagina della vetrina restavano i pulsanti delle sezioni che la aprivano
 * (il pulsante di un banner verso quella pagina). Alla cancellazione quei pulsanti se ne vanno con
 * lei, e la conferma lo dice prima, come già fa per le voci del menu.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

async function monta(site: StoreSite) {
  const { default: PageListEditor } = await import('@/components/seller/site/PageListEditor');
  const cambi: StoreSite[] = [];
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(PageListEditor, { site, onChange: (s: StoreSite) => cambi.push(s), onOpen: () => {} }));
  });
  const elimina = [...div.querySelectorAll('button[aria-label="Elimina pagina"]')] as HTMLButtonElement[];
  return { cambi, elimina, root };
}

function banner(id: string, label: string, target: Record<string, unknown>): SiteSection {
  const s = newSection('banner');
  return { ...s, id, config: { ...(s.config as object), heading: 'Promo', cta: { label, target } } } as SiteSection;
}

/** Home con due banner (uno verso «Chi siamo», uno verso un sito esterno) e una pagina «Offerte» con un banner verso «Chi siamo». */
function sito() {
  const base = defaultSite();
  const chi = newPage('Chi siamo', base);
  const conChi = { ...base, pages: [...base.pages, chi] } as StoreSite;
  const offerte = newPage('Offerte', conChi);
  const home = base.pages[0];
  const site = {
    ...base,
    pages: [
      { ...home, sections: [...home.sections, banner('b-chi', 'Scopri chi siamo', { kind: 'page', pageId: chi.id }), banner('b-est', 'Il nostro blog', { kind: 'external', url: 'https://esempio.it' })] },
      chi,
      { ...offerte, sections: [banner('b-off', 'La nostra storia', { kind: 'page', pageId: chi.id })] },
    ],
    menu: { enabled: false, links: [] },
  } as StoreSite;
  return { site, chi };
}

const cta = (s: StoreSite, id: string) => {
  const sezione = s.pages.flatMap((p) => p.sections).find((x) => x.id === id);
  expect(sezione, `la sezione ${id} deve restare`).toBeTruthy();
  return (sezione!.config as { cta?: { label: string } }).cta;
};

afterEach(() => vi.restoreAllMocks());

describe('R04 — eliminare una pagina toglie i pulsanti delle sezioni che la aprivano', () => {
  it('i pulsanti verso la pagina eliminata se ne vanno, le sezioni e gli altri pulsanti restano', async () => {
    const { site } = sito();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { cambi, elimina, root } = await monta(site);
    // Il primo «Elimina» è quello di «Chi siamo» (la home non ne ha).
    await act(async () => { elimina[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(cambi).toHaveLength(1);
    expect(cambi[0].pages.map((p) => p.title)).toEqual([site.pages[0].title, 'Offerte']);
    expect(cta(cambi[0], 'b-chi')).toBeUndefined();
    expect(cta(cambi[0], 'b-off')).toBeUndefined();
    expect(cta(cambi[0], 'b-est')?.label).toBe('Il nostro blog');
    root.unmount();
  });

  it('la conferma nomina i pulsanti che spariscono', async () => {
    const { site } = sito();
    const conferma = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { elimina, root } = await monta(site);
    await act(async () => { elimina[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const testo = String(conferma.mock.calls[0][0]);
    expect(testo).toContain('Scopri chi siamo');
    expect(testo).toContain('La nostra storia');
    expect(testo).not.toContain('Il nostro blog');
    root.unmount();
  });

  it('se si annulla non cambia niente', async () => {
    const { site } = sito();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { cambi, elimina, root } = await monta(site);
    await act(async () => { elimina[0].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(cambi).toHaveLength(0);
    root.unmount();
  });
});
