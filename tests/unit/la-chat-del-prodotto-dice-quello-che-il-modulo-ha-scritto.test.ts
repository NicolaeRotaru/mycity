/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 16/10/2026 — LA CHAT DICEVA «HO AGGIUNTO GLI ALLERGENI», E NEL MODULO NON
 * C'ERANO.
 *
 * Il titolare del forno apre la Focaccia, che ha gia' gli allergeni «glutine»,
 * e scrive nella chat del prodotto «gli allergeni sono glutine e sesamo». Il
 * testo che guida l'assistente gli chiedeva di spiegare cosa aveva cambiato, e
 * non gli diceva che gli allergeni non si toccano. L'assistente proponeva
 * `allergeni: "glutine, sesamo"` e rispondeva «Fatto! Ho aggiunto gli
 * allergeni: glutine e sesamo». Nel modulo gli allergeni non entrano (R41): il
 * campo restava «glutine». Ma la bolla mostrava la frase del modello cosi'
 * com'era, e la frase restava li' anche quando l'avviso giallo col valore era
 * sparito. Lui salvava; il controllo prima della pubblicazione guarda solo che
 * il campo non sia vuoto. Un allergico al sesamo si fidava della scheda.
 *
 * La prova vecchia non se ne accorgeva perche' il modello finto rispondeva
 * «Ecco la proposta.». Qui il modello risponde come risponderebbe davvero.
 *
 * Due cose si guardano:
 *  - quello che il negoziante LEGGE nella chat, col modulo vero montato: le
 *    parole del modello non compaiono quando una parte della proposta non e'
 *    entrata; sotto la bolla c'e' una riga fissa su cosa NON e' stato scritto;
 *  - quello che le quattro rotte (chat del prodotto, diagnosi, codice a barre,
 *    dettatura) MANDANO al modello: la regola sulle dichiarazioni c'e', e le
 *    chiavi delle dichiarazioni sono segnate in sola lettura.
 */

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

// Le rotte: utente finto, modello finto, filtro anti-contenuti finto.
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
  messaggioDellaChatDopoIlPatch,
  esitoDelPiano,
  pianoPatchPerIlModulo,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
import { CATEGORY_ATTRIBUTES } from '@/lib/category-attributes';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { POST as chatDelProdotto } from '@/app/api/ai/product-chat/route';
import { POST as diagnosi } from '@/app/api/ai/diagnose/route';
import { POST as codiceABarre } from '@/app/api/ai/barcode-lookup/route';
import { POST as dettatura } from '@/app/api/ai/voice-product/route';
import { monta, nomeAccessibile } from './aiuti/monta-componente';
import { accendi, attendi, clicca } from './aiuti/schermo';

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
];

const FOCACCIA = { prezzoAttuale: 3.5, categorie: CATEGORIE, categoriaAttuale: 'pane', modo: 'edit' as const };

// La risposta che un modello da' davvero quando gli si chiede di spiegare cosa ha cambiato.
const HO_AGGIUNTO = 'Fatto! Ho aggiunto gli allergeni: glutine e sesamo';

describe('la frase della chat dopo un suggerimento', () => {
  it('solo allergeni proposti: le parole del modello non si mostrano, e sotto c e la riga su cosa NON e scritto', () => {
    const esito = esitoDelPiano(pianoPatchPerIlModulo({ attributes: { allergeni: 'glutine, sesamo' } }, FOCACCIA));
    const msg = messaggioDellaChatDopoIlPatch(HO_AGGIUNTO, esito);
    expect(msg.testo).not.toContain('Ho aggiunto');
    expect(msg.testo).toBe('Nella scheda non è cambiato niente: la proposta NON è stata scritta.');
    expect(msg.aggiornato).toBe(false);
    expect(msg.nonScritto).toHaveLength(1);
    expect(msg.nonScritto[0]).toContain('Allergeni NON compilato');
    expect(msg.nonScritto[0]).toContain('«glutine, sesamo»');
    expect(msg.nonScritto[0]).toContain('«Usa questo valore»');
  });

  it('nome scritto e allergeni no: si dice quali campi sono cambiati davvero, non la frase del modello', () => {
    const esito = esitoDelPiano(
      pianoPatchPerIlModulo({ name: 'Focaccia alta', attributes: { allergeni: 'glutine, sesamo' } }, FOCACCIA),
    );
    const msg = messaggioDellaChatDopoIlPatch('Ho cambiato il nome e aggiunto gli allergeni: glutine e sesamo.', esito);
    expect(msg.testo).toBe('Campi cambiati nella scheda: nome. Il resto della proposta NON è stato scritto.');
    expect(msg.aggiornato).toBe(true);
    expect(msg.nonScritto.map((r) => r.slice(0, 23))).toEqual(['Allergeni NON compilato']);
  });

  it('un allergene da togliere e un prezzo fuori banda: una riga ciascuno, senza pulsante da promettere', () => {
    const esito = esitoDelPiano(
      pianoPatchPerIlModulo({ price: 0.35, attributes_remove: ['allergeni'] }, FOCACCIA),
    );
    const msg = messaggioDellaChatDopoIlPatch('Ho tolto gli allergeni e messo il prezzo a 0,35 €.', esito);
    expect(msg.testo).not.toContain('Ho tolto');
    expect(msg.nonScritto).toEqual([
      'prezzo NON applicato (3.50 → 0.35 €: oltre il 30%, va deciso a mano)',
      'Allergeni NON tolto: lo decidi tu nella scheda del prodotto',
    ]);
  });

  it('controprova: quando il modulo ha scritto tutto, la risposta resta quella del modello', () => {
    const esito = esitoDelPiano(pianoPatchPerIlModulo({ name: 'Focaccia alta' }, FOCACCIA));
    expect(messaggioDellaChatDopoIlPatch('Nome sistemato.', esito)).toEqual({
      testo: 'Nome sistemato.',
      nonScritto: [],
      aggiornato: true,
    });
  });
});

