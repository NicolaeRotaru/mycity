/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 16/10/2026 (giro di correzione) — LE PAROLE DELL'ASSISTENTE NON FANNO DA
 * CONFERMA.
 *
 * Due casi, la stessa radice: il modello dice «Fatto! Ho aggiunto gli
 * allergeni» e nella scheda gli allergeni non ci sono.
 *
 *  1. La dettatura. Il modello disubbidisce e mette gli allergeni nella
 *     proposta: il modulo li lascia fuori (una riga in «Da controllare»), ma il
 *     riquadro della dettatura restava verde e si chiudeva con quelle parole.
 *     La chat del prodotto, nello stesso caso, le nasconde.
 *  2. Un prodotto senza categoria (la dettatura su «Nuovo prodotto»), o con una
 *     categoria proposta che non esiste. La scheda «non aveva campi», e gli
 *     allergeni proposti sparivano in silenzio: nessuna riga «NON compilato»,
 *     e la chat rimetteva in bolla «Fatto! Ho aggiunto gli allergeni» con la
 *     spunta verde.
 *
 * Nessuna lettura delle parole del modello: si decide da quello che il modulo
 * ha scritto e lasciato fuori. Qui girano le funzioni vere, il modulo vero e la
 * rotta vera della dettatura; il modello e' finto.
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
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'forno-1' }, req }),
}));
const runMessageMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: vi.fn(async () => undefined) };
});

