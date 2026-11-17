/**
 * @vitest-environment jsdom
 */
/**
 * R03-011 — La variante «cards» del caricamento metteva aria-busy="true" sulla stessa regione che
 * annuncia (role=status, aria-live): finché è "true" il lettore di schermo può rimandare l'annuncio,
 * cioè non dire mai «sto caricando». Ora aria-busy non sta né sulla regione viva né sopra di lei, e il
 * messaggio resta dentro la regione.
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { LoadingState } from '@/components/ui/LoadingState';

describe('R03-011 · LoadingState «cards» si fa sentire', () => {
  it('la regione viva non è zittita da aria-busy, e contiene il messaggio', () => {
    const box = document.createElement('div');
    box.innerHTML = renderToStaticMarkup(
      createElement(LoadingState, { variant: 'cards', message: 'Carico i prodotti', description: 'Un attimo' }),
    );
    const regione = box.querySelector('[role="status"], [aria-live]') as HTMLElement | null;
    expect(regione, 'la variante cards deve avere una regione che annuncia').not.toBeNull();
    expect(regione!.getAttribute('aria-live')).toBe('polite');
    for (let n: HTMLElement | null = regione; n && n !== box; n = n.parentElement) {
      expect(n.getAttribute('aria-busy'), 'aria-busy sulla regione viva o sopra di lei zittisce l annuncio').not.toBe('true');
    }
    expect(regione!.textContent).toContain('Carico i prodotti');
  });
});
