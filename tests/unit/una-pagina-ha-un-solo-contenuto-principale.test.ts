/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 27/8/2026 (R107) — DUE «CONTENUTI PRINCIPALI» UNO DENTRO L'ALTRO.
 *
 * Il guscio del sito (`app/layout.tsx`) avvolge SEMPRE quello che mostra in un
 * `<main id="main-content">`: è il punto d'arrivo del collegamento «salta al
 * contenuto», la prima cosa che usa chi naviga da tastiera per non doversi
 * risentire tutto il menu a ogni pagina.
 *
 * Dentro quel guscio, però, tre pezzi ne aprivano un altro: l'area del
 * fattorino, l'area del venditore e la pagina che chiede di accettare le
 * condizioni. Un `<main>` dentro un `<main>` non è HTML valido — il modello di
 * contenuto lo vieta esplicitamente — e per chi salta di punto di riferimento
 * in punto di riferimento diventa ambiguo: due «contenuto principale», e non si
 * sa quale sia quello buono.
 *
 * La prova ricostruisce lo stesso incastro della pagina vera — il guscio fuori,
 * il pezzo dentro — e conta i contenuti principali: deve essercene UNO.
 * (Il guscio del venditore è in mano a un altro riparatore e resta fuori.)
 */

/** Come `app/layout.tsx`: tutto quello che si mostra sta dentro un solo <main>. */
function dentroIlGuscio(Pezzo: ComponentType<Record<string, unknown>>, proprieta: Record<string, unknown> = {}) {
  return function Pagina() {
    return createElement(
      'main',
      { id: 'main-content' },
      createElement(Pezzo, proprieta),
    );
  };
}

describe('l\'area del fattorino', () => {
  it('non apre un secondo «contenuto principale» dentro quello del sito', async () => {
    const mod = await monta('components/rider/RiderShell.tsx');
    const s = accendi(
      dentroIlGuscio(mod.default as ComponentType<Record<string, unknown>>, {
        showSOS: false,
        children: 'Le tue consegne di oggi',
      }),
    );
    const principali = s.radice.querySelectorAll('main');
    expect(
      principali.length,
      `Su tutta l'area del fattorino ci sono ${principali.length} «contenuto principale» annidati: HTML non valido, e chi salta fra i punti di riferimento non sa quale sia quello buono`,
    ).toBe(1);
    s.smonta();
  }, 60000);
});

describe('la pagina che chiede di accettare le condizioni', () => {
  it('non apre un secondo «contenuto principale» dentro quello del sito', async () => {
    const mod = await monta('app/accetta-condizioni/page.tsx');
    const s = accendi(dentroIlGuscio(mod.default as ComponentType<Record<string, unknown>>));
    const principali = s.radice.querySelectorAll('main');
    expect(
      principali.length,
      `La pagina delle condizioni produce ${principali.length} «contenuto principale» annidati`,
    ).toBe(1);
    expect(s.radice.textContent, 'La pagina deve continuare a mostrare quello che mostrava').toContain('Ancora una cosa');
    s.smonta();
  }, 60000);
});