import {
  esitoDelPiano,
  messaggioDellaChatDopoIlPatch,
  pianoPatchPerIlModulo,
  resolveAiPatch,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
import { avvisoDopoLaDettatura } from '@/lib/products/avvisoDellaDettatura';
import { righeDellaProposta } from '@/lib/products/prontoPerLaVendita';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { POST as dettatura } from '@/app/api/ai/voice-product/route';
import { monta, nomeAccessibile, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
];

const FALSA = 'Fatto! Ho aggiunto gli allergeni: glutine e sesamo.';
const DETTATO = 'focaccia genovese tre euro e cinquanta allergeni glutine e sesamo';
/** Il modello che disubbidisce: nome, prezzo e gli allergeni nella proposta. */
const DISUBBIDIENTE: AiProductPatch = {
  name: 'Focaccia genovese',
  price: 3.5,
  attributes: { allergeni: 'glutine, sesamo' },
};

const piano = (patch: AiProductPatch, categoriaAttuale: string | null, prezzoAttuale: number | null = 3.5) =>
  pianoPatchPerIlModulo(patch, { prezzoAttuale, categorie: CATEGORIE, categoriaAttuale, modo: categoriaAttuale ? 'edit' : 'create' });

describe('la dettatura segue la regola della chat: se il modulo ha lasciato fuori qualcosa, le parole del modello non si mostrano', () => {
  it('la focaccia: allergeni proposti e lasciati fuori → niente «Fatto!», e il riquadro non e verde', () => {
    const esito = esitoDelPiano(piano(DISUBBIDIENTE, 'pane'));
    expect(esito.cambiati).toEqual(['nome', 'prezzo']);
    expect(esito.inSospeso).toBe(1);
    const avviso = avvisoDopoLaDettatura({ esito, dettato: DETTATO, risposta: FALSA });
    expect(avviso.risposta, 'la dettatura mostra le parole che la chat nasconde').toBeNull();
    expect(JSON.stringify(avviso)).not.toContain('Fatto!');
    expect(avviso.tono, 'il riquadro resta verde con una proposta lasciata fuori').toBe('da-controllare');
    // La chat, nello stesso caso: le stesse parole nascoste.
    const chat = messaggioDellaChatDopoIlPatch(FALSA, esito);
    expect(chat.testo).not.toContain('Fatto!');
  });

  it('il modello ubbidisce ma dice di aver scritto: le parole restano sue, dopo la frase fissa, e senza il verde', () => {
    const esito = esitoDelPiano(piano({ name: 'Focaccia genovese', price: 3.5 }, 'pane'));
    expect(esito.inSospeso).toBe(0);
    const avviso = avvisoDopoLaDettatura({ esito, dettato: DETTATO, risposta: FALSA });
    expect(avviso.risposta).toBe(`L'assistente dice: «${FALSA}»`);
    expect(avviso.dichiarazioni).toContain("non li scrive l'assistente");
    expect(avviso.tono, 'sotto la frase fissa il riquadro e verde').toBe('da-controllare');
  });

  it('controprova: il vaso, senza dichiarazioni e senza niente lasciato fuori, resta verde con le parole dell assistente', () => {
    const esito = esitoDelPiano(piano({ name: 'Vaso blu', price: 20 }, 'casa', 20));
    const avviso = avvisoDopoLaDettatura({ esito, dettato: 'vaso blu venti euro', risposta: 'Ho preso nome e prezzo.' });
    expect(avviso.tono).toBe('successo');
    expect(avviso.dichiarazioni).toBeNull();
    expect(avviso.risposta).toBe("L'assistente dice: «Ho preso nome e prezzo.»");
  });
});

describe('una scheda senza categoria non e una scheda senza allergeni', () => {
  // Nessuna categoria; uno slug che non esiste; lo slug di una sottocategoria
  // vera (si risolvono solo quelle di primo livello).
  const casi: [string, AiProductPatch][] = [
    ['senza categoria', DISUBBIDIENTE],
    ['slug inesistente «panetteria»', { ...DISUBBIDIENTE, category_slug: 'panetteria' }],
    ['slug di una sottocategoria «pane»', { ...DISUBBIDIENTE, category_slug: 'pane' }],
  ];

  for (const [nome, patch] of casi) {
    it(`${nome}: la proposta degli allergeni resta una riga «NON compilato», senza pulsante`, () => {
      const p = piano(patch, null, null);
      expect(p.cambiati).toEqual(['nome', 'prezzo']);
      expect(p.daControllare, 'gli allergeni proposti sono spariti in silenzio').toEqual([
        {
          id: 'proposta:allergeni',
          motivo: "Allergeni NON compilato dall'assistente: lo scrivi tu nella scheda (proposta: «glutine, sesamo»)",
        },
      ]);
      // La chat: niente «Fatto!» e niente «aggiornato» senza dire cosa e' rimasto fuori.
      const chat = messaggioDellaChatDopoIlPatch(FALSA, esitoDelPiano(p));
      expect(chat.testo).toBe('Campi cambiati nella scheda: nome, prezzo. Il resto della proposta NON è stato scritto.');
      expect(chat.nonScritto).toHaveLength(1);
      // La dettatura: niente parole del modello.
      const avviso = avvisoDopoLaDettatura({ esito: esitoDelPiano(p), dettato: DETTATO, risposta: FALSA });
      expect(avviso.risposta).toBeNull();
      // Il server dice la stessa cosa.
      const r = resolveAiPatch({
        patch,
        current: { attributes: null, category_id: null, has_variants: false, price: null },
        categories: CATEGORIE,
      });
      expect(r.protetti).toEqual(['Allergeni']);
      expect(r.update).not.toHaveProperty('attributes');
    });
  }

  it('chat Assistenza, prodotto senza categoria: la scheda della proposta rimanda alla scheda, come il server', () => {
    const righe = righeDellaProposta({ attributes: { allergeni: 'Glutine' } }, { price: 3.5, categorySlug: null });
    expect(righe).toEqual(['Allergeni → «Glutine»: NON si applica, lo scrivi tu nella scheda del prodotto']);
    // Controprova: Casa il campo non ce l'ha, e la scheda lo dice.
    expect(righeDellaProposta({ attributes: { allergeni: 'Glutine' } }, { price: 20, categorySlug: 'casa' })).toEqual([
      'Allergeni → «Glutine»: NON si applica, e la scheda di questo prodotto non ha il campo Allergeni',
    ]);
  });

  it('controprova: una categoria che si conosce e non ha il campo (Casa) lo lascia fuori senza dire niente, come prima', () => {
    const p = piano({ name: 'Vaso blu', attributes: { allergeni: 'glutine' } }, 'casa', 20);
    expect(p.daControllare).toEqual([]);
    expect(p.cambiati).toEqual(['nome']);
  });
});

/* ------------------------------------------------------------------------- */
/*  Il modulo vero, con la rotta vera della dettatura                         */
/* ------------------------------------------------------------------------- */

describe('nel modulo vero, dopo la dettatura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (String(url) !== '/api/ai/voice-product') throw new Error(`chiamata inattesa: ${url}`);
      return dettatura(
        new Request('http://localhost/api/ai/voice-product', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: init?.body as string,
        }) as never,
      );
    });
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
  });

  async function detta(testo: string, prodotto: { categoria: string; attributi: Record<string, unknown> } | null) {
    const mod = await monta('components/seller/ProductForm.tsx');
    const s = accendi(mod.default, {
      // I pulsanti AI, come il giorno in cui si riaccendono (al lancio sono spenti).
      aiAccesa: true,
      mode: prodotto ? 'edit' : 'create',
      categories: CATEGORIE,
      initialValues: prodotto
        ? {
            name: 'Focaccia',
            description: 'Una descrizione lunga abbastanza per la scheda.',
            price: 3.5,
            unit: 'pezzo',
            stock: 10,
            category_id: prodotto.categoria,
            images: ['https://mycity.test/foto.jpg'],
            attributes: prodotto.attributi,
            tags: [],
            status: 'available',
            variants: [],
          }
        : undefined,
      onSubmit: () => {},
      sellerOffersExpress: true,
    });
    const casella = s.radice.querySelector('textarea[placeholder^="Es. tre magliette"]') as HTMLTextAreaElement;
    expect(casella, 'la casella della dettatura non e a video').not.toBeNull();
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(casella, testo);
      casella.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Crea dalla descrizione"]')!));
    for (let i = 0; i < 12; i++) await attendi();
    expect(runMessageMock, 'la rotta non ha chiamato il modello: la prova girerebbe a vuoto').toHaveBeenCalledTimes(1);
    return s;
  }

  const riquadro = (s: ReturnType<typeof accendi>) => s.radice.querySelector('[data-avviso="dettatura"] > div');
  const daControllare = (s: ReturnType<typeof accendi>) =>
    testoVisibile(
      Array.from(s.radice.querySelectorAll('section')).find((x) => testoVisibile(x).startsWith('Da controllare')) ??
        null,
    );
  const campo = (s: ReturnType<typeof accendi>, nome: string) =>
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input, textarea')).find((el) =>
      nomeAccessibile(el).startsWith(nome),
    );

  it('la focaccia, il modello disubbidisce e dice «Fatto!»: il riquadro non lo mostra e non e verde', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { reply: FALSA, patch: DISUBBIDIENTE } });
    const s = await detta(DETTATO, { categoria: 'pane', attributi: { allergeni: 'glutine' } });
    expect(campo(s, 'Allergeni')?.value, 'la macchina ha scritto gli allergeni').toBe('glutine');
    const testo = testoVisibile(riquadro(s));
    expect(testo, 'la prova non e arrivata al riquadro').toContain(`Hai detto: «${DETTATO}»`);
    expect(testo, 'il riquadro si chiude con le parole del modello').not.toContain('Fatto!');
    expect(riquadro(s)?.className, 'il riquadro e verde').not.toContain('emerald');
    expect(daControllare(s)).toContain('Allergeni NON compilato');
    s.smonta();
  });

  it('un prodotto nuovo, senza categoria: gli allergeni detti restano una riga «Da controllare», e niente «Fatto!»', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { reply: FALSA, patch: DISUBBIDIENTE } });
    const s = await detta(DETTATO, null);
    expect(campo(s, 'Nome prodotto')?.value, 'la dettatura non e arrivata al modulo').toBe('Focaccia genovese');
    expect(daControllare(s), 'gli allergeni detti sono spariti in silenzio').toContain(
      "Allergeni NON compilato dall'assistente: lo scrivi tu nella scheda (proposta: «glutine, sesamo»)",
    );
    expect(testoVisibile(riquadro(s))).not.toContain('Fatto!');
    s.smonta();
  });
});
