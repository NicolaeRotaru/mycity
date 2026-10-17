/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  unisciVociDaControllare,
  pianoPatchPerIlModulo,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

/**
 * 16/10/2026 — LE PROPOSTE DELL'ASSISTENTE ERANO AVVISI A TEMPO.
 *
 * Due difetti dello stesso giro, una causa sola: tutto quello che l'assistente
 * proponeva e il modulo non scriveva diventava un avviso a comparsa con il suo
 * orologio.
 *
 *  1. Il negoziante detta (o scansiona il codice a barre di) un pacco di
 *     biscotti: arrivano allergeni, ingredienti, valori nutrizionali, origine e
 *     «vegano». Un avviso da 60 secondi per ognuno, piu' il riassunto. La
 *     libreria degli avvisi ne mostra tre alla volta: gli altri restavano
 *     invisibili, col loro «Usa questo valore», e scadevano senza essere mai
 *     comparsi.
 *  2. «Migliora tutto» propone 0,35 € per una focaccia da 3,50: il prezzo e'
 *     fuori banda e non entra. Il motivo usciva in un avviso da 15 secondi, e in
 *     fondo al pannello restava fissa la frase «C'è una proposta da controllare:
 *     guarda l'avviso» — un avviso che dopo 15 secondi non c'era piu', e nessun
 *     modo di rivederlo.
 *
 * Adesso ogni cosa non scritta e' una riga del riquadro «Da controllare» nel
 * modulo, che resta finche' il negoziante non decide; e il pannello scrive i
 * motivi subito sotto la sua frase.
 */

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

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'dolci', name: 'Dolci e biscotti', slug: 'dolci-e-biscotti', parent_id: 'alim' },
];

const BISCOTTI: AiProductPatch = {
  name: 'Biscotti al burro 350 g',
  attributes: {
    marca: 'Forno Rossi',
    allergeni: 'glutine, latte, uova',
    ingredienti: 'farina di frumento, burro 20%, zucchero, uova',
    valori_nutrizionali: 'Energia 2010 kJ',
    origine: 'Italia',
    vegano: 'false',
  },
};

describe('le righe del riquadro «Da controllare»', () => {
  const ctx = { prezzoAttuale: 3.5, categorie: CATEGORIE, categoriaAttuale: 'dolci', modo: 'edit' as const };

  it('una riga per ogni cosa non scritta: le dichiarazioni col valore, il prezzo senza', () => {
    const piano = pianoPatchPerIlModulo({ ...BISCOTTI, price: 0.35 }, ctx);
    expect(piano.daControllare.map((v) => v.id)).toEqual([
      'prezzo',
      'proposta:allergeni',
      'proposta:ingredienti',
      'proposta:valori_nutrizionali',
      'proposta:origine',
      'proposta:vegano',
    ]);
    expect(piano.daControllare[0].valore).toBeUndefined();
    expect(piano.daControllare[1]).toMatchObject({ chiave: 'allergeni', valore: 'glutine, latte, uova' });
    expect(piano.daControllare[5]).toMatchObject({ chiave: 'vegano', valore: false });
  });

  it('la stessa proposta ripassata prende il posto della vecchia, e un nuovo prezzo scartato quello del vecchio', () => {
    const primo = pianoPatchPerIlModulo({ price: 0.35, attributes: { allergeni: 'glutine' } }, ctx).daControllare;
    const secondo = pianoPatchPerIlModulo({ price: 50, attributes: { allergeni: 'glutine, latte' } }, ctx).daControllare;
    const insieme = unisciVociDaControllare(primo, secondo);
    expect(insieme.map((v) => v.id)).toEqual(['prezzo', 'proposta:allergeni']);
    expect(insieme[0].motivo).toContain('3.50 → 50.00');
    expect(insieme[1].valore).toBe('glutine, latte');
  });
});

