/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, type ComponentType } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, clicca } from './aiuti/schermo';
import { buildDraftProductInsert, type VisionDraft } from '@/lib/products/draftFromVision';
import { productSnapshot } from '@/lib/products/aiSnapshot';

/**
 * 15/10/2026 (R36, collaudo) — ALLERGENI E INGREDIENTI LETTI DALLE FOTO
 * ENTRAVANO NELLA BOZZA SENZA CHE IL NEGOZIANTE LI AVESSE VISTI.
 *
 * Due schermate creano bozze dalle foto: la chat Assistenza («Crea nuovo
 * prodotto da queste foto») e «Crea più prodotti dalle foto». Il modello, sulla
 * foto di una focaccia, compila da solo «Allergeni: Glutine» e gli ingredienti.
 * Nella seconda schermata il riepilogo mostrava solo nome e prezzo: la bozza
 * nasceva con le dichiarazioni piene, e un «pubblica» dalla chat o dal Copilot
 * la metteva in vendita — il controllo dei campi obbligatori vedeva valori non
 * vuoti e passava. Nella prima la spunta c'era, ma nessuna prova la teneva
 * accesa: si poteva staccare senza che niente diventasse rosso.
 *
 * Qui le due schermate sono MONTATE davvero. Il negoziante carica la foto,
 * legge il riquadro, spunta o non spunta, preme il pulsante; si guarda cosa
 * parte verso il server. Il server, dall'altra parte, toglie comunque le
 * dichiarazioni senza la spunta (prova gemella nel file
 * dalla-chat-un-alimento-non-va-in-vendita-senza-i-controlli-del-modulo).
 */

type Chiamata = { url: string; corpo: Record<string, unknown> };
type Risposte = Record<string, (corpo: Record<string, unknown>) => unknown>;

const globali = globalThis as Record<string, unknown>;
let chiamate: Chiamata[] = [];
let fetchOriginale: typeof fetch;

/** La rete finta: ogni rotta risponde quello che dice la prova, e si annota cosa ha ricevuto. */
function rete(risposte: Risposte) {
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    chiamate.push({ url, corpo });
    const chi = Object.keys(risposte).find((k) => url.includes(k));
    if (!chi) throw new Error(`rotta non prevista dalla prova: ${url}`);
    const dati = risposte[chi](corpo);
    return { ok: true, status: 200, json: async () => dati } as unknown as Response;
  }) as typeof fetch;
}

