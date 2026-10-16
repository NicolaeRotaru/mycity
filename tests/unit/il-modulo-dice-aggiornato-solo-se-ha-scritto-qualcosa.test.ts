/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pianoPatchPerIlModulo, type AiProductPatch, type CategoryRow } from '@/lib/products/aiPatch';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

// Gli avvisi a comparsa: qui si contano, non si disegnano.
const avvisi = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => 'avviso'),
    dismiss: vi.fn(),
  }),
}));
vi.mock('sonner', () => ({ toast: avvisi.toast, Toaster: () => null }));

/**
 * 16/10/2026 — «CAMPI AGGIORNATI NEL FORM» ACCANTO A «ALLERGENI NON COMPILATO».
 *
 * Il titolare del forno apre la Focaccia e scrive nella chat del prodotto
 * «aggiungi gli allergeni: glutine». Il modello propone
 * `attributes: { allergeni: 'glutine' }`. Dal 15/10 (R41) gli allergeni nel
 * modulo non entrano: diventano un avviso giallo col pulsante «Usa questo
 * valore». Ma il modulo restituiva ai suoi chiamanti anche i motivi dello
 * scarto come «campi cambiati», e la chat — che legge «lista non vuota» come
 * «ho aggiornato» — mostrava il verde «Campi aggiornati nel form» e la spunta
 * sul messaggio. Chi si fidava del verde salvava la Focaccia senza allergeni.
 *
 * Queste prove guardano cosa il modulo SCRIVE e cosa DICE di aver scritto: le
 * etichette restituite ai chiamanti devono essere quelle delle scritture vere,
 * e nient'altro.
 */

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
];

const FOCACCIA = {
  prezzoAttuale: 3.5,
  categorie: CATEGORIE,
  categoriaAttuale: 'pane',
  modo: 'edit' as const,
};

