/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R02-005 (onda 9, giro 2) — COL TESTO AL 200% LE PAGINE PUBBLICHE NON SCORRONO PIÙ DI LATO.
 *
 * Misurato in Chromium (Playwright) su `next dev`, html{font-size:200%}, larghezza dello schermo / scorrimento
 * prima -> dopo: /faq 280 e 320 px: 344 -> 280 e 320; /returns 280 e 320: 357 -> 280 e 320;
 * /lavora-con-noi 280 e 320: 341 -> 280 e 320; /help 360: 391 -> 360; /contact 360: 429 -> 360
 * (il riquadro anti-robot da 300 px non è misurato); /terms 360: 393 -> 360; /privacy 360: 414 -> 360.
 * Restano fuori la home (422 a 360) e i suoi tre componenti: non sono di questa sessione.
 * Le correzioni sono classi che agiscono solo quando serve (parola che non sta, colonna che può stringersi):
 * col testo normale la resa non cambia. Qui la prova leggera sulle classi, sulle pagine vere.
 */

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('sonner', () => ({ toast: { success: () => undefined, error: () => undefined } }));
vi.mock('@/components/Turnstile', () => ({ default: () => null }));
vi.mock('@/components/Honeypot', () => ({ default: () => null }));

import FaqPage from '@/app/faq/page';
import ReturnsPage from '@/app/returns/page';
import LavoraConNoiPage from '@/app/lavora-con-noi/page';
import HelpPage from '@/app/help/page';
import ContactPage from '@/app/contact/page';
import TermsPage from '@/app/terms/page';
import { LegalLayout } from '@/components/ui/LegalLayout';

const doc = (el: Parameters<typeof renderToStaticMarkup>[0]) => new DOMParser().parseFromString(renderToStaticMarkup(el), 'text/html');
const classi = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);
const spezza = (el: Element | null | undefined) => classi(el).includes('break-words') || classi(el).includes('[overflow-wrap:anywhere]');

