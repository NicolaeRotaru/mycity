/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clicDaFermare, doveEilProblema } from '@/components/seller/site/dove-e-l-errore';
import { defaultSite, storeSiteSchema } from '@/lib/store-site';

/**
 * S06 — Salvare la vetrina.
 * 351: l'errore dice dove: «Menu, link 1, nome: …».
 * 324: un collegamento interno con la bozza non salvata chiede conferma.
 */
describe('351 — dove è il problema', () => {
  it('un link del menu senza nome', () => {
    const sito = { ...defaultSite(), menu: { enabled: true, links: [{ label: '', target: { kind: 'page', pageId: 'x' } }] } };
    const r = storeSiteSchema.safeParse(sito);
    if (r.success) throw new Error('la prova parte da un sito sbagliato');
    expect(doveEilProblema(r.error.issues[0].path, sito as never)).toMatch(/^Menu, link 1/);
  });
  it('una pagina e un blocco', () => {
    const sito = defaultSite();
    expect(doveEilProblema(['pages', 0, 'sections', 2, 'config', 'items', 1, 'question'], sito))
      .toBe(`Pagina «${sito.pages[0].title}», blocco 3, voce 2, domanda`);
  });
  it('SiteEditor lo usa', () => {
    expect(readFileSync('components/seller/site/SiteEditor.tsx', 'utf8')).toContain('doveEilProblema(problema.path, next)');
  });
});

describe('324 — uscire con modifiche non salvate', () => {
  const link = (href: string) => {
    const a = document.createElement('a');
    a.href = href;
    document.body.appendChild(a);
    return a;
  };
  const evento = (target: Element) => ({ defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target });
  it('verso un\'altra pagina del pannello chiede, e se dici no si ferma', () => {
    const conferma = vi.fn(() => false);
    expect(clicDaFermare(evento(link('/seller/orders')), true, '/seller/site', conferma)).toBe(true);
    expect(conferma).toHaveBeenCalled();
  });
  it('senza modifiche, o dentro l\'editor, non chiede', () => {
    const conferma = vi.fn(() => false);
    expect(clicDaFermare(evento(link('/seller/orders')), false, '/seller/site', conferma)).toBe(false);
    expect(clicDaFermare(evento(link('/seller/site?details=1')), true, '/seller/site', conferma)).toBe(false);
    expect(conferma).not.toHaveBeenCalled();
  });
  it('SiteEditor ascolta i clic quando la bozza è sporca', () => {
    expect(readFileSync('components/seller/site/SiteEditor.tsx', 'utf8')).toContain("document.addEventListener('click', alClic, true)");
  });
});
