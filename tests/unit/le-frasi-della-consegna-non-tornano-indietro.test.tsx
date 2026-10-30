// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act, createElement, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * 29/10/2026 — LE FRASI DELLA CONSEGNA NON TORNANO INDIETRO CON LE PROVE VERDI.
 *
 * Regola di Nicola del 29/10 (registro dei fatti, consegna.promessa): la consegna normale arriva
 * nella fascia oraria che il cliente sceglie in cassa; la veloce in 30-60 minuti dalla conferma
 * del negozio si può solo dalle 8 alle 21, a negozi aperti, con un fattorino in servizio.
 *
 * L'ondata 14 aveva riscritto le frasi, e la sua prova (la-consegna-si-promette-all-ora-che-scegli)
 * le disegnava con renderToStaticMarkup. Il collaudo ha rimesso, una per volta, sei promesse
 * vecchie e la prova è rimasta verde:
 *   · «oggi, in 30-60 min» nella scheda negozio della home (HeroStoreCard): nessuno la disegnava;
 *   · il conto alla rovescia fino alle 18 DOPO il caricamento nel browser: renderToStaticMarkup non
 *     fa girare gli effetti, quindi l'ora non arriva mai e il componente non mostra niente di suo;
 *   · `esaurito={false}` sulla scheda prodotto: la prova dava `esaurito` a mano al componente;
 *   · «consegna locale in 30-60 minuti» nella descrizione Google della scheda prodotto;
 *   · la frase «in giornata, negli orari di apertura del negozio» ricopiata fra virgolette doppie
 *     (la prova cercava solo l'apice singolo);
 *   · un titolo della home che promette «carta o contanti» (la prova cercava solo «come vuoi»).
 * Qui ogni pezzo si disegna davvero, nel browser finto quando serve l'ora, e si legge il testo che
 * vede la persona. E al lancio niente abbigliamento (catalogo.categorie, Nicola 29/10 alle 00:05).
 */

const stato = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false },
  variante: 'a',
  prodotto: null as unknown,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => stato.query,
  HydrationBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => stato.variante }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }));
vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => {
    throw new Error('nella prova la home non legge il database: vale la composizione di riserva');
  },
}));
vi.mock('@/lib/queries/precarico', () => ({ precaricaHome: async () => ({}), precaricaProdotto: async () => ({}) }));
vi.mock('@/lib/queries/metadati-vetrina', () => ({
  leggiProdottoPerMetadati: async () => stato.prodotto,
  prodottoDaIndicizzare: () => true,
}));
vi.mock('@/components/home/ExperimentExposure', () => ({ default: () => null }));
vi.mock('@/components/home-sections/HomeSectionRenderer', () => ({
  // La home passa all'eroe i testi della variante: qui si disegnano tali e quali.
  default: ({ heroDefaults }: { heroDefaults: { eyebrow?: ReactNode; headline?: ReactNode; subhead?: ReactNode } }) =>
    createElement(
      'div',
      null,
      createElement('p', null, heroDefaults.eyebrow),
      createElement('h1', null, heroDefaults.headline),
      createElement('p', null, heroDefaults.subhead),
    ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** I minuti della veloce, scritti in qualunque modo. */
const MINUTI = /30\s*[-–]\s*60/;
const ALL_ORA_CHE_SCEGLI = "all'ora che scegli";
/** Un modo di pagare nominato a parole. */
const MODO_DI_PAGARE = /pag[ah]|carta|contant|come vuoi|bancomat|satispay|paypal|apple pay|google pay/i;
/** L'abbigliamento, anche detto «moda». */
const ABBIGLIAMENTO = /abbigliament|\bmoda\b|vestit/i;

function testo(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function disegna(c: unknown, props: Record<string, unknown> = {}): string {
  return testo(renderToStaticMarkup(createElement(c as ComponentType<Record<string, unknown>>, props)));
}

/** Un forno vero: aperto dal lunedì al sabato, 8-13, domenica chiuso. */
const FORNO = {
  mon: [['08:00', '13:00']],
  tue: [['08:00', '13:00']],
  wed: [['08:00', '13:00']],
  thu: [['08:00', '13:00']],
  fri: [['08:00', '13:00']],
  sat: [['08:00', '13:00']],
};

/** L'orologio fermo a un istante di Piacenza (fine ottobre: ora solare, UTC+1). */
function orologioA(utc: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(utc));
}

/** La cassa che risponde alla domanda della veloce (/api/consegna/veloce). */
function cassaDice(possibile: boolean) {
  const chiamate: string[] = [];
  vi.stubGlobal('fetch', async (url: unknown) => {
    chiamate.push(String(url));
    return { ok: true, json: async () => ({ possibile }) };
  });
  return chiamate;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  stato.query = { data: undefined, isLoading: false, isError: false };
});

describe('la scheda negozio della home (HeroStoreCard) non promette minuti', () => {
  it('negozio aperto: «Consegna a casa, all’ora che scegli», niente «oggi, in 30-60 min»', async () => {
    orologioA('2026-10-30T09:00:00Z'); // venerdì 30/10 alle 10:00 a Piacenza, forno aperto
    stato.query = {
      data: {
        store: { id: 's1', store_name: 'Pane Quotidiano', store_address: 'Via Roma 1, 29121 Piacenza', store_logo: null, store_hours: FORNO, store_media: null },
        products: [],
        reviews: null,
      },
      isLoading: false,
      isError: false,
    };
    const { default: HeroStoreCard } = await import('@/components/home/HeroStoreCard');
    const t = disegna(HeroStoreCard);
    expect(t, 'si deve vedere la scheda del negozio vero, non il segnaposto').toContain('Pane Quotidiano');
    expect(t).toMatch(/Consegna a casa\s+all'ora che scegli/);
    expect(t).not.toMatch(MINUTI);
    expect(t).not.toMatch(/oggi,\s*in|entro le|in mezz'ora/i);
  });
});

describe('la scheda prodotto dopo il caricamento nel browser (idratazione)', () => {
  async function nelBrowser(props: Record<string, unknown>): Promise<string> {
    const { DeliveryCutoff } = await import('@/components/ui/DeliveryCutoff');
    const scatola = document.createElement('div');
    document.body.appendChild(scatola);
    const radice = createRoot(scatola);
    await act(async () => {
      radice.render(createElement(DeliveryCutoff as ComponentType<Record<string, unknown>>, props));
    });
    // La risposta della cassa sulla veloce arriva dopo: si lascia finire la catena di promesse.
    await act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    });
    const t = (scatola.textContent ?? '').replace(/\s+/g, ' ').trim();
    act(() => radice.unmount());
    scatola.remove();
    return t;
  }

  it('IL CASO DEL FORNO — sabato 31/10 alle 12:30, chiude alle 13: niente conto fino alle 18, si sceglie l’ora in cassa', async () => {
    orologioA('2026-10-31T11:30:00Z');
    cassaDice(false);
    const t = await nelBrowser({ storeHours: FORNO, negozioId: 'forno' });
    expect(t).toContain(ALL_ORA_CHE_SCEGLI);
    expect(t).not.toMatch(/entro|\d{1,2}:\d{2}:\d{2}|arriva oggi|domani|18/i);
    expect(t).not.toMatch(MINUTI);
  });

  it('sabato alle 21:30, domenica chiuso: niente «domani», si dice quando riapre davvero', async () => {
    orologioA('2026-10-31T20:30:00Z');
    cassaDice(true);
    const t = await nelBrowser({ storeHours: FORNO, negozioId: 'forno' });
    expect(t).toContain('riapre lunedì alle 08:00');
    expect(t).not.toMatch(/domani|arriva oggi|entro/i);
    expect(t).not.toMatch(MINUTI);
  });

  it('la veloce compare solo dopo il sì della cassa, e accanto alla consegna all’ora che scegli', async () => {
    orologioA('2026-10-30T09:00:00Z');
    const chiamate = cassaDice(true);
    const si = await nelBrowser({ storeHours: FORNO, negozioId: 'forno' });
    expect(chiamate.join(' ')).toContain('/api/consegna/veloce?negozi=forno');
    expect(si).toMatch(MINUTI);
    expect(si).toContain(ALL_ORA_CHE_SCEGLI);
    cassaDice(false);
    expect(await nelBrowser({ storeHours: FORNO, negozioId: 'forno' })).not.toMatch(MINUTI);
  });

  it('sul prodotto esaurito, anche dopo il caricamento, nessun tempo di consegna e nessun «2-3 giorni»', async () => {
    orologioA('2026-10-30T09:00:00Z');
    cassaDice(true);
    expect(await nelBrowser({ esaurito: true, storeHours: FORNO, negozioId: 'forno' })).toBe('');
    for (const props of [{ storeHours: FORNO, negozioId: 'forno' }, { negozioId: 'forno' }]) {
      expect(await nelBrowser(props), JSON.stringify(props)).not.toMatch(/2-3 giorni|giorni lavorativi/i);
    }
  });
});

describe('la scheda prodotto passa davvero lo stato «esaurito» alla riga della consegna', () => {
  const src = readFileSync(join(process.cwd(), 'app/product/[id]/page.tsx'), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, ' ');

  it('la riga della consegna e il bollino ESAURITO leggono la stessa variabile', () => {
    // La pagina è un componente del server con dieci letture: qui si legge il collegamento, e il
    // comportamento del componente (esaurito → niente) lo prova il blocco qui sopra, nel browser.
    const inizio = src.indexOf('<DeliveryCutoff');
    expect(inizio, 'la scheda prodotto non disegna più la riga della consegna').toBeGreaterThan(-1);
    const tag = src.slice(inizio, src.indexOf('/>', inizio));
    const esaurito = tag.match(/esaurito=\{([^}]+)\}/);
    expect(esaurito, 'la scheda non dice al componente se il prodotto è esaurito').not.toBeNull();
    const variabile = esaurito![1].trim();
    expect(variabile, 'esaurito deve essere lo stato vero del prodotto, non una costante').not.toMatch(/^(true|false|undefined|null|!?0|!?1)$/);
    expect(src, 'il bollino ESAURITO e la riga della consegna devono leggere la stessa cosa').toContain(`{${variabile} && <Badge variant="soldout"`);
  });
});

describe('la descrizione per Google della scheda prodotto', () => {
  it('senza la descrizione del negoziante dice «all’ora che scegli», non i minuti', async () => {
    stato.prodotto = { name: 'Pane di grano duro', description: null, images: [], profiles: { store_name: 'Pane Quotidiano', is_approved: true } };
    const { generateMetadata } = await import('@/app/product/[id]/layout');
    const m = await generateMetadata({ params: Promise.resolve({ id: 'p1' }) });
    for (const d of [m.description, m.openGraph?.description, m.twitter?.description]) {
      expect(String(d)).toContain(ALL_ORA_CHE_SCEGLI);
      expect(String(d)).not.toMatch(MINUTI);
      expect(String(d)).not.toMatch(/in giornata|in mezz'ora|oggi/i);
    }
  });
});

describe('la frase «in giornata, negli orari di apertura del negozio» vive in una copia sola', () => {
  function sorgenti(dir: string, fuori: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      if (nome === 'node_modules' || nome.startsWith('.')) continue;
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) sorgenti(p, fuori);
      else if (/\.(ts|tsx|js|jsx|json|md)$/.test(nome)) fuori.push(p);
    }
    return fuori;
  }

  it('nessun file del sito la riscrive, con nessun tipo di virgolette', async () => {
    const { QUANDO_ARRIVA_SENZA_NEGOZIO } = await import('@/lib/promesse-pubbliche');
    const frase = QUANDO_ARRIVA_SENZA_NEGOZIO.toLowerCase().replace(/\s+/g, ' ');
    const radice = process.cwd();
    const copie = ['app', 'components', 'lib', 'public']
      .flatMap((d) => sorgenti(join(radice, d)))
      .map((p) => relative(radice, p))
      .filter((p) => p !== join('lib', 'promesse-pubbliche.ts'))
      .filter((p) => readFileSync(join(radice, p), 'utf8').toLowerCase().replace(/\s+/g, ' ').includes(frase));
    expect(copie, 'la frase va importata da lib/promesse-pubbliche, non ricopiata').toEqual([]);
  });

  it('la scheda prodotto senza negozio la prende da lì', async () => {
    const { QUANDO_ARRIVA_SENZA_NEGOZIO } = await import('@/lib/promesse-pubbliche');
    const { DeliveryCutoff } = await import('@/components/ui/DeliveryCutoff');
    expect(disegna(DeliveryCutoff, { senzaNegozio: true })).toBe(`Consegna ${QUANDO_ARRIVA_SENZA_NEGOZIO}`);
  });
});

describe('la home: il titolo dice il modo di pagare della cassa, e niente abbigliamento', () => {
  async function home(variante: string): Promise<{ titolo: string; tutto: string }> {
    stato.variante = variante;
    const { default: Home } = await import('@/app/page');
    const html = renderToStaticMarkup(await Home());
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    return { titolo: testo(h1 ? h1[1] : ''), tutto: testo(html) };
  }

  it('variante B (metà dei visitatori): il modo di pagare nel titolo è frasePagamento(), e nient’altro', async () => {
    const { frasePagamento } = await import('@/lib/promesse-pubbliche');
    const { titolo } = await home('b');
    expect(titolo, 'il titolo della variante B deve dire il modo di pagare della cassa').toContain(frasePagamento());
    expect(titolo.replace(frasePagamento(), ' '), `il titolo promette un modo di pagare suo: «${titolo}»`).not.toMatch(MODO_DI_PAGARE);
  });

  it('variante A: il titolo non promette nessun modo di pagare', async () => {
    const { frasePagamento } = await import('@/lib/promesse-pubbliche');
    const { titolo } = await home('a');
    expect(titolo.length).toBeGreaterThan(0);
    expect(titolo.replace(frasePagamento(), ' ')).not.toMatch(MODO_DI_PAGARE);
  });

  it('nessuna variante della home nomina l’abbigliamento, né i minuti come cosa certa', async () => {
    for (const v of ['a', 'b']) {
      const { tutto } = await home(v);
      expect(tutto, `variante ${v}`).not.toMatch(ABBIGLIAMENTO);
      expect(tutto, `variante ${v}`).not.toMatch(MINUTI);
    }
  });

  it('il giro di benvenuto nomina i modi di pagare solo con la frase della cassa', async () => {
    const { PASSI_DEL_GIRO } = await import('@/components/BuyerOnboardingTour');
    const { fraseComeSiPaga } = await import('@/lib/promesse-pubbliche');
    for (const p of PASSI_DEL_GIRO as { title: string; body: string }[]) {
      const resto = `${p.title} ${p.body}`.replace(fraseComeSiPaga(), ' ');
      expect(resto, p.title).not.toMatch(/carta|contant|come vuoi|bancomat|satispay|paypal/i);
    }
  });
});

describe('le descrizioni per Google non nominano l’abbigliamento', () => {
  it('la descrizione del sito sta in lib/site-branding, e la usa la radice del sito', async () => {
    const { DESCRIZIONE_DEL_SITO } = await import('@/lib/site-branding');
    expect(DESCRIZIONE_DEL_SITO).not.toMatch(ABBIGLIAMENTO);
    expect(DESCRIZIONE_DEL_SITO).not.toMatch(MINUTI);
    expect(DESCRIZIONE_DEL_SITO).toContain(ALL_ORA_CHE_SCEGLI);
    // La radice del sito importa tutta l'impalcatura (caratteri, provider, analytics): qui si legge
    // il collegamento, il valore lo prova la riga sopra.
    const layout = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/[^\n]*$/gm, ' ');
    expect(layout).toMatch(/description:\s*DESCRIZIONE_DEL_SITO\b/);
    expect(layout).not.toMatch(ABBIGLIAMENTO);
  });

  it('la pagina dei negozi', async () => {
    const negozi = await import('@/app/stores/layout');
    expect(String((negozi.metadata as { description?: string }).description)).not.toMatch(ABBIGLIAMENTO);
  });
});