describe('la chat del prodotto, nel modulo vero, con la risposta che il modello da davvero', () => {
  let risposta: { reply: string; patch: AiProductPatch };

  beforeEach(() => {
    for (const f of [avvisi.toast, ...Object.values(avvisi.toast)]) (f as ReturnType<typeof vi.fn>).mockClear?.();
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    if (typeof window.HTMLElement.prototype.scrollTo !== 'function') {
      window.HTMLElement.prototype.scrollTo = () => {};
    }
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url) !== '/api/ai/product-chat') throw new Error(`chiamata inattesa: ${url}`);
      return new Response(JSON.stringify(risposta), { status: 200 });
    });
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
  });

  async function apriEChiedi(richiesta: string) {
    const mod = await monta('components/seller/ProductForm.tsx');
    const s = accendi(mod.default, {
      // I pulsanti AI, come il giorno in cui si riaccendono (al lancio sono spenti).
      aiAccesa: true,
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
        attributes: { allergeni: 'glutine' },
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
    // La bolla dell'assistente e' arrivata: c'e' un secondo messaggio dopo quello del negoziante.
    const bolle = s.radice.querySelectorAll('.max-h-72 .rounded-2xl');
    expect(bolle.length, 'la risposta dell assistente non e arrivata: la prova girerebbe a vuoto').toBe(2);
    return { s, bolla: (bolle[1].textContent ?? '').replace(/\s+/g, ' ') };
  }

  const campo = (s: ReturnType<typeof accendi>, nome: string) =>
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input, textarea')).find((el) =>
      nomeAccessibile(el).startsWith(nome),
    );

  it('«gli allergeni sono glutine e sesamo»: la chat non dice «ho aggiunto», dice cosa NON e scritto e come confermarlo', async () => {
    risposta = { reply: HO_AGGIUNTO, patch: { attributes: { allergeni: 'glutine, sesamo' } } };
    const { s, bolla } = await apriEChiedi('gli allergeni sono glutine e sesamo');

    expect(campo(s, 'Allergeni'), 'il campo Allergeni non e a video: la prova girerebbe a vuoto').toBeTruthy();
    expect(campo(s, 'Allergeni')!.value, 'gli allergeni proposti sono entrati nel campo').toBe('glutine');
    expect(bolla, 'la chat dice «ho aggiunto gli allergeni» mentre il campo e rimasto «glutine»').not.toContain(
      'Ho aggiunto',
    );
    expect(bolla).toContain('Nella scheda non è cambiato niente');
    expect(bolla).toContain('Allergeni NON compilato');
    expect(bolla).toContain('«Usa questo valore»');
    expect(bolla).not.toContain('Campi aggiornati nel form');
    expect(avvisi.toast.success).not.toHaveBeenCalled();

    // La riga fissa non ha orologio: e' nella bolla, non in un avviso a tempo.
    vi.useFakeTimers();
    vi.advanceTimersByTime(120_000);
    vi.useRealTimers();
    expect((s.radice.querySelectorAll('.max-h-72 .rounded-2xl')[1].textContent ?? '')).toContain(
      'Allergeni NON compilato',
    );

    // E la proposta si conferma da dove la riga dice: «Usa questo valore» nel riquadro «Da controllare».
    const usa = Array.from(s.radice.querySelectorAll('section button')).find(
      (b) => (b.textContent ?? '').trim() === 'Usa questo valore',
    );
    expect(usa, 'la riga rimanda a un pulsante che non c e').toBeTruthy();
    s.agisci(() => clicca(usa!));
    expect(campo(s, 'Allergeni')!.value).toBe('glutine, sesamo');
    s.smonta();
  });

  it('variante scomoda: nome cambiato e allergeni no, e il modello si prende il merito di tutti e due', async () => {
    risposta = {
      reply: 'Ho cambiato il nome in «Focaccia alta» e ho aggiunto gli allergeni: glutine e sesamo.',
      patch: { name: 'Focaccia alta', attributes: { allergeni: 'glutine, sesamo' } },
    };
    const { s, bolla } = await apriEChiedi('chiamala focaccia alta, e gli allergeni sono glutine e sesamo');

    expect(campo(s, 'Allergeni')!.value).toBe('glutine');
    expect(bolla).not.toContain('ho aggiunto gli allergeni');
    expect(bolla).toContain('Campi cambiati nella scheda: nome');
    expect(bolla).toContain('Allergeni NON compilato');
    expect(bolla, 'il nome e cambiato davvero: la spunta ci deve essere').toContain('Campi aggiornati nel form');
    s.smonta();
  });

  it('controprova: la chat che cambia solo il nome mostra la risposta del modello, con la spunta', async () => {
    risposta = { reply: 'Nome sistemato: «Focaccia alta».', patch: { name: 'Focaccia alta' } };
    const { s, bolla } = await apriEChiedi('chiamala focaccia alta');
    expect(bolla).toContain('Nome sistemato: «Focaccia alta».');
    expect(bolla).toContain('Campi aggiornati nel form');
    expect(bolla).not.toContain('NON');
    s.smonta();
  });
});

