/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 6/9/2026 — NEL PANNELLO DEL NEGOZIANTE C'ERANO DUE «CONTENUTO PRINCIPALE».
 *
 * Il guscio del sito (`app/layout.tsx`) avvolge sempre quello che mostra in un
 * `<main id="main-content">`. E' il punto d'arrivo del collegamento «salta al
 * contenuto», cioe' la scorciatoia con cui chi usa un lettore di schermo evita
 * di risentirsi tutto il menu a ogni pagina.
 *
 * Dentro quel guscio, il pannello del negoziante ne apriva un altro. Un
 * `<main>` dentro un `<main>` non e' HTML valido — il modello di contenuto lo
 * vieta — e per chi salta da un punto di riferimento all'altro diventa
 * ambiguo: due «contenuto principale», e non si sa quale sia quello buono. In
 * pratica un commerciante ipovedente partiva dal menu laterale invece che dal
 * contenuto.
 *
 * A fine agosto la stessa cosa era stata sistemata nell'area del fattorino e
 * nella pagina delle condizioni (la prova sta in
 * `una-pagina-ha-un-solo-contenuto-principale.test.ts`), ma il guscio del
 * venditore era rimasto fuori, in mano a un altro riparatore. Questa prova
 * chiude quel buco.
 *
 * Come funziona: ricostruisce lo stesso incastro della pagina vera — il guscio
 * del sito fuori, quello del venditore dentro — e conta i «contenuto
 * principale». Deve essercene UNO. Se domani qualcuno rimette un `<main>` nel
 * pannello del negoziante, qui diventano due e la prova va in rosso.
 */

/** Come `app/layout.tsx`: tutto quello che si mostra sta dentro un solo <main>. */
function dentroIlGuscio(Pezzo: ComponentType<Record<string, unknown>>, proprieta: Record<string, unknown> = {}) {
  return function Pagina() {
    return createElement('main', { id: 'main-content' }, createElement(Pezzo, proprieta));
  };
}

describe('il pannello del negoziante', () => {
  it('non apre un secondo «contenuto principale» dentro quello del sito', async () => {
    const mod = await monta('components/seller/SellerShell.tsx');
    const s = accendi(
      dentroIlGuscio(mod.default as ComponentType<Record<string, unknown>>, {
        children: 'I tuoi ordini di oggi',
      }),
    );

    const principali = s.radice.querySelectorAll('main');
    expect(
      principali.length,
      `Nel pannello del negoziante ci sono ${principali.length} «contenuto principale» annidati: HTML non valido, e chi salta fra i punti di riferimento non sa quale sia quello buono`,
    ).toBe(1);

    expect(
      s.radice.textContent,
      'Il pannello deve continuare a mostrare quello che gli si mette dentro',
    ).toContain('I tuoi ordini di oggi');

    s.smonta();
  }, 60000);
});
