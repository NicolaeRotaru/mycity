/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { apriIlCruscotto, chiudiIlCruscotto } from './aiuti/cruscotto-del-negozio';
import * as interruttori from '@/lib/funzioni-al-lancio';

/**
 * 31/10/2026 — CON L'AI E IL CARICAMENTO DA FILE SPENTI, IL NEGOZIO NON VEDE
 * INGRESSI VERSO FUNZIONI CHE NON CI SONO.
 *
 * Carta #209, firmata da Nicola: al lancio l'AI per i negozi e il caricamento da
 * file sono spenti (lib/funzioni-al-lancio.ts). La chiave ANTHROPIC_API_KEY in
 * produzione non c'è: ogni pulsante AI rispondeva «Servizio AI non configurato».
 * Il caso vero: un negozio appena approvato apre «Nuovo prodotto» e trova
 * «Ottimizza per la ricerca», «Perché non vende?», l'assistente, la dettatura;
 * nel pannello il pulsante fisso «Chiedi al Copilot» e la voce «AI Studio»
 * portano a «Gli strumenti AI non sono attivi»; lo stato vuoto del catalogo
 * offre «Importa CSV», che porta a «Il caricamento da file non è attivo».
 *
 * Le pagine si montano per davvero, con l'interruttore vero: se Nicola ne
 * riaccende uno, la prova di quella funzione salta (skipIf) e va riscritta con
 * la riaccensione.
 */

const globali = globalThis as Record<string, unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  for (const k of ['__UTENTE__', '__DATI_QUERY__', '__PROFILO__', '__PERCORSO_FINTO__']) globali[k] = undefined;
});

const PRODOTTO = { name: 'Focaccia', description: 'Focaccia al rosmarino', tags: [], attributes: {}, category_id: null };

/** Tutto quello che una persona legge o sente: testo a video, etichette dei pulsanti e dei link. */
function tuttoQuelloCheSiLegge(radice: HTMLElement): string {
  const etichette = Array.from(radice.querySelectorAll('[aria-label], [title]'))
    .map((n) => `${n.getAttribute('aria-label') ?? ''} ${n.getAttribute('title') ?? ''}`)
    .join(' ');
  return `${testoVisibile(radice)} ${etichette}`.replace(/\s+/g, ' ');
}

function linkVerso(radice: HTMLElement, href: string): Element[] {
  return Array.from(radice.querySelectorAll('a')).filter((a) => (a.getAttribute('href') ?? '').startsWith(href));
}

