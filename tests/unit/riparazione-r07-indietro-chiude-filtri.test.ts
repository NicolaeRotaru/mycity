/**
 * @vitest-environment jsdom
 */
/**
 * R07-007 — Sul telefono il pannello dei filtri (ricerca e categoria) copre tutta la pagina e
 * sembra una pagina: chi premeva Indietro per chiuderlo usciva dalla ricerca e perdeva i filtri.
 *
 * Qui si prova il hook vero dei pannelli (useBottomSheetA11y) con la cronologia vera di jsdom, e
 * poi le due pagine vere: col pannello aperto Indietro lo chiude e si resta sulla pagina; chiuso
 * con la X o con «Mostra risultati» non resta nessuna voce di cronologia orfana (niente doppio
 * Indietro).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, createElement, useRef, useState } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { monta } from './aiuti/monta-componente';
import { useBottomSheetA11y } from '@/components/hooks/useBottomSheetA11y';

const g = globalThis as Record<string, unknown>;
let schermo: ReturnType<typeof accendi> | null = null;

/** Lascia arrivare il popstate che jsdom manda dopo history.back(). */
async function lasciaTornare() {
  await act(async () => {
    await new Promise((fatto) => setTimeout(fatto, 20));
  });
}

beforeEach(async () => {
  // Una pagina prima della ricerca, poi la ricerca: Indietro «vero» porterebbe via da qui.
  window.history.replaceState({ dove: 'home' }, '', '/');
  window.history.pushState({ dove: 'pagina' }, '', '/search?q=pane');
  await lasciaTornare();
});

afterEach(async () => {
  schermo?.smonta();
  schermo = null;
  await lasciaTornare();
  delete g.__DATI_QUERY__;
  delete g.__PERCORSO_FINTO__;
  delete g.__QUERY_FINTA__;
});

/** Un pannello minimo col hook vero, come lo usano le pagine dei filtri. */
function PannelloDiProva() {
  const [aperto, setAperto] = useState(false);
  const pannello = useRef<HTMLDivElement>(null);
  const pulsante = useRef<HTMLButtonElement>(null);
  useBottomSheetA11y(aperto, pannello, pulsante, () => setAperto(false), { indietroChiude: true });
  return createElement(
    'div',
    null,
    createElement('button', { ref: pulsante, id: 'apri', onClick: () => setAperto(true) }, 'Filtri'),
    aperto &&
      createElement(
        'div',
        { ref: pannello, role: 'dialog', 'aria-label': 'Filtri' },
        createElement('button', { id: 'chiudi', onClick: () => setAperto(false) }, 'Chiudi'),
      ),
  );
}

const pannelloAperto = () => schermo!.radice.querySelector('[role="dialog"]') !== null;

describe('R07-007 · il hook dei pannelli: Indietro chiude il pannello', () => {
  it('col pannello aperto, Indietro lo chiude e si resta sulla pagina', async () => {
    schermo = accendi(PannelloDiProva);
    schermo.agisci(() => clicca(schermo!.radice.querySelector('#apri')!));
    expect(pannelloAperto()).toBe(true);

    await act(async () => { window.history.back(); });
    await lasciaTornare();

    expect(pannelloAperto(), 'Indietro non ha chiuso il pannello').toBe(false);
    expect(window.history.state, 'Indietro ha portato via dalla pagina').toEqual({ dove: 'pagina' });
    expect(window.location.pathname + window.location.search).toBe('/search?q=pane');
  });

  it('chiuso con il suo pulsante non lascia una voce di cronologia orfana', async () => {
    schermo = accendi(PannelloDiProva);
    schermo.agisci(() => clicca(schermo!.radice.querySelector('#apri')!));
    schermo.agisci(() => clicca(schermo!.radice.querySelector('#chiudi')!));
    await lasciaTornare();

    expect(pannelloAperto()).toBe(false);
    // Si è tornati sulla voce della pagina: il prossimo Indietro porta alla pagina prima, non a vuoto.
    expect(window.history.state).toEqual({ dove: 'pagina' });

    // Riaperto e richiuso con Indietro: ancora sulla pagina, una sola voce.
    schermo.agisci(() => clicca(schermo!.radice.querySelector('#apri')!));
    await act(async () => { window.history.back(); });
    await lasciaTornare();
    expect(pannelloAperto()).toBe(false);
    expect(window.history.state).toEqual({ dove: 'pagina' });
  });
});

/** Il pannello dei filtri di una pagina vera: aperto dal pulsante «Filtri» del telefono. */
async function apriFiltri(file: string, proprieta: Record<string, unknown> = {}) {
  const mod = await monta(file);
  schermo = accendi(mod.default, proprieta);
  await lasciaTornare();
  const pulsante = schermo.radice.querySelector('button[aria-label="Filtri"]');
  expect(pulsante, 'manca il pulsante Filtri del telefono').not.toBeNull();
  schermo.agisci(() => clicca(pulsante!));
  expect(pannelloAperto(), 'il pannello dei filtri non si è aperto').toBe(true);
}

const CATEGORIA = {
  category: { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  madre: null,
  subcategories: [],
};

describe.each([
  { nome: 'ricerca', file: 'app/search/page.tsx', proprieta: {}, prepara: () => { g.__PERCORSO_FINTO__ = '/search'; g.__QUERY_FINTA__ = 'q=pane'; } },
  {
    nome: 'categoria',
    file: 'app/category/[slug]/page.tsx',
    proprieta: { params: { slug: 'alimentari' } },
    prepara: () => { g.__DATI_QUERY__ = (o: { queryKey: readonly unknown[] }) => (o.queryKey[0] === 'category' ? CATEGORIA : undefined); },
  },
])('R07-007 · il pannello dei filtri della $nome', ({ file, proprieta, prepara }) => {
  it('col pannello aperto, Indietro lo chiude e si resta sulla pagina', async () => {
    prepara();
    await apriFiltri(file, proprieta);

    await act(async () => { window.history.back(); });
    await lasciaTornare();

    expect(pannelloAperto(), 'Indietro non ha chiuso il pannello dei filtri').toBe(false);
    expect(window.history.state, 'Indietro ha portato via dalla pagina').toEqual({ dove: 'pagina' });
  }, 60000);

  it('chiuso con «Mostra risultati» non lascia una voce di cronologia orfana', async () => {
    prepara();
    await apriFiltri(file, proprieta);
    const mostra = Array.from(schermo!.radice.querySelectorAll('[role="dialog"] button')).find((b) => /mostra/i.test(b.textContent ?? ''));
    expect(mostra, 'manca il pulsante per chiudere il pannello').toBeDefined();
    schermo!.agisci(() => clicca(mostra!));
    await lasciaTornare();

    expect(pannelloAperto()).toBe(false);
    expect(window.history.state).toEqual({ dove: 'pagina' });
  }, 60000);
});
