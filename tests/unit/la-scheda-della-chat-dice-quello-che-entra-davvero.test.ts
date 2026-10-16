/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { buildDraftProductInsert, type VisionDraft } from '@/lib/products/draftFromVision';
import { productSnapshot } from '@/lib/products/aiSnapshot';
import {
  bozzaDaCreare,
  caratteristicheDellaBozza,
  riquadroDichiarazioni,
  righeDellaProposta,
  type BozzaSalvata,
} from '@/lib/products/prontoPerLaVendita';
import type { AiProductPatch, CategoryRow } from '@/lib/products/aiPatch';

/**
 * 16/10/2026 (giro di correzione) — LA CHAT ASSISTENZA PROMETTEVA COSE CHE LA
 * BOZZA E LA SCHEDA NON MANTENEVANO.
 *
 * Tre difetti dello stesso giro, una causa sola: la chat leggeva quello che il
 * modello aveva scritto, non quello che il server avrebbe tenuto.
 *
 *  1. Una proposta con `attributes_remove: [["allergeni"]]` (un elenco dentro
 *     l'elenco: lo schema non lo garantisce) faceva cadere la chat intera
 *     mentre disegnava la scheda della proposta.
 *  2. «Origine: Italia» letta su un vaso della categoria Casa: il riquadro la
 *     chiedeva da confermare, poi diceva «le scrivi tu nella scheda» — ma la
 *     scheda di Casa il campo Origine non lo ha. Lo stesso nella scheda di una
 *     proposta su un prodotto che c'e' gia'.
 *  3. Sotto la bozza dalle foto, l'elenco delle caratteristiche mostrava
 *     «Tipo di confezione: Vaschetta» e «Colore: Verde» su un barattolo di
 *     olive, mentre nella bozza entrava solo il peso; e «Condizione» con la
 *     maiuscola, che la bozza salva come stato del prodotto.
 *
 * Qui si passa sempre dalla porta vera (`buildDraftProductInsert`) per sapere
 * cosa entra, e il pezzo che cadeva si monta davvero.
 */

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  { id: 'bell', name: 'Bellezza', slug: 'bellezza', parent_id: null },
];

type Bozza = { category_slug: string; attributes: Record<string, string> };

/** Il server: salva la bozza che la chat gli manda e restituisce lo snapshot. */
function salvaComeIlServer(bozza: Bozza, confermate: boolean): BozzaSalvata {
  const riga = {
    id: 'nuova',
    ...buildDraftProductInsert({
      draft: { name: 'Prodotto', ...bozzaDaCreare(bozza, confermate) },
      imageUrls: ['https://abcdefgh.supabase.co/x.jpg'],
      categories: CATEGORIE,
      sellerId: 'negozio-1',
    }),
    has_variants: false,
  };
  const { categorySlug, attributes } = productSnapshot(riga, CATEGORIE);
  return { categorySlug, attributes };
}

/* ------------------------------------------------------------------------- */
/*  1. Una proposta scritta fuori schema non fa cadere la chat                */
/* ------------------------------------------------------------------------- */

const FOCACCIA = { price: 3.5, categorySlug: 'alimentari' };

describe('la scheda della proposta legge ogni voce come la legge il server', () => {
  it('[["allergeni"]] da togliere: nessun errore, e la riga dice che non si applica', () => {
    let righe: string[] = [];
    expect(() => {
      righe = righeDellaProposta({ attributes_remove: [['allergeni']] } as unknown as AiProductPatch, FOCACCIA);
    }, 'la scheda della proposta cade mentre si disegna').not.toThrow();
    expect(righe).toEqual(['Rimuovi Allergeni: NON si applica, lo decidi tu nella scheda del prodotto']);
  });

  const SCRITTE_MALE: unknown[] = [
    { attributes_remove: [['colore']] },
    { attributes_remove: [5, null, { a: 1 }] },
    { attributes_remove: { allergeni: true } },
    { attributes_remove: 'allergeni' },
    { attributes: 'allergeni: glutine' },
    { attributes: ['allergeni', 'glutine'] },
    { attributes: { allergeni: { valore: 'glutine' }, colore: 42 } },
    // Un JSON valido il cui elemento non si sa scrivere come testo: `String` lancia.
    { attributes_remove: [{ toString: null }] },
    { tags: [{ toString: null }, 'focaccia'] },
  ];
  for (const proposta of SCRITTE_MALE) {
    it(`${JSON.stringify(proposta)}: nessun errore`, () => {
      expect(() => righeDellaProposta(proposta as AiProductPatch, FOCACCIA)).not.toThrow();
    });
  }

  it('gli attributi senza un testo non si promettono: il server li ignora', () => {
    expect(
      righeDellaProposta({ attributes: { allergeni: { valore: 'glutine' }, colore: 42 } } as unknown as AiProductPatch, FOCACCIA),
    ).toEqual([]);
  });
});

