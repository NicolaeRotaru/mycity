/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 16/10/2026 — GLI ALLERGENI DETTATI A VOCE SPARIVANO SENZA UNA PAROLA.
 *
 * Il fornaio apre la Focaccia, che ha gia' gli allergeni «glutine». Preme il
 * microfono e detta: «focaccia genovese tre euro e cinquanta allergeni glutine
 * e sesamo». La rotta della dettatura dice al modello che allergeni e
 * ingredienti non li compila lui («se mancano, dillo al venditore»): un modello
 * che ubbidisce nomina gli allergeni solo nella risposta. Il pulsante della
 * voce la risposta la buttava via, e l'avviso verde diceva soltanto «Compilato
 * dalla tua descrizione». Il campo restava «glutine», e il sesamo detto a voce
 * non compariva da nessuna parte.
 *
 * Adesso, dopo la dettatura, il negoziante vede sempre cosa e' successo, la
 * frase che ha detto e la risposta dell'assistente; e se la scheda ha
 * dichiarazioni, una frase fissa: quelle le scrive lui. Nessuna lettura delle
 * parole dettate. L'avviso resta finche' lui non lo chiude.
 *
 * Qui girano il modulo vero e la rotta vera della dettatura; il modello e'
 * finto e fa quello che il prompt gli chiede: niente allergeni nella proposta.
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

const FAKE_USER = { id: 'forno-1', email: 'forno@x.it' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: vi.fn(async () => undefined) };
});

