/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R02-005 (giro 2) — il revisore ha misurato col testo al 200% ciò che il primo giro non copriva:
 * /contact 359 px a 280 e 320, /help 357, /terms 330 (e /privacy 349 a 280 e 320, per la stessa
 * ragione: i titoli e le parole lunghe uscivano dal loro riquadro, che al 200% è largo meno di una
 * parola). Dopo: 280, 320 e 360 px su tutte e quattro, e col testo normale i rettangoli di main a
 * 375 e 1280 px sono identici. Qui le classi sui pezzi colpevoli, sulle pagine vere.
 */
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/components/Turnstile', () => ({ default: () => null }));
vi.mock('@/components/Honeypot', () => ({ default: () => null }));

import HelpPage from '@/app/help/page';
import ContactPage from '@/app/contact/page';
import { LegalLayout } from '@/components/ui/LegalLayout';

const doc = (el: Parameters<typeof renderToStaticMarkup>[0]) => new DOMParser().parseFromString(renderToStaticMarkup(el), 'text/html');
const classi = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);
const anywhere = '[overflow-wrap:anywhere]';

describe('R02-005 giro 2 · /contact, /help, /terms col testo al 200%', () => {
  it('/contact: le card di contatto, i titoli e la griglia dei campi si stringono', () => {
    const d = doc(createElement(ContactPage));
    const card = Array.from(d.querySelectorAll('a')).filter((a) => classi(a).includes('rounded-xl') && classi(a).includes('p-5'));
    expect(card.length).toBeGreaterThanOrEqual(1);
    for (const c of card) {
      expect(classi(c)).toContain('min-w-0');
      expect(classi(c)).toContain(anywhere);
    }
    for (const h of Array.from(d.querySelectorAll('h2, h3'))) expect(classi(h), h.textContent ?? '').toContain(anywhere);
    const campi = Array.from(d.querySelectorAll('div')).find((x) => classi(x).includes('sm:grid-cols-2'));
    expect(classi(campi)).toContain('grid-cols-1');
  });

  it('/help: le card delle categorie e i titoli vanno a capo', () => {
    const d = doc(createElement(HelpPage));
    const card = Array.from(d.querySelectorAll('a')).filter((a) => classi(a).includes('rounded-xl') && classi(a).includes('p-5'));
    expect(card.length).toBeGreaterThan(3);
    for (const c of card) {
      expect(classi(c)).toContain('min-w-0');
      expect(classi(c)).toContain(anywhere);
    }
    for (const h of Array.from(d.querySelectorAll('h1, h2, h3'))) expect(classi(h), h.textContent ?? '').toContain(anywhere);
  });

  it('pagine legali: le linguette e il testo (strong, link email) vanno a capo, le tabelle no', () => {
    const d = doc(createElement(LegalLayout, { title: 'Termini', toc: [], active: '/terms', summary: 's' } as never,
      createElement('p', null, 'x')));
    const linguette = Array.from(d.querySelectorAll('nav[aria-label="Documenti legali"] a'));
    expect(linguette.length).toBeGreaterThan(2);
    for (const l of linguette) {
      expect(classi(l)).toContain('max-w-full');
      expect(classi(l)).toContain('min-w-0');
      expect(classi(l)).toContain(anywhere);
    }
    const corpo = d.querySelector('p')!.parentElement;
    expect(classi(corpo)).toContain('min-w-0');
    expect(classi(corpo)).toContain(anywhere);
    // La tabella della privacy ha il suo modo di stringersi: non si cambia il suo a capo.
    expect(classi(corpo)).toContain('[&_table]:[overflow-wrap:normal]');
  });
});