describe('nel modulo vero', () => {
  let risposte: Record<string, unknown>;

  beforeEach(() => {
    for (const f of [avvisi.toast, ...Object.values(avvisi.toast)]) (f as ReturnType<typeof vi.fn>).mockClear?.();
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    risposte = {};
    vi.stubGlobal('fetch', async (url: string) => {
      const r = risposte[String(url)];
      if (!r) throw new Error(`chiamata inattesa: ${url}`);
      return new Response(JSON.stringify(r), { status: 200 });
    });
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function apri(prezzo: number, attributi: Record<string, unknown> = {}) {
    const mod = await monta('components/seller/ProductForm.tsx');
    return accendi(mod.default, {
      mode: 'edit',
      categories: CATEGORIE,
      initialValues: {
        name: 'Biscotti',
        description: 'Biscotti di pasta frolla.',
        price: prezzo,
        unit: 'pezzo',
        stock: 10,
        category_id: 'dolci',
        images: ['https://mycity.test/biscotti.jpg'],
        attributes: attributi,
        tags: ['biscotti'],
        status: 'available',
        variants: [],
      },
      onSubmit: () => {},
      sellerOffersExpress: true,
    });
  }
  type Schermo = Awaited<ReturnType<typeof apri>>;

  const pulsanti = (s: Schermo, testo: string, dentro = 'button') =>
    Array.from(s.radice.querySelectorAll<HTMLButtonElement>(dentro)).filter(
      (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === testo,
    );
  const riquadro = (s: Schermo) =>
    Array.from(s.radice.querySelectorAll('section')).find((x) => nomeAccessibile(x) === 'Da controllare') ??
    Array.from(s.radice.querySelectorAll('section')).find((x) =>
      (x.querySelector('h2')?.textContent ?? '').includes('Da controllare'),
    );
  const campo = (s: Schermo, nome: string) =>
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input, textarea')).find((el) =>
      nomeAccessibile(el).startsWith(nome),
    );

  it('la dettatura porta cinque dichiarazioni: tutte e cinque restano a video, ognuna col suo pulsante, anche dopo minuti', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    risposte['/api/ai/voice-product'] = { reply: 'Ok', patch: BISCOTTI };
    const s = await apri(3.5);
    const casella = s.radice.querySelector('textarea[placeholder^="Es. tre magliette"]') as HTMLTextAreaElement;
    expect(casella, 'la casella della dettatura non e a video: la prova girerebbe a vuoto').not.toBeNull();
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(
        casella,
        'biscotti al burro forno rossi, glutine latte uova, fatti in italia',
      );
      casella.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Crea dalla descrizione"]')!));
    for (let i = 0; i < 8; i++) await attendi();
    expect(campo(s, 'Nome prodotto')?.value, 'la dettatura non e arrivata al modulo').toBe('Biscotti al burro 350 g');

    // Nessuna proposta e' affidata a un avviso a tempo.
    const gialli = avvisi.toast.warning.mock.calls.map((c) => String(c[0]));
    expect(gialli.filter((t) => t.includes('NON compilato')), 'le proposte sono ancora avvisi a tempo').toEqual([]);

    // Passano due minuti: le righe sono ancora li'.
    s.agisci(() => vi.advanceTimersByTime(120_000));
    const box = riquadro(s);
    expect(box, 'il riquadro «Da controllare» non c e').toBeTruthy();
    const righe = Array.from(box!.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(righe, 'una proposta e sparita senza essere mai vista').toHaveLength(5);
    for (const nome of ['Allergeni', 'Ingredienti', 'Valori nutrizionali', 'Origine', 'Vegano']) {
      expect(righe.some((r) => r.startsWith(`${nome}`)), `manca la riga di ${nome}`).toBe(true);
    }
    expect(pulsanti(s, 'Usa questo valore', 'section button'), 'qualche riga e senza pulsante').toHaveLength(5);

    // Il negoziante le usa una per una: ognuna scrive il suo campo e lascia il posto alle altre.
    s.agisci(() => clicca(pulsanti(s, 'Usa questo valore', 'section button')[0]));
    expect(campo(s, 'Allergeni')!.value).toBe('glutine, latte, uova');
    expect(campo(s, 'Ingredienti')!.value, 'un pulsante ha scritto anche il campo accanto').toBe('');
    s.agisci(() => clicca(pulsanti(s, 'Usa questo valore', 'section button')[0]));
    expect(campo(s, 'Ingredienti')!.value).toBe('farina di frumento, burro 20%, zucchero, uova');
    expect(pulsanti(s, 'Usa questo valore', 'section button')).toHaveLength(3);
    s.smonta();
  });

  it('«Migliora tutto» propone 0,35 € per 3,50 €: il pannello scrive il motivo sotto la frase, e non rimanda a un avviso', async () => {
    risposte['/api/ai/improve-product'] = {
      summary: 'Ho guardato la scheda.',
      quality: { before: 50, after: 60, dimensions: [], missing: [] },
      pricing: { suggested: 0.35, netToSeller: 0.3, rationale: '' },
      fieldNotes: [],
      patch: { price: 0.35 },
    };
    const s = await apri(3.5);
    s.agisci(() => clicca(pulsanti(s, "Migliora tutto con l'AI")[0]));
    for (let i = 0; i < 8; i++) await attendi();
    expect(pulsanti(s, 'Applica tutto'), 'il pulsante «Applica tutto» non e a video').toHaveLength(1);
    s.agisci(() => clicca(pulsanti(s, 'Applica tutto')[0]));
    for (let i = 0; i < 4; i++) await attendi();

    const pannello = (s.radice.textContent ?? '').replace(/\s+/g, ' ');
    expect(Number((s.radice.querySelector('input[name="price"]') as HTMLInputElement).value)).toBe(3.5);
    expect(pannello, 'la frase fissa rimanda ancora a un avviso a tempo').not.toMatch(/guarda (l'avviso|gli avvisi)/);
    // Il pie' del pannello: la frase e, subito sotto, il motivo per esteso.
    const piede = Array.from(s.radice.querySelectorAll('span')).find((x) =>
      (x.textContent ?? '').includes("C'è una proposta da controllare"),
    );
    expect(piede, 'la frase in fondo al pannello non c e').toBeTruthy();
    expect(piede!.textContent).toContain('qui sotto');
    const sottoLaFrase = piede!.parentElement!.textContent ?? '';
    expect(sottoLaFrase).toContain('prezzo NON applicato (3.50 → 0.35 €: oltre il 30%, va deciso a mano)');

    // E nel riquadro del modulo la stessa cosa resta finche' il negoziante non dice «Ho capito».
    const box = riquadro(s);
    expect(box?.textContent).toContain('prezzo NON applicato');
    s.agisci(() => clicca(pulsanti(s, 'Ho capito', 'section button')[0]));
    expect(riquadro(s), 'il riquadro resta dopo «Ho capito»').toBeUndefined();
    // Il pannello continua a dire quello che e' successo: il motivo e' ancora scritto li'.
    expect(piede!.parentElement!.textContent ?? '').toContain('prezzo NON applicato');
    s.smonta();
  });
});
