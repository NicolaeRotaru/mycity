// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { homeSiteSchema, newHomeSection, type HomeSite } from '@/lib/home-site';
import { prepareForSave, erroreConIlPosto } from '@/lib/admin/editor-della-home';

/**
 * S05 · schede 305, 341, 2537, 313, 242, 2454 (editor della home), 1722 (chat), 291 (menu admin).
 */

function conVantaggi(bullets: Array<{ title: string; desc: string }>): HomeSite {
  const s = newHomeSection('liveActivity');
  return { version: 1, sections: [{ ...s, config: { ...(s.config as object), bullets } } as never] };
}

describe('salvataggio della home', () => {
  it('305: un vantaggio lasciato del tutto vuoto non blocca il salvataggio', () => {
    const pulita = prepareForSave(conVantaggi([{ title: 'Pane fresco', desc: 'Ogni mattina' }, { title: '', desc: '' }]));
    expect(homeSiteSchema.safeParse(pulita).success).toBe(true);
  });

  it('305: un vantaggio a metà dice dove: sezione e vantaggio', () => {
    const sito = prepareForSave(conVantaggi([{ title: 'Pane fresco', desc: '' }]));
    const r = homeSiteSchema.safeParse(sito);
    expect(r.success).toBe(false);
    if (!r.success) expect(erroreConIlPosto(sito, r.error.issues[0])).toMatch(/Sezione 1 .*vantaggio 1: manca la descrizione/);
  });
});

describe('testi e video del costruttore (lettura del sorgente)', () => {
  const src = readFileSync('components/admin/home/HomeSectionConfigForm.tsx', 'utf8');
  it('341/2537: nessun segnaposto con regali in euro o «zero commissioni»', () => {
    expect(src).not.toMatch(/€5 in regalo/);
    expect(src).not.toMatch(/zero commissioni/);
  });
  it('313: niente caricamento di video dal dispositivo (il magazzino non li accetta)', () => {
    expect(src).not.toMatch(/useDropzone/);
    expect(src).not.toMatch(/'video\/mp4'/);
  });
});

describe('menu «Aggiungi sezione» (242)', () => {
  let root: Root | null = null;
  let box: HTMLDivElement;
  afterEach(async () => { await act(async () => { root?.unmount(); }); box?.remove(); });
  it('dice se è aperto, e si chiude con Esc riportando il fuoco al pulsante', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.doMock('@/components/ImageUrlField', () => ({ ImageUrlField: () => null }));
    const { default: Editor } = await import('@/components/admin/home/HomeSectionsEditor');
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
    await act(async () => { root!.render(createElement(Editor as (p: unknown) => ReactNode, { sections: [], onChange: () => {} })); });
    const pulsante = [...box.querySelectorAll('button')].find((b) => b.textContent?.includes('Aggiungi sezione'))!;
    expect(pulsante.getAttribute('aria-expanded')).toBe('false');
    expect(pulsante.getAttribute('aria-haspopup')).toBe('menu');
    await act(async () => { pulsante.click(); });
    expect(pulsante.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(pulsante.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pulsante);
  });
});

describe('altre pagine (lettura del sorgente)', () => {
  it('2454: l’editor della home legge con leggiHomeSite e mostra le sezioni scartate', () => {
    const src = readFileSync('app/admin/home/page.tsx', 'utf8');
    expect(src).toMatch(/leggiHomeSite\(/);
    expect(src).toMatch(/sezioni non valide sono state tolte/);
  });
  it('1722: il campo della chat non si spegne durante l’invio (la tastiera resta aperta)', () => {
    const src = readFileSync('app/messages/[id]/page.tsx', 'utf8');
    const campo = src.slice(src.indexOf('placeholder="Scrivi un messaggio…"') - 200, src.indexOf('placeholder="Scrivi un messaggio…"') + 500);
    expect(campo).not.toMatch(/disabled=\{sendMutation\.isPending\}\s*\n\s*(\/\/[^\n]*\n\s*)*className="flex-1/);
    expect(src).toMatch(/if \(!trimmed \|\| sendMutation\.isPending\) return;/);
  });
  it('291: nel menu del pannello ci sono Segnalazioni e Prodotti', () => {
    const src = readFileSync('components/admin/AdminSidebar.tsx', 'utf8');
    expect(src).toContain("href: '/admin/segnalazioni'");
    expect(src).toContain("href: '/admin/products'");
  });
});
