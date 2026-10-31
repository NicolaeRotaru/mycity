/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  avvisoDopoIlPatch,
  esitoDelPiano,
  pianoPatchPerIlModulo,
  restaDaRivedere,
  type AiProductPatch,
  type CategoryRow,
} from '@/lib/products/aiPatch';
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
 * 16/10/2026 — «LA SCHEDA E' GIA' A POSTO» MENTRE L'AVVISO CHIEDE GLI ALLERGENI.
 *
 * Il fornaio apre la focaccia (5 €) e preme «Migliora tutto». L'assistente
 * propone gli allergeni «Glutine». Nel modulo gli allergeni non entrano (R41):
 * diventano un avviso giallo col pulsante «Usa questo valore». Il modulo non ha
 * scritto niente, e il pannello leggeva «niente scritto» come «niente da fare»:
 * nello stesso momento diceva «Niente da cambiare: la scheda è già a posto», e
 * a piè di pannello la spunta verde «Applicato al form». Lo stesso con un
 * prezzo di 50 € scartato perché fuori banda, e con la diagnosi «Perché non
 * vende?», che diceva «Niente da applicare» e poi buttava via la proposta:
 * sparito l'avviso dopo un minuto, gli allergeni proposti non si ritrovavano.
 *
 * Queste prove guardano la frase che segue l'applicazione e cosa resta da
 * rivedere: con proposte aperte la frase «niente da fare» non esce mai, e le
 * proposte si possono riaprire senza riscrivere quello che è già entrato.
 * (Dal 16/10 le proposte stanno nel riquadro «Da controllare» del modulo, non
 * in avvisi a tempo: vedi le-proposte-dell-assistente-restano-finche-decidi-tu.test.ts.)
 */