describe('nella chat montata, una proposta [["allergeni"]] non svuota lo schermo', () => {
  let Chat: ComponentType<Record<string, unknown>>;
  let fetchOriginale: typeof fetch;
  const g = globalThis as Record<string, unknown>;

  beforeAll(async () => {
    fetchOriginale = globalThis.fetch;
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
    Chat = (await monta('components/SupportProductAssistant.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  afterEach(() => {
    globalThis.fetch = fetchOriginale;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    document.body.innerHTML = '';
  });

  it('il negoziante chiede di togliere gli allergeni: la chat resta, e la proposta dice che non si applica', async () => {
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    globalThis.fetch = (async (input: unknown) => {
      if (!String(input).includes('/api/ai/catalog-chat')) throw new Error(`rotta non prevista: ${String(input)}`);
      const dati = {
        reply: 'Ecco la proposta',
        product: {
          id: 'p1',
          name: 'Focaccia',
          description: 'Focaccia genovese',
          price: 3.5,
          compareAtPrice: null,
          unit: 'pezzo',
          condition: null,
          stock: 5,
          status: 'available',
          categorySlug: 'alimentari',
          subcategoryName: null,
          categoryName: 'Alimentari',
          tags: [],
          attributes: { allergeni: 'glutine' },
          image: null,
          hasVariants: false,
        },
        patch: { attributes_remove: [['allergeni']] },
      };
      return { ok: true, status: 200, json: async () => dati } as unknown as Response;
    }) as typeof fetch;

    const s = accendi(Chat);
    const casella = s.radice.querySelector('textarea') as HTMLTextAreaElement;
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(
        casella,
        'togli gli allergeni dalla focaccia',
      );
      casella.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Invia"]')!));
    for (let i = 0; i < 30 && !testoVisibile(s.radice).includes('Ecco la proposta'); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    const schermo = testoVisibile(s.radice);
    expect(s.radice.childElementCount, 'la chat e sparita: lo schermo e vuoto').toBeGreaterThan(0);
    expect(schermo).toContain('Ecco la proposta');
    expect(schermo).toContain('Rimuovi Allergeni: NON si applica, lo decidi tu nella scheda del prodotto');
    s.smonta();
  });
});

/* ------------------------------------------------------------------------- */
/*  2. Una dichiarazione che la categoria non ha non si chiede e non si promette */
/* ------------------------------------------------------------------------- */

describe('una dichiarazione per un campo che la categoria non ha', () => {
  const VASO: Bozza = { category_slug: 'casa', attributes: { marca: 'X', origine: 'Italia' } };

  it('prima della creazione: non si chiede la spunta, e si dice perche non entra', () => {
    const r = riquadroDichiarazioni(VASO, { creata: false, confermate: false });
    expect(r?.chiediSpunta, 'si chiede di confermare una cosa che non entrera mai').toBe(false);
    expect(r?.righe).toEqual([]);
    expect(r?.titolo).toBe('Lette dalle foto ma NON entrano nella bozza');
    expect(r?.daScrivere).toBe('La categoria della bozza non ha questi campi: Origine.');
  });

  it('dopo la creazione, anche con la spunta: non promette di scriverla in una scheda che non ha il campo', () => {
    const salvata = salvaComeIlServer(VASO, true);
    expect(salvata.attributes, 'la porta ha fatto entrare un campo che Casa non ha').not.toHaveProperty('origine');
    const r = riquadroDichiarazioni(VASO, { creata: true, confermate: true, salvata });
    expect(r?.titolo).toBe('Lette dalle foto ma NON entrate nella bozza');
    expect(r?.daScrivere).toBe('La categoria della bozza non ha questi campi: Origine.');
    expect(`${r?.titolo} ${r?.daScrivere}`).not.toContain('le scrivi tu nella scheda');
  });

  it('variante: la bozza nasce senza categoria (il server non ha «alimentari»): nessun rimando a una scheda senza il campo', () => {
    const focaccia: Bozza = { category_slug: 'alimentari', attributes: { allergeni: 'glutine', peso: '300 g' } };
    const prima = riquadroDichiarazioni(focaccia, { creata: false, confermate: true });
    expect(prima?.chiediSpunta, 'prima della creazione la focaccia e un alimento: si conferma').toBe(true);
    const salvata: BozzaSalvata = { categorySlug: null, attributes: {} };
    const r = riquadroDichiarazioni(focaccia, { creata: true, confermate: true, salvata });
    expect(`${r?.titolo} ${r?.daScrivere}`).not.toContain('le scrivi tu nella scheda');
    expect(r?.daScrivere).toBe('La bozza non ha una categoria con questi campi: Allergeni.');
  });

  it('variante: «bio» su un prodotto di Bellezza, che ha solo «bio_naturale»', () => {
    const crema: Bozza = { category_slug: 'bellezza', attributes: { bio: 'true', marca: 'Y' } };
    const prima = riquadroDichiarazioni(crema, { creata: false, confermate: false });
    expect(prima?.chiediSpunta).toBe(false);
    expect(prima?.daScrivere).toContain('Biologico');
  });

  it('controprova: «Origine» su un alimento si conferma ed entra', () => {
    const olio: Bozza = { category_slug: 'alimentari', attributes: { origine: 'Italia' } };
    const prima = riquadroDichiarazioni(olio, { creata: false, confermate: false });
    expect(prima?.righe).toEqual([{ etichetta: 'Origine', valore: 'Italia' }]);
    expect(prima?.chiediSpunta).toBe(true);
    expect(salvaComeIlServer(olio, true).attributes).toHaveProperty('origine', 'Italia');
  });

  it('la scheda di una proposta su un vaso: non rimanda a un campo che la scheda non ha', () => {
    const vaso = { price: 20, categorySlug: 'casa' };
    expect(righeDellaProposta({ attributes: { origine: 'Italia' } }, vaso)).toEqual([
      'Origine → «Italia»: NON si applica, e la scheda di questo prodotto non ha il campo Origine',
    ]);
    // Se la proposta lo sposta fra gli alimentari, la scheda il campo lo avra'.
    expect(righeDellaProposta({ category_slug: 'alimentari', attributes: { origine: 'Italia' } }, vaso)).toContain(
      'Origine → «Italia»: NON si applica, lo scrivi tu nella scheda del prodotto',
    );
  });
});

/* ------------------------------------------------------------------------- */
/*  3. Le caratteristiche mostrate sono quelle che entrano                     */
/* ------------------------------------------------------------------------- */

describe('le caratteristiche sotto la bozza sono quelle che la porta fa entrare', () => {
  const ordinate = (x: { etichetta: string; valore: string }[]) =>
    [...x].sort((a, b) => a.etichetta.localeCompare(b.etichetta));

  /** Mostrate prima e presenti dopo devono essere la stessa cosa. */
  function provaCoerenza(bozza: Bozza) {
    const prima = caratteristicheDellaBozza(bozza, { creata: false });
    const salvata = salvaComeIlServer(bozza, false);
    const dopo = caratteristicheDellaBozza(bozza, { creata: true, salvata });
    return { prima, dopo, salvata };
  }

  it('olive taggiasche: «Vaschetta» non e una confezione ammessa e «Colore» non e un campo degli alimentari', () => {
    const { prima, dopo, salvata } = provaCoerenza({
      category_slug: 'alimentari',
      attributes: { peso: '300 g', confezione: 'Vaschetta', colore: 'Verde' },
    });
    expect(salvata.attributes).toEqual({ peso: '300 g' });
    expect(prima, 'la scheda mostra caratteristiche che nella bozza non entreranno').toEqual([
      { etichetta: 'Peso / Quantità', valore: '300 g' },
    ]);
    expect(ordinate(dopo)).toEqual(ordinate(prima));
  });

  it('«Condizione» con la maiuscola e lo stato del prodotto, non una caratteristica', () => {
    const bozza: Bozza = { category_slug: 'casa', attributes: { Condizione: 'Nuovo', Marca: 'Bialetti' } };
    const prima = caratteristicheDellaBozza(bozza, { creata: false });
    expect(prima).toEqual([{ etichetta: 'Marca', valore: 'Bialetti' }]);
  });

  it('un valore a scelta scritto in minuscolo si mostra come lo salva la porta', () => {
    const { prima, dopo } = provaCoerenza({ category_slug: 'alimentari', attributes: { confezione: 'barattolo' } });
    expect(prima).toEqual([{ etichetta: 'Tipo di confezione', valore: 'Barattolo' }]);
    expect(dopo).toEqual(prima);
  });

  it('dopo la creazione le dichiarazioni salvate restano nel loro riquadro, non fra le caratteristiche', () => {
    const bozza: Bozza = { category_slug: 'alimentari', attributes: { peso: '300 g', allergeni: 'glutine', bio: 'true' } };
    const salvata = salvaComeIlServer(bozza, true);
    expect(salvata.attributes, 'con la spunta la porta le fa entrare: la prova girerebbe a vuoto').toMatchObject({
      allergeni: 'glutine',
      bio: 'true',
    });
    expect(caratteristicheDellaBozza(bozza, { creata: true, salvata })).toEqual([
      { etichetta: 'Peso / Quantità', valore: '300 g' },
    ]);
  });

  it('dopo la creazione si legge la bozza salvata, non la proposta', () => {
    const bozza: Bozza = { category_slug: 'alimentari', attributes: { peso: '300 g', marca: 'Rossi' } };
    // Il server ha salvato solo il peso (per esempio, una marca tolta da un'altra regola).
    const salvata: BozzaSalvata = { categorySlug: 'alimentari', attributes: { peso: '300 g', alt_text: 'foto' } };
    expect(caratteristicheDellaBozza(bozza, { creata: true, salvata })).toEqual([
      { etichetta: 'Peso / Quantità', valore: '300 g' },
    ]);
  });
});

describe('nella chat montata, sotto la bozza dalle foto', () => {
  let Chat: ComponentType<Record<string, unknown>>;
  let fetchOriginale: typeof fetch;
  const g = globalThis as Record<string, unknown>;

  beforeAll(async () => {
    fetchOriginale = globalThis.fetch;
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
    Chat = (await monta('components/SupportProductAssistant.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  afterEach(() => {
    globalThis.fetch = fetchOriginale;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    delete g.__URL_PUBBLICO__;
    document.body.innerHTML = '';
  });

  /** Le righe «Etichetta: valore» delle caratteristiche, fuori dal riquadro delle dichiarazioni. */
  const caratteristiche = (radice: HTMLElement) =>
    Array.from(radice.querySelectorAll('ul.mb-2 li')).map((li) => (li.textContent ?? '').replace(/\s+/g, ' ').trim());

  async function aspettaChe(condizione: () => boolean, cosa: string) {
    for (let i = 0; i < 60; i++) {
      if (condizione()) return;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
    throw new Error(`lo schermo non e arrivato a: ${cosa}`);
  }

  it('le olive: prima solo il peso che entrera; dopo, quello che il server ha salvato davvero', async () => {
    g.__UTENTE__ = { id: 'negozio-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    g.__URL_PUBBLICO__ = (percorso: string) => `https://abcdefgh.supabase.co/storage/v1/object/public/products/${percorso}`;
    // Il server vero, ma nel database la categoria «alimentari» non c'e': la
    // bozza nasce senza categoria e senza caratteristiche.
    const categorieDelServer: CategoryRow[] = [{ id: 'casa', name: 'Casa', slug: 'casa', parent_id: null }];
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      let dati: unknown;
      if (url.includes('/api/vision/extract-product')) {
        dati = {
          name: 'Olive taggiasche',
          description: 'Olive taggiasche in salamoia',
          category_id: null,
          subcategory_id: null,
          category_slug: 'alimentari',
          suggested_price: 6,
          attributes: { peso: '300 g', confezione: 'Vaschetta', colore: 'Verde' },
          tags: [],
          image_quality: null,
          alt_text: null,
        };
      } else if (url.includes('/api/ai/catalog-create')) {
        const riga = {
          id: 'nuovo-0',
          ...buildDraftProductInsert({
            draft: corpo.draft as VisionDraft,
            imageUrls: corpo.imageUrls as string[],
            categories: categorieDelServer,
            sellerId: 'negozio-1',
          }),
          has_variants: false,
        };
        dati = { ok: true, product: productSnapshot(riga, categorieDelServer) };
      } else {
        throw new Error(`rotta non prevista: ${url}`);
      }
      return { ok: true, status: 200, json: async () => dati } as unknown as Response;
    }) as typeof fetch;

    const s = accendi(Chat);
    const input = s.radice.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      const file = new File([new Uint8Array([1, 2, 3])], 'olive.jpg', { type: 'image/jpeg' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await aspettaChe(() => testoVisibile(s.radice).includes('Crea nuovo prodotto da queste foto'), 'la foto caricata');
    clicca(Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('Crea nuovo prodotto da queste foto'))!);
    await aspettaChe(() => testoVisibile(s.radice).includes('Crea bozza'), 'la scheda della bozza');
    expect(caratteristiche(s.radice), 'la scheda mostra caratteristiche che non entreranno').toEqual([
      'Peso / Quantità: 300 g',
    ]);

    clicca(Array.from(s.radice.querySelectorAll('button')).find((b) => testoVisibile(b).includes('Crea bozza'))!);
    await aspettaChe(() => testoVisibile(s.radice).includes('Bozza creata'), 'la conferma');
    expect(caratteristiche(s.radice), 'dopo la creazione la scheda mostra ancora la proposta, non la bozza').toEqual([]);
    s.smonta();
  });
});