describe('quello che le quattro rotte mandano al modello', () => {
  const SCHEMA_ALIMENTI = (CATEGORY_ATTRIBUTES as Record<string, { key: string; type: string; options?: string[] }[]>)
    .alimentari;
  const REGOLA_ATTESA = 'CAMPI CHE NON TOCCHI MAI: allergeni, ingredienti';

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function richiesta(percorso: string, corpo: unknown): never {
    return new Request(`http://localhost${percorso}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }) as never;
  }

  /** Tutto il testo che e' partito verso il modello, in una stringa. */
  function inviato(): { system: string; messaggi: string } {
    expect(runMessageMock, 'la rotta non ha chiamato il modello: la prova girerebbe a vuoto').toHaveBeenCalledTimes(1);
    const arg = runMessageMock.mock.calls[0][0] as { system: string; messages: unknown };
    return { system: String(arg.system), messaggi: JSON.stringify(arg.messages) };
  }

  function righeAttributi(messaggi: string): string[] {
    return messaggi.split('\\n').filter((r) => /^- [a-z_]+ \(/.test(r));
  }

  it('la chat del prodotto: la regola c e, e allergeni/ingredienti sono in sola lettura', async () => {
    runMessageMock.mockResolvedValue({ text: '', toolInput: { reply: 'Ok', patch: {} } });
    const res = await chatDelProdotto(
      richiesta('/api/ai/product-chat', {
        product: { name: 'Focaccia' },
        history: [{ role: 'user', content: 'gli allergeni sono glutine e sesamo' }],
        attributeSchema: SCHEMA_ALIMENTI,
      }),
    );
    expect(res.status).toBe(200);
    const { system, messaggi } = inviato();
    expect(system).toContain(REGOLA_ATTESA);
    const righe = righeAttributi(messaggi);
    expect(righe.length, 'l elenco degli attributi non e arrivato al modello').toBeGreaterThan(5);
    expect(righe.find((r) => r.startsWith('- allergeni '))).toContain('SOLO LETTURA');
    expect(righe.find((r) => r.startsWith('- ingredienti '))).toContain('SOLO LETTURA');
    expect(righe.find((r) => r.startsWith('- marca ')), 'la marca la puo scrivere: non e una dichiarazione').not
      .toContain('SOLO LETTURA');
  });

  it('la diagnosi: la regola c e', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { summary: 'ok', issues: [] } });
    const res = await diagnosi(
      richiesta('/api/ai/diagnose', { product: { name: 'Focaccia', price: 3.5 }, attributeSchema: SCHEMA_ALIMENTI }),
    );
    expect(res.status).toBe(200);
    expect(inviato().system).toContain(REGOLA_ATTESA);
  });

  it('il codice a barre: la regola c e, e le dichiarazioni sono in sola lettura', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { found: false } });
    const res = await codiceABarre(
      richiesta('/api/ai/barcode-lookup', { ean: '8001234567890', attributeSchema: SCHEMA_ALIMENTI }),
    );
    expect(res.status).toBe(200);
    const { system, messaggi } = inviato();
    expect(system).toContain(REGOLA_ATTESA);
    expect(righeAttributi(messaggi).find((r) => r.startsWith('- valori_nutrizionali '))).toContain('SOLO LETTURA');
  });

  it('la dettatura: la regola c e, e le dichiarazioni sono in sola lettura', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { reply: 'Ok', patch: {} } });
    const res = await dettatura(
      richiesta('/api/ai/voice-product', {
        transcript: 'focaccia genovese a tre euro e cinquanta',
        attributeSchema: SCHEMA_ALIMENTI,
      }),
    );
    expect(res.status).toBe(200);
    const { system, messaggi } = inviato();
    expect(system).toContain(REGOLA_ATTESA);
    expect(righeAttributi(messaggi).find((r) => r.startsWith('- allergeni '))).toContain('SOLO LETTURA');
  });
});