describe.skipIf(interruttori.AI_NEGOZI_ACCESA)('AI per i negozi spenta: la scheda prodotto', () => {
  it('gli strumenti rapidi non offrono SEO né «Perché non vende?»', async () => {
    const mod = await monta('components/seller/QuickAiTools.tsx');
    const s = accendi(mod.default, {
      product: PRODOTTO,
      attributeSchema: [],
      topCategories: [],
      imageUrls: [],
      onApplyPatch: () => ({ applicati: [], scartati: [] }),
    });
    await attendi();
    const pulsanti = Array.from(s.radice.querySelectorAll('button')).map((b) => b.textContent ?? '');
    expect(
      pulsanti.filter((t) => /ottimizza per la ricerca|perché non vende/i.test(t)),
      'SEO e diagnosi chiamano /api/ai/* e rispondono «servizio AI non configurato»',
    ).toEqual([]);
    expect(testoVisibile(s.radice), 'il riquadro «Strumenti AI» promette strumenti spenti').not.toMatch(/Strumenti AI/i);
    s.smonta();
  }, 60000);

  it('il modulo «Nuovo prodotto» non mostra nessun pulsante AI, e resta compilabile', async () => {
    const mod = await monta('components/seller/ProductForm.tsx');
    const s = accendi(mod.default, {
      mode: 'create',
      categories: [{ id: 'cat-1', name: 'Dolci', slug: 'dolci', parent_id: null }],
      initialValues: {
        name: 'Torta di compleanno',
        description: 'Pan di spagna e fragole.',
        price: 24,
        stock: 3,
        categoryId: 'cat-1',
        images: ['https://mycity.test/torta-1.jpg', 'https://mycity.test/torta-2.jpg'],
      },
      onSubmit: () => undefined,
      sellerOffersExpress: false,
    });
    await attendi();
    await attendi();
    const testo = tuttoQuelloCheSiLegge(s.radice);
    expect(testo, 'controprova: il modulo prodotto si deve vedere').toContain('Descrizione');
    expect(s.radice.querySelector('textarea'), 'controprova: la descrizione si scrive a mano').not.toBeNull();
    expect(
      testo.match(/[^.]{0,40}\b(AI|IA|Copilot|assistente)\b[^.]{0,40}/gi) ?? [],
      'il modulo offre funzioni AI che rispondono «servizio AI non configurato»',
    ).toEqual([]);
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.AI_NEGOZI_ACCESA)('AI per i negozi spenta: il pannello del negozio', () => {
  it('niente Copilot (laterale e fisso) né «AI Studio», e il menu resta', async () => {
    globali.__PERCORSO_FINTO__ = '/seller/orders';
    globali.__PROFILO__ = { isSeller: true, profile: { id: 'negozio-1', store_name: 'Pane Quotidiano' } };
    const mod = await monta('components/seller/SellerShell.tsx');
    const s = accendi(function Pagina() {
      return createElement(mod.default as ComponentType<Record<string, unknown>>, null, 'I tuoi ordini di oggi');
    });
    await attendi();
    expect(linkVerso(s.radice, '/seller/products').length, 'controprova: il menu del negozio si deve vedere').toBeGreaterThan(0);
    expect(linkVerso(s.radice, '/seller/products/ai-batch').length, 'un ingresso porta a «Gli strumenti AI non sono attivi»').toBe(0);
    expect(tuttoQuelloCheSiLegge(s.radice), 'il pannello promette un Copilot che non c\'è').not.toMatch(/Copilot|AI Studio/i);
    s.smonta();
  }, 60000);
});

describe('catalogo: nessun ingresso verso funzioni spente', () => {
  it('lo stato vuoto e la testata non offrono «AI sul catalogo» né «Importa CSV» se spenti', async () => {
    globali.__DATI_QUERY__ = (o: { queryKey?: readonly unknown[] }) => {
      const chiave = (o?.queryKey ?? []) as unknown[];
      if (chiave.some((p) => p === 'venduti')) return {};
      return Object.assign([], { righe: [], totale: 0 });
    };
    const mod = await monta('app/seller/products/page.tsx');
    const s = accendi(mod.default, {});
    await attendi();
    expect(testoVisibile(s.radice), 'controprova: lo stato vuoto si deve vedere').toMatch(/Nessun prodotto a catalogo/);
    expect(linkVerso(s.radice, '/seller/products/new').length, 'controprova: la strada che funziona resta').toBeGreaterThan(0);
    if (!interruttori.AI_NEGOZI_ACCESA) {
      expect(linkVerso(s.radice, '/seller/products/ai-batch').length, '«AI sul catalogo» porta a una pagina spenta').toBe(0);
    }
    if (!interruttori.CARICAMENTO_DA_FILE_ACCESO) {
      expect(linkVerso(s.radice, '/seller/products/import').length, '«Importa CSV» porta a «Il caricamento da file non è attivo»').toBe(0);
    }
    s.smonta();
  }, 60000);
});

describe.skipIf(interruttori.CARICAMENTO_DA_FILE_ACCESO)('caricamento da file spento: il cruscotto', () => {
  it('la scorciatoia «Importa prodotti» non c\'è, le altre restano', async () => {
    apriIlCruscotto();
    try {
      const mod = await monta('app/seller/dashboard/page.tsx');
      const s = accendi(mod.default as ComponentType);
      await attendi();
      expect(linkVerso(s.radice, '/seller/profile').length, 'controprova: le scorciatoie del negozio si devono vedere').toBeGreaterThan(0);
      expect(linkVerso(s.radice, '/seller/products/import').length, '«Importa prodotti» porta a una funzione spenta').toBe(0);
      s.smonta();
    } finally {
      chiudiIlCruscotto();
    }
  }, 60000);
});
