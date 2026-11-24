import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Card } from '@/components/ui/Card';

/**
 * R10-001 — Nei file del fattorino e di «Chi siamo» i riquadri con lo schema della card
 * (`bg-white|bg-surface-0` + `border` + `rounded-(lg|xl|2xl)`) sono <Card>. Restano a mano, di
 * proposito: le caselle dei numeri di «Chi siamo» (due prove leggono la loro classe per nome), i due
 * riquadri col gradiente (decorazione) e il link dell'ordine in corso col bordo accent (la primitiva
 * non sa sovrascrivere un bordo: cn non unisce le classi in conflitto).
 */
const leggi = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const TENUTI = [
  /min-w-0 bg-white border border-cream-300 rounded-xl/, // casella dei numeri di about
  /border-2 border-accent-400/,                            // ordine in corso: bordo accent
  /bg-gradient-to-br/,                                      // decorazione
];

describe('R10-001 — riquadri a mano -> Card', () => {
  it.each(['app/rider/page.tsx', 'app/about/page.tsx'])('%s: nessun riquadro a mano fuori dai tenuti di proposito', (f) => {
    const src = leggi(f);
    // ogni className="…" o template literal con le classi dello schema, anche su più righe
    const pezzi = [...src.matchAll(/(?:className=(?:"([^"]*)"|\{`([^`]*)`\}))/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/\s+/g, ' '));
    const aMano = pezzi.filter((c) =>
      /\b(bg-white|bg-surface-0)\b/.test(c) && /\bborder\b/.test(c) && /\brounded-(lg|xl|2xl)\b/.test(c) && !TENUTI.some((t) => t.test(c)));
    expect(aMano).toEqual([]);
  });

  it('il riquadro «sto controllando» e quello offline del fattorino sono Card', () => {
    const src = leggi('app/rider/page.tsx');
    expect(src).toMatch(/<Card[^>]*aria-live="polite"/);
    expect(src).toMatch(/function RiquadroOnline[\s\S]*<Card variant="surface"/);
  });

  it('Card passa aria-live (e il resto delle prop HTML) al div', () => {
    const html = renderToStaticMarkup(createElement(Card, { 'aria-live': 'polite', id: 'x', role: 'status', children: 'ciao' }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="x"');
    expect(html).toContain('role="status"');
  });
});
