/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, Suspense, type ComponentType } from 'react';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 6/9/2026 — L'ULTIMO CAMPO SENZA NOME DELLE LISTE, QUELLO CHE LA PROVA DEL
 * 27/8 NON POTEVA VEDERE.
 *
 * «I campi da riempire hanno un nome che resta» copre già sei campi, fra cui
 * il titolo della lista in modifica. Ma monta la pagina della lista con
 * l'elenco dei prodotti VUOTO: `__DATI_QUERY__` risponde `[]` a tutto quello
 * che non è `detail`. Il campo della nota — «Perché l'hai messo in lista?» —
 * vive dentro la riga di un prodotto, e con la lista vuota quella riga non
 * viene mai disegnata. Risultato: il campo restava con la sola scritta grigia
 * dentro, quella che sparisce alla prima lettera, e la prova non se ne
 * accorgeva.
 *
 * Qui la stessa pagina si monta con un prodotto dentro e con l'utente che è
 * il padrone della lista, perché è solo a lui che il campo compare. Poi si
 * chiede a ogni campo il nome che un browser calcolerebbe — senza contare la
 * scritta-suggerimento, che non è un nome (WCAG 3.3.2).
 */

afterEach(() => {
  document.body.innerHTML = '';
});

const LISTA = {
  id: 'l1',
  owner_id: 'u1',
  title: 'Colazione della domenica',
  description: null,
  cover_emoji: '\u{1F950}',
  is_public: true,
  updated_at: '2026-08-01T09:00:00Z',
  owner: { public_handle: 'nicola', full_name: 'Nicola' },
};

const RIGHE = [
  {
    list_id: 'l1',
    product_id: 'p1',
    sort_order: 0,
    note: null,
    product: { id: 'p1', name: 'Focaccia di Pane Quotidiano', price: 3.5, images: null, status: 'active' },
  },
];

describe('la nota di un prodotto dentro una lista', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__UTENTE__ = { id: 'u1', email: 'nicola@esempio.it' };
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = (opzioni: { queryKey?: unknown[] }) => {
      const chiave = opzioni?.queryKey ?? [];
      if (chiave.includes('detail')) return LISTA;
      if (chiave.includes('items')) return RIGHE;
      return [];
    };
  });

  it('ha un nome anche dopo che ci hai scritto dentro', async () => {
    const mod = await monta('app/lists/[id]/page.tsx');
    const Pagina = mod.default as ComponentType<Record<string, unknown>>;
    const s = accendi(() =>
      createElement(
        Suspense,
        { fallback: null },
        createElement(Pagina, { params: Promise.resolve({ id: 'l1' }) }),
      ),
    );
    await attendi();

    const tutti = Array.from(
      s.radice.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="file"]), textarea'),
    );
    // Se la riga del prodotto non c'è, la prova non sta guardando niente e
    // passerebbe per finta: è esattamente il buco da cui è nato questo file.
    const nota = tutti.find((c) => (c.getAttribute('placeholder') ?? '').includes('in lista'));
    expect(nota, 'La riga del prodotto non è stata disegnata: la prova non guardava nessun campo').toBeTruthy();

    const mancanti = tutti.filter((c) => !nomeAccessibile(c)).map(
      (c) => `«${c.getAttribute('placeholder') ?? '(nemmeno un suggerimento)'}»`,
    );
    expect(
      mancanti,
      `Campi senza nome nella lista aperta dal suo padrone: ${mancanti.join(', ')}`,
    ).toEqual([]);
    s.smonta();
  }, 60000);
});