const CATEGORIE: CategoryRow[] = [
  { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
  { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
  { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
];

const FOCACCIA = {
  prezzoAttuale: 5,
  categorie: CATEGORIE,
  categoriaAttuale: 'pane',
  modo: 'edit' as const,
};

const MIGLIORA = {
  applicato: 'Modifiche applicate al form — controlla e salva',
  niente: 'Niente da cambiare: la scheda è già a posto',
};

describe('la frase dopo un suggerimento applicato', () => {
  it('solo allergeni proposti: niente scritto, ma la frase dice che c e una proposta da controllare', () => {
    const esito = esitoDelPiano(pianoPatchPerIlModulo({ attributes: { allergeni: 'Glutine' } }, FOCACCIA));
    expect(esito.cambiati).toEqual([]);
    expect(esito.inSospeso).toBe(1);
    const avviso = avvisoDopoIlPatch(esito, MIGLIORA);
    expect(avviso.testo, '«già a posto» accanto all avviso «Allergeni NON compilato»').not.toBe(MIGLIORA.niente);
    expect(avviso).toEqual({ tono: 'da-controllare', testo: "C'è una proposta da controllare: la trovi nel riquadro «Da controllare»" });
  });

  it('solo un prezzo di 50 € su 5 €: scartato, e la frase non dice «già a posto»', () => {
    const esito = esitoDelPiano(pianoPatchPerIlModulo({ price: 50 }, FOCACCIA));
    expect(esito.cambiati).toEqual([]);
    expect(esito.inSospeso).toBe(1);
    expect(avvisoDopoIlPatch(esito, MIGLIORA).tono).toBe('da-controllare');
  });

  it('prezzo scartato e due dichiarazioni: tre avvisi aperti, contati tutti', () => {
    const esito = esitoDelPiano(
      pianoPatchPerIlModulo(
        { price: 50, attributes: { allergeni: 'Glutine' }, attributes_remove: ['ingredienti'] },
        FOCACCIA,
      ),
    );
    expect(esito.cambiati).toEqual([]);
    expect(esito.inSospeso).toBe(3);
    expect(avvisoDopoIlPatch(esito, MIGLIORA).testo).toBe('Ci sono 3 proposte da controllare: le trovi nel riquadro «Da controllare»');
    // Dove la frase resta fissa (in fondo a «Migliora tutto»), rimanda all'elenco scritto subito sotto.
    expect(avvisoDopoIlPatch(esito, MIGLIORA, 'qui-sotto').testo).toBe('Ci sono 3 proposte da controllare: sono scritte qui sotto');
    expect(esito.daControllare).toHaveLength(3);
  });

  it('nome scritto e allergeni proposti: verde, ma dice anche che resta una proposta', () => {
    const esito = esitoDelPiano(
      pianoPatchPerIlModulo({ name: 'Focaccia alta', attributes: { allergeni: 'Glutine' } }, FOCACCIA),
    );
    expect(esito.cambiati).toEqual(['nome']);
    expect(avvisoDopoIlPatch(esito, MIGLIORA)).toEqual({
      tono: 'successo',
      testo: "Modifiche applicate al form — controlla e salva. C'è anche una proposta da controllare: la trovi nel riquadro «Da controllare»",
    });
  });

  it('controprove: solo scritture = la frase del pulsante; niente di niente = «già a posto»', () => {
    const scritto = esitoDelPiano(pianoPatchPerIlModulo({ name: 'Focaccia alta' }, FOCACCIA));
    expect(avvisoDopoIlPatch(scritto, MIGLIORA)).toEqual({ tono: 'successo', testo: MIGLIORA.applicato });
    const vuoto = esitoDelPiano(pianoPatchPerIlModulo({}, FOCACCIA));
    expect(vuoto.inSospeso).toBe(0);
    expect(avvisoDopoIlPatch(vuoto, MIGLIORA)).toEqual({ tono: 'neutro', testo: MIGLIORA.niente });
  });
});

describe('quello che resta da rivedere dopo l applicazione', () => {
  it('restano solo le dichiarazioni, con la chiave del campo', () => {
    const piano = pianoPatchPerIlModulo(
      {
        name: 'Focaccia alta',
        price: 50,
        attributes: { Allergeni: ' Glutine ', marca: 'Pane Quotidiano', vegano: 'true' },
        attributes_remove: ['ingredienti', 'colore'],
      },
      FOCACCIA,
    );
    expect(piano.daRivedere).toEqual({
      attributes: { allergeni: 'Glutine', vegano: 'true' },
      attributes_remove: ['ingredienti'],
    });
    expect(restaDaRivedere(piano.daRivedere)).toBe(true);
  });

  it('senza dichiarazioni non resta niente: il pulsante per rivedere non c e', () => {
    const piano = pianoPatchPerIlModulo({ name: 'Focaccia alta', price: 50, attributes: { marca: 'Forno' } }, FOCACCIA);
    expect(piano.daRivedere).toEqual({});
    expect(restaDaRivedere(piano.daRivedere)).toBe(false);
  });

  it('ripassato al modulo non scrive niente e riapre le stesse proposte, col pulsante', () => {
    const suggerimenti: AiProductPatch[] = [
      { attributes: { allergeni: 'Glutine' } },
      { name: 'Focaccia alta', attributes: { allergeni: 'Glutine', ingredienti: 'farina, acqua, sale' } },
      { attributes: { Ingredienti: 'farina' }, attributes_remove: ['allergeni', 'marca'] },
      { price: 50, tags: ['forno'], attributes: { senza_glutine: 'no', origine: 'Piacenza' } },
    ];
    for (const s of suggerimenti) {
      for (const categoriaAttuale of ['pane', 'casa']) {
        const ctx = { ...FOCACCIA, categoriaAttuale };
        const primo = pianoPatchPerIlModulo(s, ctx);
        const ancora = pianoPatchPerIlModulo(primo.daRivedere, ctx);
        expect(ancora.scritture, `rivedere ${JSON.stringify(s)} riscrive dei campi`).toEqual([]);
        expect(ancora.proposte).toEqual(primo.proposte);
        // Le stesse righe «Da controllare», tranne il prezzo, che non si rivede.
        expect(ancora.daControllare).toEqual(primo.daControllare.filter((v) => v.id !== 'prezzo'));
        expect(ancora.daRivedere).toEqual(primo.daRivedere);
      }
    }
  });
});

/**
 * La stessa scena col modulo VERO montato: il fornaio preme «Migliora tutto» o
 * «Perché non vende?», l'assistente risponde, lui preme «Applica». Qui si
 * guarda quello che legge lui.
 */
describe('«Migliora tutto» e la diagnosi, nel modulo vero', () => {
  let risposte: Record<string, unknown>;

  beforeEach(() => {
    for (const f of [avvisi.toast, ...Object.values(avvisi.toast)]) (f as ReturnType<typeof vi.fn>).mockClear?.();
    const g = globalThis as Record<string, unknown>;
    g.__UTENTE__ = { id: 'forno-1' };
    g.__GETTONE__ = 'gettone-di-prova';
    risposte = {};
    vi.stubGlobal('fetch', async (url: string) => {
      const risposta = risposte[String(url)];
      if (!risposta) throw new Error(`chiamata inattesa: ${url}`);
      return new Response(JSON.stringify(risposta), { status: 200 });
    });
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.__UTENTE__;
    delete g.__GETTONE__;
    vi.unstubAllGlobals();
  });

  async function apriLaFocaccia() {
    const mod = await monta('components/seller/ProductForm.tsx');
    return accendi(mod.default, {
      // I pulsanti AI, come il giorno in cui si riaccendono (al lancio sono spenti).
      aiAccesa: true,
      mode: 'edit',
      categories: CATEGORIE,
      initialValues: {
        name: 'Focaccia',
        description: 'Focaccia alta, cotta ogni mattina nel nostro forno.',
        price: 5,
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
  }

  type Schermo = Awaited<ReturnType<typeof apriLaFocaccia>>;

  function pulsante(s: Schermo, testo: string): HTMLButtonElement | undefined {
    return Array.from(s.radice.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(testo),
    );
  }

  async function premi(s: Schermo, testo: string) {
    const b = pulsante(s, testo);
    expect(b, `il pulsante «${testo}» non e a video: la prova girerebbe a vuoto`).toBeTruthy();
    s.agisci(() => clicca(b!));
    for (let i = 0; i < 8; i++) await attendi();
  }

  const testo = (s: Schermo) => (s.radice.textContent ?? '').replace(/\s+/g, ' ');
  const tutteLeFrasi = () =>
    [avvisi.toast, avvisi.toast.success, avvisi.toast.warning].flatMap((f) => f.mock.calls.map((c) => String(c[0])));
  const righeDaControllare = (s: Schermo) => {
    const box = Array.from(s.radice.querySelectorAll('section')).find((x) => nomeAccessibile(x) === 'Da controllare');
    return box ? Array.from(box.querySelectorAll('li')).map((li) => (li.textContent ?? '').replace(/\s+/g, ' ')) : [];
  };
  const campoAllergeni = (s: Schermo) =>
    Array.from(s.radice.querySelectorAll<HTMLInputElement>('input, textarea')).find((el) =>
      nomeAccessibile(el).startsWith('Allergeni'),
    );

  function miglioraTutto(patch: AiProductPatch) {
    risposte['/api/ai/improve-product'] = {
      summary: 'Ho guardato la scheda.',
      quality: { before: 50, after: 70, dimensions: [], missing: [] },
      pricing: null,
      fieldNotes: [],
      patch,
    };
  }

  it('«Migliora tutto» propone solo gli allergeni: niente «già a posto», niente spunta verde, e la proposta si ritrova', async () => {
    miglioraTutto({ attributes: { allergeni: 'Glutine' } });
    const s = await apriLaFocaccia();
    await premi(s, "Migliora tutto con l'AI");
    await premi(s, 'Applica tutto');

    expect(tutteLeFrasi(), 'il pannello dice «già a posto» mentre l avviso chiede gli allergeni').not.toContain(
      MIGLIORA.niente,
    );
    expect(avvisi.toast.success).not.toHaveBeenCalled();
    expect(testo(s), 'a piè di pannello resta la spunta «Applicato al form»').not.toContain('Applicato al form');
    expect(testo(s)).toContain("C'è una proposta da controllare: è scritta qui sotto");
    // L'unico avviso a comparsa e' il riassunto: la proposta sta nel riquadro «Da controllare».
    expect(avvisi.toast.warning.mock.calls.map((c) => String(c[0]))).toEqual([
      "C'è una proposta da controllare: la trovi nel riquadro «Da controllare»",
    ]);
    expect(righeDaControllare(s)).toEqual([expect.stringContaining('Allergeni NON compilato')]);

    // Il negoziante la toglie dal riquadro senza usarla: la proposta si rimette da qui.
    await premi(s, 'Non usarlo');
    expect(righeDaControllare(s)).toEqual([]);
    await premi(s, 'Rivedi le proposte');
    expect(righeDaControllare(s), '«Rivedi le proposte» non rimette la proposta degli allergeni').toEqual([
      expect.stringContaining('Allergeni NON compilato'),
    ]);
    expect(campoAllergeni(s), 'il campo Allergeni non e a video: la prova girerebbe a vuoto').toBeTruthy();
    expect(campoAllergeni(s)!.value).toBe('');
    await premi(s, 'Usa questo valore');
    expect(campoAllergeni(s)!.value).toBe('Glutine');
    s.smonta();
  });

  it('«Migliora tutto» propone 50 € su una focaccia da 5 €: scartato, e nessun «già a posto»', async () => {
    miglioraTutto({ price: 50 });
    const s = await apriLaFocaccia();
    await premi(s, "Migliora tutto con l'AI");
    await premi(s, 'Applica tutto');

    expect(tutteLeFrasi()).not.toContain(MIGLIORA.niente);
    expect(avvisi.toast.success).not.toHaveBeenCalled();
    expect(testo(s)).not.toContain('Applicato al form');
    expect(righeDaControllare(s)).toEqual([expect.stringContaining('prezzo NON applicato')]);
    expect(avvisi.toast.warning.mock.calls.map((c) => String(c[0]))).toContain(
      "C'è una proposta da controllare: la trovi nel riquadro «Da controllare»",
    );
    const prezzo = s.radice.querySelector('input[name="price"]') as HTMLInputElement;
    expect(Number(prezzo.value), 'il prezzo fuori banda e entrato nel campo').toBe(5);
    // Il prezzo non si «rivede» da qui: ripassarlo potrebbe scriverlo.
    expect(pulsante(s, 'Rivedi le proposte')).toBeUndefined();
    s.smonta();
  });

  it('controprova: «Migliora tutto» che cambia solo il nome dice «applicato», col verde', async () => {
    miglioraTutto({ name: 'Focaccia alta' });
    const s = await apriLaFocaccia();
    await premi(s, "Migliora tutto con l'AI");
    await premi(s, 'Applica tutto');
    expect(avvisi.toast.success).toHaveBeenCalledWith(MIGLIORA.applicato, undefined);
    expect(testo(s)).toContain('Applicato al form — controlla e salva');
    expect(pulsante(s, 'Rivedi le proposte')).toBeUndefined();
    s.smonta();
  });

  it('la diagnosi propone gli allergeni: niente «Niente da applicare», e la proposta non viene buttata', async () => {
    risposte['/api/ai/diagnose'] = {
      summary: 'Mancano gli allergeni.',
      score: 40,
      issues: [],
      patch: { attributes: { allergeni: 'Glutine' } },
    };
    const s = await apriLaFocaccia();
    await premi(s, 'Perché non vende?');
    await premi(s, 'Applica le correzioni');

    expect(tutteLeFrasi(), 'la diagnosi dice «Niente da applicare» accanto alla proposta').not.toContain(
      'Niente da applicare',
    );
    expect(avvisi.toast.success).not.toHaveBeenCalled();
    expect(avvisi.toast.warning.mock.calls.map((c) => String(c[0]))).toContain(
      "C'è una proposta da controllare: la trovi nel riquadro «Da controllare»",
    );
    expect(pulsante(s, 'Applica le correzioni')).toBeUndefined();

    await premi(s, 'Non usarlo');
    expect(righeDaControllare(s)).toEqual([]);
    await premi(s, 'Rivedi le proposte');
    expect(righeDaControllare(s), 'la diagnosi ha buttato via la proposta degli allergeni').toEqual([
      expect.stringContaining('Allergeni NON compilato'),
    ]);
    expect(pulsante(s, 'Usa questo valore')).toBeTruthy();
    // E si puo' riaprire ancora: finche' la diagnosi resta aperta, la proposta c'e'.
    expect(pulsante(s, 'Rivedi le proposte')).toBeTruthy();
    s.smonta();
  });

  it('controprova: la diagnosi che cambia solo il nome dice «applicate» e non lascia niente da rivedere', async () => {
    risposte['/api/ai/diagnose'] = { summary: 'Nome troppo corto.', score: 60, issues: [], patch: { name: 'Focaccia alta' } };
    const s = await apriLaFocaccia();
    await premi(s, 'Perché non vende?');
    await premi(s, 'Applica le correzioni');
    expect(avvisi.toast.success).toHaveBeenCalledWith('Correzioni applicate al form — controlla e salva', undefined);
    expect(pulsante(s, 'Rivedi le proposte')).toBeUndefined();
    expect(pulsante(s, 'Applica le correzioni')).toBeUndefined();
    s.smonta();
  });
});
