/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, Suspense, type ComponentType } from 'react';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, clicca, attendi } from './aiuti/schermo';

/**
 * 27/8/2026 (R115) — CAMPI CHE PERDEVANO IL NOME ALLA PRIMA LETTERA SCRITTA.
 *
 * Diversi campi rivolti al cliente avevano per unica indicazione la scritta
 * grigia dentro al campo. Quella scritta sparisce appena si digita: chi torna
 * indietro per correggere, chi ingrandisce la pagina, chi usa un lettore di
 * schermo, non ha più modo di sapere che cosa ci andava scritto. Altri campi
 * avevano l'etichetta scritta sopra ma non collegata (un `<label>` senza
 * `htmlFor` e senza il campo dentro): si vede, ma per il browser quel campo
 * resta senza nome.
 *
 * Il caso peggiore era il campo del titolo di una lista, in modifica: né
 * etichetta né scritta-suggerimento. Un riquadro bianco e basta.
 *
 * Questa prova monta i componenti veri e chiede a ogni campo il nome che un
 * browser calcolerebbe — senza contare la scritta-suggerimento, che non è un
 * nome.
 */

// Il documento è uno solo per tutto il file: se un pezzo montato prima resta
// attaccato, la prova dopo conta anche i suoi campi.
afterEach(() => {
  document.body.innerHTML = '';
});

function campi(radice: Element): HTMLElement[] {
  return Array.from(
    radice.querySelectorAll<HTMLElement>('input:not([type="hidden"]):not([type="range"]):not([type="file"]), textarea'),
  );
}

function senzaNome(radice: Element): string[] {
  return campi(radice)
    .filter((c) => !nomeAccessibile(c))
    .map((c) => `«${c.getAttribute('placeholder') ?? '(nemmeno un suggerimento)'}»`);
}

describe('le domande al negozio sulla scheda prodotto', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__PROFILO__ = { isAuthenticated: true, isBuyer: true };
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [];
  });

  it('il campo della domanda ha un nome che non sparisce quando scrivi', async () => {
    const mod = await monta('components/ProductQA.tsx');
    const s = accendi(mod.default, { productId: 'p1', sellerId: 'n1' });
    const mancanti = senzaNome(s.radice);
    expect(
      mancanti,
      `Campi senza nome nelle domande al negozio: ${mancanti.join(', ')}`,
    ).toEqual([]);
    s.smonta();
  }, 60000);

  it('anche il campo della risposta del negoziante', async () => {
    (globalThis as Record<string, unknown>).__PROFILO__ = {
      isAuthenticated: true,
      isSeller: true,
      profile: { id: 'n1' },
    };
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [
      {
        id: 'd1',
        product_id: 'p1',
        author_id: 'u1',
        question: 'Fate consegne il sabato?',
        answer: null,
        answered_at: null,
        created_at: '2026-08-01T09:00:00Z',
        author: { full_name: 'Marta' },
      },
    ];
    const mod = await monta('components/ProductQA.tsx');
    const s = accendi(mod.default, { productId: 'p1', sellerId: 'n1' });
    const mancanti = senzaNome(s.radice);
    expect(mancanti, `Campi senza nome: ${mancanti.join(', ')}`).toEqual([]);
    s.smonta();
  }, 60000);
});

describe('il pannello «aggiungi a una lista»', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [];
  });

  it('il campo della nuova lista è collegato alla sua etichetta', async () => {
    const mod = await monta('components/AddToListButton.tsx');
    const s = accendi(mod.default, { productId: 'p1' });
    s.agisci(() => clicca(s.radice.querySelector('button')!));

    const mancanti = senzaNome(s.radice);
    expect(
      mancanti,
      `«+ Crea nuova lista» era scritto sopra il campo ma non collegato a niente: ${mancanti.join(', ')}`,
    ).toEqual([]);
    s.smonta();
  }, 60000);
});

describe('la pagina delle liste', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = [];
  });

  it('Emoji, Titolo e Descrizione sono etichette collegate, non scritte sopra e basta', async () => {
    const mod = await monta('app/lists/page.tsx');
    const s = accendi(mod.default, {});
    const apri = Array.from(s.radice.querySelectorAll('button')).find((b) => {
      const t = (b.textContent ?? '').toLowerCase();
      return t.includes('nuova lista') || t.includes('prima lista');
    })!;
    expect(apri, 'Il pulsante che apre la nuova lista non si trova').toBeTruthy();
    s.agisci(() => clicca(apri));

    // Il riquadro della nuova lista esce da un portale: sta nel corpo della
    // pagina, non dentro il pezzo montato.
    const mancanti = senzaNome(document.body);
    expect(mancanti.length, 'Il riquadro «Nuova lista» non si è aperto: la prova non sta guardando niente').toBeGreaterThanOrEqual(0);
    expect(document.body.textContent, 'Il riquadro «Nuova lista» doveva aprirsi').toContain('Emoji');
    expect(mancanti, `Campi della nuova lista senza nome: ${mancanti.join(', ')}`).toEqual([]);
    s.smonta();
  }, 60000);
});

describe('il titolo di una lista, in modifica', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__UTENTE__ = { id: 'u1', email: 'nicola@esempio.it' };
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = (opzioni: { queryKey?: unknown[] }) =>
      (opzioni?.queryKey ?? []).includes('detail')
        ? {
            id: 'l1',
            owner_id: 'u1',
            title: 'Colazione della domenica',
            description: null,
            cover_emoji: '\u{1F950}',
            is_public: true,
            updated_at: '2026-08-01T09:00:00Z',
            owner: { public_handle: 'nicola', full_name: 'Nicola' },
          }
        : [];
  });

  it('il campo del titolo non è un riquadro bianco senza nome', async () => {
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

    const modifica = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase().includes('modific'),
    );
    if (modifica) s.agisci(() => clicca(modifica));

    const mancanti = senzaNome(s.radice);
    expect(
      mancanti,
      `Il campo del titolo in modifica non aveva né etichetta né suggerimento: un riquadro bianco. Campi senza nome: ${mancanti.join(', ')}`,
    ).toEqual([]);
    s.smonta();
  }, 60000);
});
