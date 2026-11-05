import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import RiderHelpPage from '@/app/rider/help/page';

/**
 * Sessione S02 (5/11/2026) — l'aiuto dei fattorini dice quello che il sito fa davvero.
 *  · 150:  niente pulsante «Problema» che non esiste, niente «Top rider» né avvisi sul voto,
 *          niente «una alla volta»; la risposta sul cliente assente dice cosa fa il pulsante vero;
 *  · 2613: in contrassegno col credito MyCity il compenso può arrivare in parte col bonifico;
 *  · 106:  «Sono assicurato?» nomina l'INAIL.
 */
const testo = renderToStaticMarkup(createElement(RiderHelpPage)).replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');

describe('l aiuto dei fattorini', () => {
  it('150 · cliente assente: il pulsante vero e cosa succede, niente «Problema»', () => {
    expect(testo).not.toContain('"Problema"');
    expect(testo).toContain('Cliente assente — annulla la consegna');
    expect(testo).toContain('rimborso intero');
  });

  it('150 · niente «Top rider», niente avvisi sotto 4,0 / 3,5, niente «una alla volta»', () => {
    expect(testo).not.toMatch(/Top rider|Sotto 4\.0|Sotto 3\.5/);
    expect(testo).not.toMatch(/Una alla volta/);
    expect(readFileSync('app/rider/reviews/page.tsx', 'utf8')).not.toContain('Top rider');
  });

  it('2613 · contrassegno col credito: il resto del compenso arriva col bonifico', () => {
    expect(testo).toContain('credito MyCity e il contante non basta');
  });

  it('106 · «Sono assicurato?» nomina l INAIL', () => {
    expect(testo).toContain('INAIL');
  });
});
