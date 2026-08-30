/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { nomeAccessibile, controlli } from './aiuti/monta-componente';

/**
 * 27/8/2026 (R104 e R114) — I FILTRI DEI NEGOZI ERANO MUTI E SENZA STATO.
 *
 * Su /stores il menu che ordina i negozi («Più amati / Più assortiti / A-Z») non
 * aveva né una etichetta collegata né un `aria-label`: chi ascolta la pagina con
 * un lettore di schermo sentiva «menu a discesa» e basta, senza sapere che cosa
 * ordinava. Stessa cosa per il campo che cerca il negozio per nome, che aveva
 * solo la scritta-suggerimento dentro — e la scritta-suggerimento sparisce
 * appena si digita la prima lettera.
 *
 * Nella vetrina del singolo negozio le etichette «Ordina per» e «Categoria»
 * c'erano, ma erano scritte in un `<label>` senza `htmlFor`: si vedono, non
 * sono collegate a niente. Per il browser quei due menu restavano senza nome.
 *
 * E i filtri a interruttore («Aperti ora», i settori, il voto minimo) dicevano
 * di essere accesi solo cambiando colore: chi non vede il colore — o non vede
 * affatto — non aveva modo di sapere quale filtro era attivo.
 *
 * Questa prova monta i componenti veri e chiede, per ogni controllo, il nome
 * che un lettore di schermo pronuncerebbe. Se qualcuno toglie un'etichetta,
 * qui diventa rosso.
 */

const NEGOZI = {
  stores: [
    { id: 'n1', store_name: 'Pane Quotidiano', store_phone: null, store_address: 'Via Roma 1', store_lat: null, store_lng: null, store_logo: null, store_hours: {}, store_media: null, is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: true },
  ],
  productsByStore: {},
  reviewsByStore: {},
  countByStore: { n1: 3 },
  categoriesByStore: { n1: new Set(['c1']) },
  categories: [{ id: 'c1', slug: 'gastronomia', name: 'Gastronomia', parent_id: null, icon: '🥖' }],
};

describe('la pagina di tutti i negozi', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = NEGOZI;
  });

  it('ogni comando dei filtri ha un nome che un lettore di schermo può pronunciare', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});

    const senzaNome = controlli(s.radice)
      .filter((c) => !nomeAccessibile(c))
      .map((c) => c.outerHTML.slice(0, 90));

    expect(
      senzaNome,
      `Su /stores ci sono ${senzaNome.length} comandi che un lettore di schermo annuncia senza dire cosa fanno: ${senzaNome.join(' | ')}`,
    ).toEqual([]);
    s.smonta();
  }, 60000);

  it('il menu che ordina i negozi dice di ordinare i negozi', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});
    const menu = s.radice.querySelector('select')!;
    expect(menu, 'Il menu di ordinamento dei negozi è sparito dalla pagina').toBeTruthy();
    expect(
      nomeAccessibile(menu).toLowerCase(),
      'Chi ascolta deve sentire che quel menu ordina i negozi, non solo «menu a discesa»',
    ).toContain('ordin');
    s.smonta();
  }, 60000);

  it('«Aperti ora» dice se è acceso, non lo fa capire solo dal colore', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});
    const aperti = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Aperti ora'))!;
    expect(aperti, 'Il filtro «Aperti ora» non si trova più').toBeTruthy();
    expect(
      aperti.getAttribute('aria-pressed'),
      'Spento, il filtro «Aperti ora» deve dichiararsi spento: senza questo lo si capisce solo dal colore',
    ).toBe('false');

    s.agisci(() => clicca(aperti));
    const ora = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Aperti ora'))!;
    expect(
      ora.getAttribute('aria-pressed'),
      'Acceso, il filtro «Aperti ora» deve dichiararsi acceso',
    ).toBe('true');
    s.smonta();
  }, 60000);

  it('la pillola del settore scelto si dichiara scelta', async () => {
    const mod = await monta('app/stores/page.tsx');
    const s = accendi(mod.default, {});
    const tutti = controlli(s.radice).find((c) => nomeAccessibile(c) === 'Tutti i settori')!;
    const gastro = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Gastronomia'))!;
    expect(tutti.getAttribute('aria-pressed'), 'All\'apertura sono selezionati tutti i settori').toBe('true');
    expect(gastro.getAttribute('aria-pressed'), 'Il settore non scelto deve dirsi non scelto').toBe('false');

    s.agisci(() => clicca(gastro));
    const gastroDopo = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Gastronomia'))!;
    expect(gastroDopo.getAttribute('aria-pressed'), 'Il settore appena scelto deve dirsi scelto').toBe('true');
    s.smonta();
  }, 60000);
});

describe('i filtri dentro la vetrina di un negozio', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).__DATI_QUERY__ = (opzioni: { queryKey?: unknown[] }) =>
      opzioni?.queryKey?.[0] === 'store-categories'
        ? [{ id: 'c1', name: 'Pane' }]
        : undefined;
  });

  it('i due menu dei filtri hanno l\'etichetta davvero collegata, non solo scritta sopra', async () => {
    const mod = await monta('components/StoreProductExplorer.tsx');
    const s = accendi(mod.default, { sellerId: 'n1' });
    const apri = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Filtri'))!;
    s.agisci(() => clicca(apri));

    const menu = Array.from(s.radice.querySelectorAll('select'));
    expect(menu.length, 'I due menu dei filtri della vetrina non ci sono più').toBe(2);
    for (const m of menu) {
      expect(
        nomeAccessibile(m),
        `Un menu dei filtri della vetrina resta senza nome: ${m.outerHTML.slice(0, 80)}`,
      ).not.toBe('');
    }
    s.smonta();
  }, 60000);

  it('il campo che cerca dentro il negozio ha un nome che non sparisce quando scrivi', async () => {
    const mod = await monta('components/StoreProductExplorer.tsx');
    const s = accendi(mod.default, { sellerId: 'n1' });
    const campo = s.radice.querySelector('input:not([type="range"])') as HTMLInputElement;
    expect(campo, 'Il campo di ricerca della vetrina è sparito').toBeTruthy();
    expect(
      campo.getAttribute('aria-label') || campo.getAttribute('id'),
      'Il campo aveva solo la scritta-suggerimento dentro: appena scrivi, il nome sparisce',
    ).toBeTruthy();
    s.smonta();
  }, 60000);

  it('il voto minimo scelto si dichiara scelto', async () => {
    const mod = await monta('components/StoreProductExplorer.tsx');
    const s = accendi(mod.default, { sellerId: 'n1' });
    const apri = controlli(s.radice).find((c) => nomeAccessibile(c).includes('Filtri'))!;
    s.agisci(() => clicca(apri));

    const tutti = controlli(s.radice).find((c) => nomeAccessibile(c) === 'Tutti')!;
    const quattro = controlli(s.radice).find((c) => nomeAccessibile(c) === '4+')!;
    expect(tutti.getAttribute('aria-pressed'), 'All\'apertura il voto minimo è «Tutti»').toBe('true');
    expect(quattro.getAttribute('aria-pressed'), '«4+» non è scelto e deve dirlo').toBe('false');

    s.agisci(() => clicca(quattro));
    const quattroDopo = controlli(s.radice).find((c) => nomeAccessibile(c) === '4+')!;
    expect(quattroDopo.getAttribute('aria-pressed'), 'Il voto minimo appena scelto deve dirsi scelto').toBe('true');
    s.smonta();
  }, 60000);
});