import {
  REGOLA_CAMPI_DICHIARATIVI,
  esitoDelPiano,
  pianoPatchPerIlModulo,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
import { avvisoDopoLaDettatura, fraseSulleDichiarazioni } from '@/lib/products/avvisoDellaDettatura';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { POST as dettatura } from '@/app/api/ai/voice-product/route';
import { monta, nomeAccessibile, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  { id: 'bell', name: 'Bellezza', slug: 'bellezza', parent_id: null },
];

const DETTATO = 'focaccia genovese tre euro e cinquanta allergeni glutine e sesamo';
const RISPOSTA = 'Ho preso nome e prezzo. Gli allergeni (glutine e sesamo) li scrivi tu nella scheda.';
/** Il modello che fa quello che il prompt gli chiede: nome e prezzo, gli allergeni no. */
const UBBIDIENTE: AiProductPatch = { name: 'Focaccia genovese', price: 3.5 };

const FRASE_ALIMENTI =
  "Allergeni, ingredienti e le altre dichiarazioni non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.";

describe('la frase fissa nomina i campi che la scheda ha davvero', () => {
  it('un alimento: allergeni e ingredienti prima di tutto', () => {
    const piano = pianoPatchPerIlModulo(UBBIDIENTE, {
      prezzoAttuale: 3.5,
      categorie: CATEGORIE,
      categoriaAttuale: 'pane',
      modo: 'edit',
    });
    expect(piano.dichiarazioniDellaCategoria.slice(0, 2)).toEqual(['Allergeni', 'Ingredienti']);
    expect(fraseSulleDichiarazioni(piano.dichiarazioniDellaCategoria)).toBe(FRASE_ALIMENTI);
  });

  it('una crema: la scheda di Bellezza ha «Vegano» e «Scadenza», non gli allergeni', () => {
    const piano = pianoPatchPerIlModulo({}, { prezzoAttuale: 9, categorie: CATEGORIE, categoriaAttuale: 'bell', modo: 'edit' });
    expect(piano.dichiarazioniDellaCategoria).toEqual(['Vegano', 'Scadenza']);
    expect(fraseSulleDichiarazioni(piano.dichiarazioniDellaCategoria)).toBe(
      "Vegano e scadenza non li scrive l'assistente: se li hai detti, scrivili tu nella scheda prima di salvare.",
    );
  });

  it('un vaso: nessuna dichiarazione, nessuna frase', () => {
    const piano = pianoPatchPerIlModulo({}, { prezzoAttuale: 20, categorie: CATEGORIE, categoriaAttuale: 'casa', modo: 'edit' });
    expect(piano.dichiarazioniDellaCategoria).toEqual([]);
    expect(fraseSulleDichiarazioni(piano.dichiarazioniDellaCategoria)).toBeNull();
  });

  it('conta la categoria DOPO il suggerimento: un prodotto nuovo che il modello mette fra gli alimentari', () => {
    const nuovo = pianoPatchPerIlModulo(
      { ...UBBIDIENTE, category_slug: 'alimentari' },
      { prezzoAttuale: null, categorie: CATEGORIE, categoriaAttuale: null, modo: 'create' },
    );
    expect(nuovo.dichiarazioniDellaCategoria[0]).toBe('Allergeni');
    // E uno slug che non e' una categoria di primo livello non sposta niente.
    const fermo = pianoPatchPerIlModulo(
      { category_slug: 'pane-e-forno' },
      { prezzoAttuale: 20, categorie: CATEGORIE, categoriaAttuale: 'casa', modo: 'edit' },
    );
    expect(fermo.dichiarazioniDellaCategoria).toEqual([]);
  });

  it('l avviso: esito, frase fissa, dettato e risposta; senza risposta, niente riga vuota', () => {
    const esito = esitoDelPiano(
      pianoPatchPerIlModulo(UBBIDIENTE, { prezzoAttuale: 3.5, categorie: CATEGORIE, categoriaAttuale: 'pane', modo: 'edit' }),
    );
    // Giro di correzione: sotto la frase fissa il riquadro non e' verde.
    expect(avvisoDopoLaDettatura({ esito, dettato: `  ${DETTATO} `, risposta: RISPOSTA })).toEqual({
      tono: 'da-controllare',
      esito: 'Compilato dalla tua descrizione — controlla e salva',
      dichiarazioni: FRASE_ALIMENTI,
      dettato: `Hai detto: «${DETTATO}»`,
      risposta: `L'assistente dice: «${RISPOSTA}»`,
    });
    expect(avvisoDopoLaDettatura({ esito, dettato: DETTATO, risposta: '   ' }).risposta).toBeNull();
    expect(avvisoDopoLaDettatura({ esito, dettato: DETTATO, risposta: { testo: 'x' } }).risposta).toBeNull();
  });

  it('una proposta vuota su un alimento: dice cosa e successo nella scheda, senza «riprova»', () => {
    // Chi detta solo gli allergeni riceve sempre una proposta vuota: riprovare
    // non cambia niente, e ogni tentativo e' una chiamata al modello pagata.
    const esito = esitoDelPiano(
      pianoPatchPerIlModulo({}, { prezzoAttuale: 3.5, categorie: CATEGORIE, categoriaAttuale: 'pane', modo: 'edit' }),
    );
    const a = avvisoDopoLaDettatura({ esito, dettato: 'aggiungi la frutta secca agli allergeni', risposta: '' });
    expect(a.tono).toBe('neutro');
    expect(a.esito).toBe('Nella scheda non ho scritto niente');
    expect(a.dichiarazioni).toBe(FRASE_ALIMENTI);
    expect(JSON.stringify(a)).not.toMatch(/riprova/i);
  });
});

describe('nel modulo vero, con la rotta vera della dettatura', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    // Il pulsante della voce chiama la rotta: qui la chiama davvero.
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
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  type Prodotto = { categoria: string; nome: string; prezzo: number; attributi: Record<string, unknown> };
  const FOCACCIA: Prodotto = { categoria: 'pane', nome: 'Focaccia', prezzo: 3.5, attributi: { allergeni: 'glutine' } };
  const VASO: Prodotto = { categoria: 'casa', nome: 'Vaso', prezzo: 20, attributi: { materiale: 'Ceramica' } };

  async function apriIlModulo(prodotto: Prodotto | null) {
    const mod = await monta('components/seller/ProductForm.tsx');
    return accendi(mod.default, {
      mode: prodotto ? 'edit' : 'create',
      categories: CATEGORIE,
      initialValues: prodotto
        ? {
            name: prodotto.nome,
            description: 'Una descrizione lunga abbastanza per la scheda.',
            price: prodotto.prezzo,
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
  }

  async function detta(testo: string, prodotto: Prodotto | null) {
    const s = await apriIlModulo(prodotto);
    // In jsdom il riconoscimento vocale non c'e': il pulsante ripiega sulla casella di testo, stessa rotta.
    const casella = s.radice.querySelector('textarea[placeholder^="Es. tre magliette"]') as HTMLTextAreaElement;
    expect(casella, 'la casella della dettatura non e a video: la prova girerebbe a vuoto').not.toBeNull();
    s.agisci(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(casella, testo);
      casella.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    s.agisci(() => clicca(s.radice.querySelector('button[aria-label="Crea dalla descrizione"]')!));
    for (let i = 0; i < 12; i++) await attendi();
    expect(runMessageMock, 'la rotta non ha chiamato il modello: la prova girerebbe a vuoto').toHaveBeenCalledTimes(1);
    return s;
  }

  /**
   * La strada vera su Chrome e Android: il microfono. Il riconoscimento vocale e'
   * finto (in jsdom non c'e'); la frase arriva come la passa il browser.
   */
  async function dettaAlMicrofono(testo: string, prodotto: Prodotto) {
    type Risultato = { results: { transcript: string }[][] };
    let ascolto: { onresult: ((e: Risultato) => void) | null } | null = null;
    class FintoRiconoscimento {
      lang = '';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onresult: ((e: Risultato) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        ascolto = this;
      }
      stop() {}
    }
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FintoRiconoscimento;
    const s = await apriIlModulo(prodotto);
    expect(s.radice.querySelector('textarea[placeholder^="Es. tre magliette"]'), 'e la casella, non il microfono').toBeNull();
    const microfono = Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Detta il prodotto a voce'),
    );
    expect(microfono, 'il pulsante del microfono non e a video').toBeTruthy();
    s.agisci(() => clicca(microfono!));
    expect(ascolto, 'il microfono non e partito').not.toBeNull();
    s.agisci(() => ascolto!.onresult!({ results: [[{ transcript: testo }]] }));
    for (let i = 0; i < 12; i++) await attendi();
    expect(runMessageMock, 'la rotta non ha chiamato il modello: la prova girerebbe a vuoto').toHaveBeenCalledTimes(1);
    return s;
  }

  const campo = (s: ReturnType<typeof accendi>, nome: string) =>
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input, textarea')).find((el) =>
      nomeAccessibile(el).startsWith(nome),
    );
  const avviso = (s: ReturnType<typeof accendi>) =>
    testoVisibile(s.radice.querySelector('[data-avviso="dettatura"]'));
  const ilModelloRisponde = (patch: AiProductPatch, reply = RISPOSTA) =>
    runMessageMock.mockResolvedValue({ toolInput: { reply, patch } });

  it('la focaccia: il modello ubbidisce e lascia fuori il sesamo, e il negoziante vede la frase fissa, il dettato e la risposta', async () => {
    // L'orologio e' finto da prima della dettatura: un avviso a tempo partito
    // dopo la risposta scadrebbe quando qui sotto si mandano avanti i minuti.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    ilModelloRisponde(UBBIDIENTE);
    const s = await detta(DETTATO, FOCACCIA);

    // Il modello finto ha ricevuto la regola vera e il dettato vero.
    const chiamata = runMessageMock.mock.calls[0][0] as { system: string; messages: { content: string }[] };
    expect(chiamata.system).toContain(REGOLA_CAMPI_DICHIARATIVI);
    expect(chiamata.messages[0].content).toContain(DETTATO);
    expect(campo(s, 'Nome prodotto')?.value, 'la dettatura non e arrivata al modulo').toBe('Focaccia genovese');

    const testo = avviso(s);
    expect(testo).toContain('Compilato dalla tua descrizione — controlla e salva');
    expect(testo, 'l avviso dice solo «Compilato»: gli allergeni detti spariscono senza una parola').toContain(
      FRASE_ALIMENTI,
    );
    expect(testo, 'il negoziante non ritrova quello che ha detto').toContain(`Hai detto: «${DETTATO}»`);
    expect(testo, 'la risposta dell assistente e stata buttata via').toContain(`L'assistente dice: «${RISPOSTA}»`);
    // La frase fissa viene prima di tutto, anche delle parole dell'assistente.
    expect(testo.indexOf(FRASE_ALIMENTI)).toBeLessThan(testo.indexOf('Compilato dalla tua descrizione'));
    expect(testo.indexOf(FRASE_ALIMENTI)).toBeLessThan(testo.indexOf("L'assistente dice"));

    // La macchina non scrive mai la dichiarazione: il campo resta com'era.
    expect(campo(s, 'Allergeni')?.value).toBe('glutine');

    // Non e' un avviso a tempo: passano cinque minuti ed e' ancora li'.
    s.agisci(() => vi.advanceTimersByTime(5 * 60_000));
    expect(avviso(s), 'l avviso e sparito prima che il negoziante lo chiudesse').toContain(FRASE_ALIMENTI);
    expect(avvisi.toast.success, 'la dettatura e tornata a un avviso a tempo').not.toHaveBeenCalled();

    // Lo chiude lui.
    const hoLetto = Array.from(s.radice.querySelectorAll('button')).find((b) => b.textContent === 'Ho letto');
    expect(hoLetto, 'non c e modo di chiudere l avviso').toBeTruthy();
    s.agisci(() => clicca(hoLetto!));
    expect(avviso(s)).toBe('');
    s.smonta();
  });

  it('il vaso: la scheda di Casa non ha dichiarazioni, la frase fissa non compare; dettato e risposta si', async () => {
    ilModelloRisponde({ name: 'Vaso in ceramica bianca', price: 22 }, 'Ho preso nome e prezzo.');
    const s = await detta('vaso in ceramica bianca ventidue euro', VASO);
    const testo = avviso(s);
    expect(testo).toContain('Compilato dalla tua descrizione — controlla e salva');
    expect(testo).not.toContain("non li scrive l'assistente");
    expect(testo).toContain('Hai detto: «vaso in ceramica bianca ventidue euro»');
    expect(testo).toContain("L'assistente dice: «Ho preso nome e prezzo.»");
    s.smonta();
  });

  it('un prodotto nuovo, senza categoria: il modello lo mette fra gli alimentari e la frase fissa c e', async () => {
    ilModelloRisponde({ ...UBBIDIENTE, category_slug: 'alimentari' });
    const s = await detta(DETTATO, null);
    expect(avviso(s)).toContain(FRASE_ALIMENTI);
    expect(campo(s, 'Allergeni')?.value, 'la macchina ha scritto gli allergeni').toBe('');
    s.smonta();
  });

  it('il modello disubbidisce e mette gli allergeni nella proposta: restano una proposta, e la frase fissa c e lo stesso', async () => {
    ilModelloRisponde({ ...UBBIDIENTE, attributes: { allergeni: 'glutine, sesamo' } }, 'Ok');
    const s = await detta(DETTATO, FOCACCIA);
    expect(campo(s, 'Allergeni')?.value, 'la macchina ha scritto gli allergeni da sola').toBe('glutine');
    const testo = avviso(s);
    expect(testo).toContain("C'è anche una proposta da controllare: la trovi nel riquadro «Da controllare»");
    expect(testo).toContain(FRASE_ALIMENTI);
    s.smonta();
  });

  it('il modello dice «ho aggiunto gli allergeni» e non sono entrati: la frase fissa viene prima, e le sue parole sono riportate come sue', async () => {
    const FALSA = 'Fatto! Ho aggiunto gli allergeni: glutine e sesamo.';
    ilModelloRisponde(UBBIDIENTE, FALSA);
    const s = await detta(DETTATO, FOCACCIA);
    const testo = avviso(s);
    expect(campo(s, 'Allergeni')?.value).toBe('glutine');
    expect(testo, 'le parole del modello sono presentate come una conferma').not.toContain(
      `Risposta dell'assistente: «${FALSA}»`,
    );
    expect(testo).toContain(`L'assistente dice: «${FALSA}»`);
    expect(testo.indexOf(FRASE_ALIMENTI), 'la frase fissa non viene prima').toBe(0);
    expect(testo.indexOf(FRASE_ALIMENTI)).toBeLessThan(testo.indexOf(FALSA));
    s.smonta();
  });

  it('chi detta solo gli allergeni: la proposta e vuota, e l avviso non dice di riprovare', async () => {
    ilModelloRisponde({}, 'Gli allergeni non li compilo io: aggiungi tu la frutta secca nella scheda.');
    const s = await detta('aggiungi la frutta secca agli allergeni', FOCACCIA);
    const testo = avviso(s);
    expect(testo).toContain(FRASE_ALIMENTI);
    expect(testo).toContain('Nella scheda non ho scritto niente');
    expect(testo, 'l avviso chiede di riprovare, e riprovare da sempre lo stesso risultato').not.toMatch(/riprova/i);
    expect(campo(s, 'Allergeni')?.value).toBe('glutine');
    s.smonta();
  });

  it('al microfono (Chrome, Android): lo stesso avviso, con la frase fissa', async () => {
    ilModelloRisponde(UBBIDIENTE);
    const s = await dettaAlMicrofono(DETTATO, FOCACCIA);
    const testo = avviso(s);
    expect(campo(s, 'Nome prodotto')?.value, 'la dettatura non e arrivata al modulo').toBe('Focaccia genovese');
    expect(testo, 'dal microfono gli allergeni detti spariscono senza una parola').toContain(FRASE_ALIMENTI);
    expect(testo).toContain(`Hai detto: «${DETTATO}»`);
    expect(campo(s, 'Allergeni')?.value).toBe('glutine');
    s.smonta();
  });

  it('al microfono, con la proposta vuota: la frase fissa c e lo stesso', async () => {
    ilModelloRisponde({}, '');
    const s = await dettaAlMicrofono('aggiungi la frutta secca agli allergeni', FOCACCIA);
    const testo = avviso(s);
    expect(testo).toContain(FRASE_ALIMENTI);
    expect(testo).toContain('Nella scheda non ho scritto niente');
    s.smonta();
  });
});