describe('R02-005 · col testo al 200% le pagine pubbliche non scorrono di lato', () => {
  it('/faq: il titolo, i titoli di sezione e le domande vanno a capo', () => {
    const d = doc(createElement(FaqPage));
    expect(spezza(d.querySelector('h1'))).toBe(true);
    for (const h2 of Array.from(d.querySelectorAll('h2'))) expect(classi(h2), h2.textContent ?? '').toContain('[overflow-wrap:anywhere]');
    const domande = Array.from(d.querySelectorAll('button[aria-expanded]')).map((b) => b.querySelector('span'));
    expect(domande.length).toBeGreaterThan(5);
    for (const s of domande) {
      expect(classi(s)).toContain('min-w-0');
      expect(classi(s)).toContain('[overflow-wrap:anywhere]');
    }
  });

  it('/returns: titoli, liste e pulsante «Contatta supporto» possono andare a capo', () => {
    const d = doc(createElement(ReturnsPage));
    expect(spezza(d.querySelector('h1'))).toBe(true);
    for (const h2 of Array.from(d.querySelectorAll('h2')).filter((h) => classi(h).includes('mb-3'))) expect(spezza(h2), h2.textContent ?? '').toBe(true);
    const liste = Array.from(d.querySelectorAll('ol, ul'));
    expect(liste.length).toBeGreaterThanOrEqual(4);
    for (const l of liste) expect(classi(l)).toContain('[overflow-wrap:anywhere]');
    const contatta = Array.from(d.querySelectorAll('span')).find((s) => s.textContent?.includes('Contatta supporto'));
    expect(classi(contatta)).toContain('[overflow-wrap:anywhere]');
  });

  it('/lavora-con-noi: didascalie, titoli e pulsanti possono andare a capo e le righe delle posizioni si stringono', () => {
    const d = doc(createElement(LavoraConNoiPage));
    for (const h2 of Array.from(d.querySelectorAll('h2')).filter((h) => /Posizioni aperte|Cosa offriamo|Non trovi/.test(h.textContent ?? ''))) {
      expect(classi(h2), h2.textContent ?? '').toContain('break-words');
    }
    const didascalia = Array.from(d.querySelectorAll('span.block')).find((s) => classi(s).includes('text-sm'))!;
    expect(classi(didascalia.parentElement)).toContain('min-w-0');
    expect(classi(didascalia.parentElement)).toContain('[overflow-wrap:anywhere]');
    // 27/11/2026 — Ogni collegamento alla candidatura spontanea (il pulsante in fondo e, a elenco vuoto,
    // quello sotto «Posizioni aperte»), non solo il primo trovato.
    const spontanee = Array.from(d.querySelectorAll('a')).filter((a) => a.textContent?.includes('candidatura spontanea'));
    expect(spontanee.length).toBeGreaterThanOrEqual(1);
    for (const spontanea of spontanee) {
      expect(classi(spontanea)).toContain('max-w-full');
      expect(classi(spontanea)).toContain('[overflow-wrap:anywhere]');
    }
    // 27/11/2026 — Le quattro posizioni erano inventate: oggi l'elenco è vuoto. Le righe disegnate si
    // controllano tutte; la riga del modello si controlla anche nel file, così resta controllata per
    // quando Nicola aggiunge una posizione vera.
    const righe = Array.from(d.querySelectorAll('#posizioni li'));
    for (const riga of righe) {
      const colonna = Array.from(riga.querySelectorAll('div')).find((x) => classi(x).includes('flex-1'));
      expect(classi(colonna).join(' '), 'la colonna del titolo non deve chiedere 200 px fissi').not.toContain('min-w-[200px]');
      const candidati = Array.from(riga.querySelectorAll('a')).find((a) => a.textContent?.includes('Candidati'));
      expect(classi(candidati)).toContain('max-w-full');
    }
    const modello = readFileSync(join(process.cwd(), 'app', 'lavora-con-noi', 'page.tsx'), 'utf8');
    const riga = modello.slice(modello.indexOf('{JOBS.map('), modello.indexOf('Candidati <ArrowRight'));
    expect(riga, 'la riga delle posizioni deve esserci nel file').toContain('<li');
    expect(riga).toMatch(/className="flex-1 min-w-\[min\(200px,100%\)\]"/);
    expect(riga, 'la colonna del titolo non deve chiedere 200 px fissi').not.toContain('min-w-[200px]');
    expect(riga).toMatch(/href=\{job\.mailto\}\s*className="[^"]*max-w-full/);
  });

  it('/help: i tre riquadri di contatto possono stringersi e il testo va a capo', () => {
    const d = doc(createElement(HelpPage));
    const riquadri = Array.from(d.querySelectorAll('a')).filter((a) => classi(a).includes('rounded-lg') && classi(a).includes('p-3'));
    expect(riquadri.length).toBeGreaterThanOrEqual(2);
    for (const r of riquadri) {
      expect(classi(r)).toContain('min-w-0');
      const testo = Array.from(r.children).find((c) => c.tagName === 'DIV')!;
      expect(classi(testo)).toContain('min-w-0');
      expect(classi(testo)).toContain('[overflow-wrap:anywhere]');
    }
  });

  it('/contact: il titolo va a capo e la griglia ha una colonna sola sotto md', () => {
    const d = doc(createElement(ContactPage));
    const h1 = d.querySelector('h1');
    expect(classi(h1)).toContain('break-words');
    expect(classi(h1)).toContain('hyphens-auto');
    const griglia = Array.from(d.querySelectorAll('div')).find((x) => classi(x).includes('md:grid-cols-5'));
    expect(classi(griglia)).toContain('grid-cols-1');
  });

  it('/terms: «risultati organici» e «contenuti sponsorizzati» sono due parole, non una', () => {
    const d = doc(createElement(TermsPage));
    const testo = (d.body.textContent ?? '').replace(/\s+/g, ' ');
    expect(testo).toContain('risultati organici');
    expect(testo).toContain('contenuti sponsorizzati');
    expect(testo).not.toContain('risultatiorganici');
    expect(testo).not.toContain('contenutisponsorizzati');
  });

  it('le pagine legali: il titolo va a capo (su /privacy «Informativa» usciva)', () => {
    const d = doc(createElement(LegalLayout, { title: 'Informativa sulla privacy', toc: [] } as never, createElement('p', null, 'x')));
    const h1 = d.querySelector('h1');
    expect(classi(h1)).toContain('break-words');
    expect(classi(h1)).toContain('hyphens-auto');
  });
});