describe('il modulo del prodotto dice «aggiornato» solo se ha scritto qualcosa', () => {
  it('«aggiungi gli allergeni: glutine» dalla chat: niente scritto, niente «aggiornato», resta la proposta col pulsante', () => {
    const piano = pianoPatchPerIlModulo({ attributes: { allergeni: 'glutine' } }, FOCACCIA);

    expect(piano.scritture).toEqual([]);
    expect(piano.cambiati).toEqual([]); // la chat non mostra il verde ne' la spunta
    expect(piano.avvisi).toEqual([]); // l'avviso e' uno solo: quello con il pulsante
    expect(piano.proposte).toHaveLength(1);
    expect(piano.proposte[0].chiave).toBe('allergeni');
    expect(piano.proposte[0].valore).toBe('glutine');
    expect(piano.proposte[0].motivo).toContain('Allergeni NON compilato');
  });

  it('lo stesso con la chiave scritta come la scrive il modello («Ingredienti»)', () => {
    const piano = pianoPatchPerIlModulo({ attributes: { Ingredienti: 'farina, acqua, sale' } }, FOCACCIA);
    expect(piano.cambiati).toEqual([]);
    expect(piano.proposte.map((p) => p.chiave)).toEqual(['ingredienti']);
  });

  it('una diagnosi che vuole solo togliere gli ingredienti non scrive e non dice «correzioni applicate»', () => {
    const piano = pianoPatchPerIlModulo({ attributes_remove: ['ingredienti'] }, FOCACCIA);
    expect(piano.scritture).toEqual([]);
    expect(piano.cambiati).toEqual([]);
    expect(piano.avvisi).toHaveLength(1);
    expect(piano.avvisi[0]).toContain('NON tolto');
  });

  it('un patch fatto solo di un prezzo fuori banda non conta come modifica: il motivo esce come avviso', () => {
    const piano = pianoPatchPerIlModulo({ price: 0.35 }, FOCACCIA);
    expect(piano.scritture).toEqual([]);
    expect(piano.cambiati).toEqual([]);
    expect(piano.avvisi).toHaveLength(1);
    expect(piano.avvisi[0]).toContain('prezzo NON applicato');
  });

  it('nome e marca insieme agli allergeni: «aggiornato» elenca solo nome e marca', () => {
    const piano = pianoPatchPerIlModulo(
      { name: 'Focaccia alta', attributes: { allergeni: 'Glutine', marca: 'Pane Quotidiano' } },
      FOCACCIA,
    );
    expect(piano.cambiati).toEqual(['nome', 'Marca']);
    expect(piano.scritture).toContainEqual({ campo: 'name', valore: 'Focaccia alta', etichetta: 'nome' });
    expect(piano.scritture).toContainEqual({
      campo: 'attributo',
      chiave: 'marca',
      valore: 'Pane Quotidiano',
      etichetta: 'Marca',
    });
    expect(piano.scritture.some((s) => s.campo === 'attributo' && s.chiave === 'allergeni')).toBe(false);
    expect(piano.proposte.map((p) => p.chiave)).toEqual(['allergeni']);
  });

  it('su un prodotto che non e un alimento la proposta non ha pulsante e non conta come modifica', () => {
    const piano = pianoPatchPerIlModulo(
      { attributes: { allergeni: 'Glutine' } },
      { ...FOCACCIA, categoriaAttuale: 'casa' },
    );
    expect(piano.cambiati).toEqual([]);
    expect(piano.proposte).toHaveLength(1);
    expect(piano.proposte[0].valore).toBeUndefined();
  });

  it('ogni etichetta restituita corrisponde a una scrittura, anche quando il valore proposto non e valido', () => {
    const patch: AiProductPatch = {
      name: 'Focaccia',
      description: '   ',
      price: 3.6,
      compare_at_price: 0, // non valido: non si scrive, quindi non si dice
      unit: 'quintale', // non e' un'unita' del modulo
      unlimited_stock: true,
      category_slug: 'alimentari',
      subcategory_name: 'Pane e forno',
      tags: ['Forno', 'forno', ' pane,'],
      attributes: { confezione: 'Cassetta', marca: 'Forno', vegano: 'true' },
      status: 'draft',
    };
    const piano = pianoPatchPerIlModulo(patch, FOCACCIA);
    expect(piano.cambiati).toEqual(piano.scritture.map((s) => s.etichetta));
    expect(piano.cambiati).toEqual(['nome', 'prezzo', 'disponibilità', 'categoria', 'tag', 'Marca', 'stato']);
    expect(piano.scritture).toContainEqual({ campo: 'stock', valore: null, etichetta: 'disponibilità' });
    expect(piano.scritture).toContainEqual({ campo: 'tags', valore: ['forno', 'pane'], etichetta: 'tag' });
    expect(piano.proposte.map((p) => [p.chiave, p.valore])).toEqual([['vegano', true]]);
  });

  it('chi crea un prodotto nuovo non cambia lo stato dalla proposta dell\'assistente', () => {
    const piano = pianoPatchPerIlModulo({ status: 'sold' }, { ...FOCACCIA, modo: 'create' });
    expect(piano.cambiati).toEqual([]);
  });
});

/**
 * La stessa scena, col modulo VERO montato: il negoziante apre la chat del
 * prodotto, scrive la richiesta, la risposta dell'assistente arriva. Qui si
 * guarda quello che vede lui — la spunta sul messaggio e l'avviso verde — e
 * quello che finisce nella scheda quando preme Salva.
 */