/** Il testo come lo legge chi guarda lo schermo: «Allergeni: Glutine», senza a capo. */
const testo = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Aspetta che lo schermo arrivi dove deve: le promesse del componente sono tante. */
async function aspettaChe(condizione: () => boolean, cosa: string) {
  for (let i = 0; i < 60; i++) {
    if (condizione()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  throw new Error(`lo schermo non e arrivato a: ${cosa}`);
}

/** Sceglie dei file nel selettore delle foto, come fa il telefono. */
function scegliFoto(input: HTMLInputElement, quante: number) {
  const files = Array.from(
    { length: quante },
    (_, i) => new File([new Uint8Array([1, 2, 3])], `focaccia-${i}.jpg`, { type: 'image/jpeg' }),
  );
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function pulsante(radice: HTMLElement, etichetta: string): HTMLButtonElement {
  const b = Array.from(radice.querySelectorAll('button')).find((x) => testoVisibile(x).includes(etichetta));
  if (!b) throw new Error(`nessun pulsante «${etichetta}» in: ${testoVisibile(radice)}`);
  return b as HTMLButtonElement;
}

const LETTURA_DELLA_FOCACCIA = {
  name: 'Focaccia genovese',
  description: "Focaccia genovese all'olio, alta e morbida",
  category_id: null,
  subcategory_id: null,
  category_slug: 'alimentari',
  suggested_price: 3.5,
  attributes: {
    allergeni: 'Glutine',
    ingredienti: 'farina, acqua, olio, sale, lievito',
    senza_glutine: 'false',
    peso: '300 g',
  },
  tags: ['focaccia'],
  alt_text: null,
};

beforeAll(() => {
  fetchOriginale = globalThis.fetch;
  // jsdom non scorre: la chat scorre in fondo a ogni messaggio.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  chiamate = [];
  globali.__UTENTE__ = { id: 'forno-1' };
  globali.__GETTONE__ = 'gettone-di-prova';
  globali.__URL_PUBBLICO__ = (percorso: string) =>
    `https://abcdefgh.supabase.co/storage/v1/object/public/products/${percorso}`;
});

afterEach(() => {
  globalThis.fetch = fetchOriginale;
  delete globali.__UTENTE__;
  delete globali.__GETTONE__;
  delete globali.__URL_PUBBLICO__;
  document.body.innerHTML = '';
});

/* ------------------------------------------------------------------------- */
/*  La chat Assistenza                                                        */
/* ------------------------------------------------------------------------- */

describe('la chat Assistenza: la bozza dalle foto porta le dichiarazioni solo con la spunta', () => {
  let Chat: ComponentType<Record<string, unknown>>;
  beforeAll(async () => {
    Chat = (await monta('components/SupportProductAssistant.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  /** Il fornaio allega la foto, chiede la bozza, e arriva alla scheda con il riquadro. */
  async function finoAllaScheda() {
    rete({
      '/api/vision/extract-product': () => LETTURA_DELLA_FOCACCIA,
      '/api/ai/catalog-create': () => ({
        ok: true,
        product: {
          id: 'nuovo-0',
          name: 'Focaccia genovese',
          description: "Focaccia genovese all'olio, alta e morbida",
          price: 3.5,
          status: 'draft',
          categorySlug: 'alimentari',
          attributes: { peso: '300 g' },
          image: 'https://abcdefgh.supabase.co/x.jpg',
          tags: [],
        },
      }),
    });
    const s = accendi(Chat);
    const input = s.radice.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => scegliFoto(input, 1));
    await aspettaChe(
      () => testoVisibile(s.radice).includes('Crea nuovo prodotto da queste foto'),
      'la foto caricata e il pulsante per creare la bozza',
    );
    clicca(pulsante(s.radice, 'Crea nuovo prodotto da queste foto'));
    await aspettaChe(() => !!s.radice.querySelector('[data-riquadro="dichiarazioni"]'), 'il riquadro delle dichiarazioni');
    return s;
  }

  it('il riquadro mostra allergeni e ingredienti letti, in parole leggibili', async () => {
    const s = await finoAllaScheda();
    const riquadro = testo(s.radice.querySelector('[data-riquadro="dichiarazioni"]'));
    expect(riquadro).toContain('Allergeni: Glutine');
    expect(riquadro).toContain('Ingredienti: farina, acqua, olio, sale, lievito');
    // Una casella non spuntata non e una dichiarazione: niente «Senza glutine: false».
    expect(riquadro).not.toContain('false');
    s.smonta();
  });

  it('senza la spunta, verso il server partono la bozza SENZA allergeni e ingredienti', async () => {
    const s = await finoAllaScheda();
    clicca(pulsante(s.radice, 'Crea bozza'));
    await aspettaChe(() => chiamate.some((c) => c.url.includes('/api/ai/catalog-create')), 'la creazione');
    const corpo = chiamate.find((c) => c.url.includes('/api/ai/catalog-create'))!.corpo;
    const bozza = corpo.draft as { attributes: Record<string, string>; dichiarazioni_confermate?: unknown };
    expect(bozza.attributes, 'gli allergeni letti dal modello sono partiti senza che il fornaio li confermasse').not.toHaveProperty('allergeni');
    expect(bozza.attributes).not.toHaveProperty('ingredienti');
    expect(bozza.attributes).toHaveProperty('peso', '300 g');
    expect(bozza.dichiarazioni_confermate).toBe(false);
    // Dopo, il riquadro dice il vero: non sono entrati.
    await aspettaChe(() => testoVisibile(s.radice).includes('Bozza creata'), 'la conferma');
    const riquadro = testo(s.radice.querySelector('[data-riquadro="dichiarazioni"]'));
    expect(riquadro).toContain('NON entrate nella bozza');
    expect(riquadro).toContain('Allergeni, Ingredienti');
    s.smonta();
  });

  it('con la spunta, le dichiarazioni partono e dicono di essere confermate', async () => {
    const s = await finoAllaScheda();
    const spunta = s.radice.querySelector<HTMLInputElement>('[data-riquadro="dichiarazioni"] input[type="checkbox"]')!;
    expect(spunta, 'la spunta «le ho controllate» non c e').toBeTruthy();
    clicca(spunta);
    clicca(pulsante(s.radice, 'Crea bozza'));
    await aspettaChe(() => chiamate.some((c) => c.url.includes('/api/ai/catalog-create')), 'la creazione');
    const corpo = chiamate.find((c) => c.url.includes('/api/ai/catalog-create'))!.corpo;
    const bozza = corpo.draft as { attributes: Record<string, string>; dichiarazioni_confermate?: unknown };
    expect(bozza.attributes).toHaveProperty('allergeni', 'Glutine');
    expect(bozza.attributes).toHaveProperty('ingredienti', 'farina, acqua, olio, sale, lievito');
    expect(bozza.dichiarazioni_confermate).toBe(true);
    s.smonta();
  });
});

describe('la chat Assistenza: dopo la creazione il riquadro dice quello che il server ha salvato', () => {
  let Chat: ComponentType<Record<string, unknown>>;
  beforeAll(async () => {
    Chat = (await monta('components/SupportProductAssistant.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  const CATEGORIE = [{ id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null }];

  /**
   * 16/10/2026 — Il modello scrive le chiavi con la maiuscola. Il server qui
   * e' quello vero: la bozza che arriva passa da `buildDraftProductInsert` e
   * torna come la restituisce la rotta.
   */
  async function creaConChiaviMaiuscole(spunta: boolean) {
    rete({
      '/api/vision/extract-product': () => ({
        ...LETTURA_DELLA_FOCACCIA,
        attributes: {
          Allergeni: 'Glutine, sesamo',
          Ingredienti: 'farina, acqua, olio, sale, lievito, sesamo',
          Peso: '300 g',
        },
      }),
      '/api/ai/catalog-create': (corpo) => {
        const riga = {
          id: 'nuovo-0',
          ...buildDraftProductInsert({
            draft: corpo.draft as VisionDraft,
            imageUrls: corpo.imageUrls as string[],
            categories: CATEGORIE,
            sellerId: 'forno-1',
          }),
          has_variants: false,
        };
        return { ok: true, product: productSnapshot(riga, CATEGORIE) };
      },
    });
    const s = accendi(Chat);
    const input = s.radice.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => scegliFoto(input, 1));
    await aspettaChe(
      () => testoVisibile(s.radice).includes('Crea nuovo prodotto da queste foto'),
      'la foto caricata e il pulsante per creare la bozza',
    );
    clicca(pulsante(s.radice, 'Crea nuovo prodotto da queste foto'));
    await aspettaChe(() => !!s.radice.querySelector('[data-riquadro="dichiarazioni"]'), 'il riquadro delle dichiarazioni');
    if (spunta) clicca(s.radice.querySelector<HTMLInputElement>('[data-riquadro="dichiarazioni"] input[type="checkbox"]')!);
    clicca(pulsante(s.radice, 'Crea bozza'));
    await aspettaChe(() => testoVisibile(s.radice).includes('Bozza creata'), 'la conferma');
    return s;
  }

  it('con la spunta: «Entrate nella bozza», e non dice che mancano', async () => {
    const s = await creaConChiaviMaiuscole(true);
    const riquadro = testo(s.radice.querySelector('[data-riquadro="dichiarazioni"]'));
    expect(riquadro).toContain('Entrate nella bozza');
    expect(riquadro).toContain('Allergeni: Glutine, sesamo');
    expect(riquadro, 'il riquadro dice entrate e insieme che mancano').not.toContain('Manca');
    // E il messaggio del server dopo la creazione dice la stessa cosa.
    expect(testoVisibile(s.radice)).toContain('Vuoi pubblicarla');
    s.smonta();
  });

  it('senza la spunta: «NON entrate», e dice che mancano', async () => {
    const s = await creaConChiaviMaiuscole(false);
    const riquadro = testo(s.radice.querySelector('[data-riquadro="dichiarazioni"]'));
    expect(riquadro).toContain('NON entrate nella bozza');
    expect(riquadro).toContain('Allergeni, Ingredienti');
    s.smonta();
  });
});

describe('la chat Assistenza: la scheda di «pubblica» dice quello che dira il server', () => {
  let Chat: ComponentType<Record<string, unknown>>;
  beforeAll(async () => {
    Chat = (await monta('components/SupportProductAssistant.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  async function proposta(prodotto: Record<string, unknown>, patch: Record<string, unknown>) {
    rete({ '/api/ai/catalog-chat': () => ({ reply: 'Ecco la modifica.', product: prodotto, patch }) });
    const s = accendi(Chat);
    const area = s.radice.querySelector('textarea')!;
    await act(async () => {
      const imposta = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      imposta.call(area, 'pubblica');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    clicca(s.radice.querySelector('button[aria-label="Invia"]')!);
    await aspettaChe(() => testoVisibile(s.radice).includes('Applica'), 'la scheda della proposta');
    return s;
  }

  const BASE = {
    id: 'p1',
    price: 3.5,
    compareAtPrice: null,
    unit: 'pezzo',
    condition: null,
    stock: 1,
    status: 'draft',
    subcategoryName: null,
    categoryName: null,
    tags: [],
    image: 'https://abcdefgh.supabase.co/x.jpg',
    hasVariants: false,
  };

  it('un alimento completo mostra le dichiarazioni con cui va in vetrina', async () => {
    const s = await proposta(
      {
        ...BASE,
        name: 'Focaccia genovese',
        description: "Focaccia genovese all'olio, alta e morbida",
        categorySlug: 'alimentari',
        attributes: { allergeni: 'Glutine, sesamo', ingredienti: 'farina, acqua, olio, sale, lievito, sesamo', senza_glutine: false },
      },
      { status: 'available' },
    );
    const scheda = testo(s.radice);
    expect(scheda).toContain('In vendita con queste dichiarazioni');
    expect(scheda).toContain('Allergeni: Glutine, sesamo');
    expect(scheda).not.toContain('Senza glutine');
    s.smonta();
  });

  it('una proposta che toglie un campo scritto fuori schema non fa cadere la chat', async () => {
    // 16/10/2026 — Il modello scrive `attributes_remove` come oggetto invece
    // che come elenco: la scheda andava in errore mentre si disegnava, e la
    // chat spariva dietro la pagina d'errore del sito.
    const s = await proposta(
      {
        ...BASE,
        name: 'Focaccia genovese',
        description: "Focaccia genovese all'olio, alta e morbida",
        categorySlug: 'alimentari',
        attributes: { allergeni: 'Glutine, sesamo', ingredienti: 'farina, acqua, olio, sale, lievito, sesamo' },
      },
      { status: 'available', attributes_remove: { colore: true } },
    );
    const scheda = testo(s.radice);
    expect(scheda).toContain('Stato → In vendita');
    expect(scheda).toContain('In vendita con queste dichiarazioni');
    expect(scheda).toContain('Allergeni: Glutine, sesamo');
    s.smonta();
  });

  it('la descrizione corretta dalla stessa proposta non viene data per mancante', async () => {
    const s = await proposta(
      {
        ...BASE,
        name: 'Il nome della rosa',
        description: 'Romanzo',
        categorySlug: 'libri',
        attributes: {},
      },
      { description: 'Romanzo di Umberto Eco, edizione tascabile Bompiani', status: 'available' },
    );
    expect(testo(s.radice)).toContain('Stato → In vendita');
    // La frase di cosa manca e' quella del server (`messaggioDaCompletare`).
    expect(testo(s.radice)).not.toContain('non può stare in vendita');
    s.smonta();
  });

  it('una focaccia gia in vendita, finita in Casa, spostata fra gli alimentari: la scheda avvisa prima di Applica, con la frase del server', async () => {
    // 16/10/2026 — La scheda taceva; premuto Applica il server la fermava con
    // «Per metterlo in vendita manca», a chi l'aveva gia' in vendita.
    const s = await proposta(
      {
        ...BASE,
        status: 'available',
        name: 'Focaccia genovese',
        description: "Focaccia genovese all'olio, alta e morbida",
        categorySlug: 'casa',
        attributes: {},
      },
      { category_slug: 'alimentari' },
    );
    const scheda = testo(s.radice);
    expect(scheda).toContain('Categoria → alimentari');
    expect(scheda, 'la scheda non avvisa: il negoziante lo scopre dopo Applica').toContain(
      'Con questa modifica non può stare in vendita, manca: Allergeni, Ingredienti. Prima completa la scheda del prodotto.',
    );
    expect(scheda).not.toContain('metterlo in vendita');
    s.smonta();
  });
});

/* ------------------------------------------------------------------------- */
/*  «Crea più prodotti dalle foto»                                            */
/* ------------------------------------------------------------------------- */

describe('«Crea più prodotti dalle foto»: le dichiarazioni si vedono e partono solo con la spunta', () => {
  let Massiva: ComponentType<Record<string, unknown>>;
  let ImmagineVera: typeof Image;
  let contestoVero: typeof HTMLCanvasElement.prototype.getContext;
  let dataUrlVero: typeof HTMLCanvasElement.prototype.toDataURL;

  beforeAll(async () => {
    Massiva = (await monta('components/seller/BulkPhotoCreate.tsx')).default as ComponentType<Record<string, unknown>>;
  }, 60000);

  beforeEach(() => {
    // jsdom non disegna: la foto si "carica" subito e la tela non ha pixel.
    // Serve solo ad arrivare alla schermata di revisione.
    ImmagineVera = window.Image;
    contestoVero = HTMLCanvasElement.prototype.getContext;
    dataUrlVero = HTMLCanvasElement.prototype.toDataURL;
    class ImmagineFinta {
      width = 800;
      height = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        setTimeout(() => this.onload?.(), 0);
      }
    }
    window.Image = ImmagineFinta as unknown as typeof Image;
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof contestoVero;
    HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,QUJD';
  });

  afterEach(() => {
    window.Image = ImmagineVera;
    HTMLCanvasElement.prototype.getContext = contestoVero;
    HTMLCanvasElement.prototype.toDataURL = dataUrlVero;
  });

  async function finoAllaRevisione() {
    rete({
      '/api/vision/extract-products': () => ({
        products: [
          {
            ...LETTURA_DELLA_FOCACCIA,
            image_indexes: [0, 1],
            category_name: 'Alimentari',
            policy_ok: true,
            policy_reason: null,
          },
        ],
      }),
      '/api/ai/catalog-create-bulk': () => ({
        ok: true,
        count: 1,
        scartati: [],
        products: [
          {
            id: 'nuovo-0',
            name: 'Focaccia genovese',
            description: '',
            price: 3.5,
            status: 'draft',
            categorySlug: 'alimentari',
            attributes: { peso: '300 g' },
            image: null,
            tags: [],
          },
        ],
      }),
    });
    const s = accendi(Massiva);
    const input = s.radice.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => scegliFoto(input, 2));
    await aspettaChe(() => !!s.radice.querySelector('[data-riquadro="dichiarazioni"]'), 'la revisione col riquadro');
    return s;
  }

  it('la riga della focaccia mostra allergeni e ingredienti letti dal modello', async () => {
    const s = await finoAllaRevisione();
    const riquadro = testo(s.radice.querySelector('[data-riquadro="dichiarazioni"]'));
    expect(riquadro).toContain('Allergeni: Glutine');
    expect(riquadro).toContain('Ingredienti: farina, acqua, olio, sale, lievito');
    s.smonta();
  });

  it('senza la spunta, la bozza parte SENZA allergeni e ingredienti', async () => {
    const s = await finoAllaRevisione();
    clicca(pulsante(s.radice, 'Crea'));
    await aspettaChe(() => chiamate.some((c) => c.url.includes('/api/ai/catalog-create-bulk')), 'la creazione');
    const corpo = chiamate.find((c) => c.url.includes('/api/ai/catalog-create-bulk'))!.corpo;
    const voce = (corpo.items as { draft: { attributes: Record<string, string>; dichiarazioni_confermate?: unknown } }[])[0];
    expect(voce.draft.attributes, 'la focaccia parte con allergeni che il fornaio non ha confermato').not.toHaveProperty('allergeni');
    expect(voce.draft.attributes).not.toHaveProperty('ingredienti');
    expect(voce.draft.attributes).toHaveProperty('peso', '300 g');
    expect(voce.draft.dichiarazioni_confermate).toBe(false);
    s.smonta();
  });

  it('con la spunta, partono e dicono di essere confermate', async () => {
    const s = await finoAllaRevisione();
    const spunta = s.radice.querySelector<HTMLInputElement>('[data-riquadro="dichiarazioni"] input[type="checkbox"]')!;
    expect(spunta, 'la spunta «le ho controllate» non c e').toBeTruthy();
    clicca(spunta);
    clicca(pulsante(s.radice, 'Crea'));
    await aspettaChe(() => chiamate.some((c) => c.url.includes('/api/ai/catalog-create-bulk')), 'la creazione');
    const corpo = chiamate.find((c) => c.url.includes('/api/ai/catalog-create-bulk'))!.corpo;
    const voce = (corpo.items as { draft: { attributes: Record<string, string>; dichiarazioni_confermate?: unknown } }[])[0];
    expect(voce.draft.attributes).toHaveProperty('allergeni', 'Glutine');
    expect(voce.draft.dichiarazioni_confermate).toBe(true);
    s.smonta();
  });
});
