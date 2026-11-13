/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultSite, newPage, type StoreSite } from '@/lib/store-site';

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
  const elimina = [...div.querySelectorAll('button[aria-label="Elimina pagina"]')][0] as HTMLButtonElement;
  return { cambi, elimina, root };
}

function sitoConMenu() {
  const base = defaultSite();
  const chi = newPage('Chi siamo', base);
  return {
    chi,
    site: {
      ...base,
      pages: [...base.pages, chi],
      menu: {
        enabled: true,
        links: [
          { id: 'a', label: 'La nostra storia', target: { kind: 'page' as const, pageId: chi.id } },
          { id: 'b', label: 'Home', target: { kind: 'home' as const } },
        ],
      },
    } as StoreSite,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('R20-006 eliminare una pagina che il menu apre', () => {
  it('la conferma nomina la voce del menu che sparisce, e la voce se ne va con la pagina', async () => {
    const { site } = sitoConMenu();
    const conferma = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { cambi, elimina, root } = await monta(site);
    await act(async () => { elimina.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(String(conferma.mock.calls[0][0])).toContain('La nostra storia');
    expect(cambi).toHaveLength(1);
    expect(cambi[0].pages).toHaveLength(1);
    expect(cambi[0].menu.links.map((l) => l.id)).toEqual(['b']);
    root.unmount();
  });

  it('se si annulla non cambia niente', async () => {
    const { site } = sitoConMenu();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { cambi, elimina, root } = await monta(site);
    await act(async () => { elimina.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(cambi).toHaveLength(0);
    root.unmount();
  });

  it('una pagina fuori dal menu si elimina con la conferma di sempre', async () => {
    const { site } = sitoConMenu();
    const senza = { ...site, menu: { enabled: true, links: [] } };
    const conferma = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { cambi, elimina, root } = await monta(senza);
    await act(async () => { elimina.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(String(conferma.mock.calls[0][0])).not.toContain('menu');
    expect(cambi[0].pages).toHaveLength(1);
    root.unmount();
  });
});