describe('la chat del prodotto, nel modulo vero', () => {
  let rispostaDellAssistente: { reply: string; patch: AiProductPatch };

  beforeEach(() => {
    for (const f of [avvisi.toast, ...Object.values(avvisi.toast)]) (f as ReturnType<typeof vi.fn>).mockClear?.();
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    // jsdom non sa scorrere: la chat porta in fondo l'ultimo messaggio.
    if (typeof window.HTMLElement.prototype.scrollTo !== 'function') {
      window.HTMLElement.prototype.scrollTo = () => {};
    }
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url) !== '/api/ai/product-chat') throw new Error(`chiamata inattesa: ${url}`);
      return new Response(JSON.stringify(rispostaDellAssistente), { status: 200 });
    });
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
  });

  async function chiediAllaChat(richiesta: string) {
    const mod = await monta('components/seller/ProductForm.tsx');
    const s = accendi(mod.default, {
      mode: 'edit',
      categories: CATEGORIE,
      initialValues: {
        name: 'Focaccia',
        description: 'Focaccia alta, cotta ogni mattina nel nostro forno.',
        price: 3.5,
        unit: 'pezzo',
        stock: 10,
        category_id: 'pane',
        images: ['https://mycity.test/focaccia.jpg'],
        attributes: {},
        tags: ['focaccia'],
        status: 'available',
        variants: [],
      },
      onSubmit: () => {},
      sellerOffersExpress: true,
    });
    const apri = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes("Modifica con l'AI"),
    );
    expect(apri, 'il pulsante della chat non e a video: la prova girerebbe a vuoto').toBeTruthy();
    s.agisci(() => clicca(apri!));

    const casella = s.radice.querySelector('textarea[placeholder^="Es. metti il prezzo"]') as HTMLTextAreaElement;
    expect(casella, 'la casella della chat non e a video').not.toBeNull();
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(casella, richiesta);
      casella.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Invia"]')!));
    for (let i = 0; i < 8; i++) await attendi();

    const testo = (s.radice.textContent ?? '').replace(/\s+/g, ' ');
    expect(testo, 'la risposta dell assistente non e arrivata: la prova girerebbe a vuoto').toContain(
      rispostaDellAssistente.reply,
    );
    return { s, testo };
  }

  it('«aggiungi gli allergeni: glutine»: nessuna spunta verde, nessun «Campi aggiornati», resta l avviso con il pulsante', async () => {
    rispostaDellAssistente = { reply: 'Ecco la proposta.', patch: { attributes: { allergeni: 'glutine' } } };
    const { s, testo } = await chiediAllaChat('aggiungi gli allergeni: glutine');

    expect(testo, 'la chat dice di aver aggiornato il modulo, e non ha scritto niente').not.toContain(
      'Campi aggiornati nel form',
    );
    expect(avvisi.toast.success, 'l avviso verde «aggiornato» compare accanto a «Allergeni NON compilato»').not
      .toHaveBeenCalled();
    const gialli = avvisi.toast.warning.mock.calls;
    expect(gialli).toHaveLength(1);
    expect(String(gialli[0][0])).toContain('Allergeni NON compilato');
    expect(gialli[0][1]?.action?.label).toBe('Usa questo valore');

    // Nella scheda gli allergeni non ci sono finche' il negoziante non preme il pulsante.
    const campoAllergeni = () =>
      Array.from(s.radice.querySelectorAll<HTMLInputElement>('input, textarea')).find((el) =>
        nomeAccessibile(el).startsWith('Allergeni'),
      );
    expect(campoAllergeni(), 'il campo Allergeni non e a video: la prova girerebbe a vuoto').toBeTruthy();
    expect(campoAllergeni()!.value).toBe('');
    s.agisci(() => gialli[0][1].action.onClick());
    expect(campoAllergeni()!.value, 'il pulsante «Usa questo valore» non scrive piu la proposta').toBe('glutine');
    s.smonta();
  });

  it('«metti il prezzo a 0,35» su una focaccia da 3,50: niente «aggiornato», e il motivo dello scarto si legge', async () => {
    rispostaDellAssistente = { reply: 'Prezzo proposto.', patch: { price: 0.35 } };
    const { s, testo } = await chiediAllaChat('metti il prezzo a 0,35');

    expect(testo).not.toContain('Campi aggiornati nel form');
    expect(avvisi.toast.success).not.toHaveBeenCalled();
    const gialli = avvisi.toast.warning.mock.calls.map((c) => String(c[0]));
    expect(gialli).toHaveLength(1);
    expect(gialli[0]).toContain('prezzo NON applicato');
    const prezzo = s.radice.querySelector('input[name="price"]') as HTMLInputElement;
    expect(Number(prezzo.value), 'il prezzo fuori banda e entrato nel campo').toBe(3.5);
    s.smonta();
  });

  it('controprova: quando la chat cambia davvero il nome, la spunta e l avviso verde ci sono', async () => {
    rispostaDellAssistente = { reply: 'Nome sistemato.', patch: { name: 'Focaccia alta' } };
    const { s, testo } = await chiediAllaChat('chiamala focaccia alta');

    expect(testo).toContain('Campi aggiornati nel form');
    expect(avvisi.toast.success).toHaveBeenCalledWith('Campi aggiornati nel form');
    s.smonta();
  });
});
