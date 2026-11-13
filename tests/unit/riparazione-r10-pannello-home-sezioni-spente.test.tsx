// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { newHomeSection } from '@/lib/home-site';

/**
 * R10-007 — Nel pannello /admin/home «Drop del giorno» e «Newsletter» risultavano
 * visibili (occhio aperto, nessuna nota), ma la home non le disegna: sono spente
 * al lancio (DROP_DEL_GIORNO_ACCESO, NEWSLETTER_ACCESA). E il menu «Aggiungi
 * sezione» le offriva ancora.
 */

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  DROP_DEL_GIORNO_ACCESO: false,
  NEWSLETTER_ACCESA: false,
}));
vi.mock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));

let root: Root | null = null;
let box: HTMLDivElement;
afterEach(async () => { await act(async () => { root?.unmount(); }); box?.remove(); });

async function editor(sections: unknown[]) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { default: Editor } = await import('@/components/admin/home/HomeSectionsEditor');
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  await act(async () => {
    root!.render(createElement(Editor as unknown as (p: { sections: unknown[]; onChange: () => void }) => ReactNode, { sections, onChange: () => {} }));
  });
  return box;
}

describe('R10-007 — il pannello dice quello che la home disegna', () => {
  it('Drop del giorno attivo ma spento al lancio: il pannello dice che non appare', async () => {
    const b = await editor([{ ...newHomeSection('dropOfDay'), enabled: true }]);
    expect(b.textContent, 'il pannello la mostra come visibile').toMatch(/spenta al lancio/);
  });

  it('una sezione normale attiva non porta la nota', async () => {
    const b = await editor([{ ...newHomeSection('categories'), enabled: true }]);
    expect(b.textContent).not.toMatch(/spenta al lancio/);
  });

  it('il menu «Aggiungi sezione» non offre Newsletter né Drop del giorno', async () => {
    const b = await editor([]);
    const pulsante = [...b.querySelectorAll('button')].find((x) => x.textContent?.includes('Aggiungi sezione'))!;
    await act(async () => { pulsante.click(); });
    const menu = b.querySelector('[role="menu"]')!;
    expect(menu.textContent).toMatch(/Categorie/);
    expect(menu.textContent).not.toMatch(/Newsletter/);
    expect(menu.textContent).not.toMatch(/Drop del giorno/);
  });
});
