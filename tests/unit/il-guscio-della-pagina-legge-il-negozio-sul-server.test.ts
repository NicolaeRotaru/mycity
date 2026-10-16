import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, hydrate, type DehydratedState } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import {
  databaseCoiPermessi,
  OGGI,
  DOPO_LA_161,
  PROFILI_CHIUSI_VISTA_VECCHIA,
  type Mondo,
  type Dati,
} from './aiuti/database-coi-permessi';
import { domandaProdotto, negozioDellaSchedaOperativo } from '@/lib/queries/catalogo';
import { domandaVendutoDa, chiaveVendutoDa } from '@/lib/queries/venduto-da';

/**
 * 15/10/2026 (R3, R55) — I GUSCI DEL SERVER ESEGUITI DAVVERO, NON LE LORO FUNZIONI.
 *
 * Il primo collaudo ha rimesso la vecchia lettura da `profiles` in dieci degli undici punti
 * d'ingresso — il guscio della scheda prodotto che decide il «noindex» di Google compreso — e
 * tutte le prove sono rimaste verdi: provavano le funzioni in `lib/queries`, non che le pagine le
 * chiamassero. Qui si compila e si ESEGUE il file della pagina (il guscio della scheda prodotto,
 * quello della pagina del negozio, le due anteprime per WhatsApp) contro un database finto che
 * applica le regole di chi guarda.
 *
 * E qui si prova la seconda meta' di R55. L'avviso «manca la migrazione 126» lo scriveva il
 * browser del cliente, nella sua console, dove nessuno lo legge. Adesso la lettura di «Venduto da»
 * la fa il guscio, sul server: questa prova gira senza `window`, come il server, col logger VERO,
 * e pretende la riga di avviso nell'uscita del processo — quella che Vercel conserva nei registri.
 * Poi pretende che il browser trovi la risposta gia' in mano, sotto la chiave esatta che usa il
 * riquadro, senza rifare la lettura (cioe' senza riportare l'avviso sul telefono del cliente).
 */

const PANE = 'n-pane';
const SEGRETA = 'n-segreta';

function dati(): Dati {
  return {
    profiles: [
      {
        id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano',
        store_address: 'Via Roma 1, Piacenza', store_phone: '0523 000000', store_logo: 'logo-pane.png',
        store_description: 'Forno a legna dal 1952', offers_express: true, store_hours: { lun: '7-13' },
        business_legal_name: 'Pane Quotidiano', business_form: 'S.r.l.', business_vat_number: '01234567890',
        business_address: 'Via Roma 1', business_city: 'Piacenza', business_zip: '29121',
      },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta', store_description: 'Mai approvata' },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia al rosmarino', description: 'Lievitata 24 ore', price: 4.5, images: ['f.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-10', category_id: 'c-forno', stock: 10, has_variants: false },
      { id: 'p-panettone', name: 'Panettone segreto', description: null, price: 19.9, images: null, seller_id: SEGRETA, status: 'available', created_at: '2026-10-11', category_id: 'c-forno', stock: 7, has_variants: false },
    ],
    categories: [{ id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: null }],
  };
}

const MONDI: Array<[string, Mondo]> = [
  ['oggi in produzione (161 e 126 non applicate)', OGGI],
  ['dopo la 161 (profili chiusi, vista con la 126)', DOPO_LA_161],
  ['profili chiusi e vista ancora senza la 126', PROFILI_CHIUSI_VISTA_VECCHIA],
];

const globale = globalThis as Record<string, unknown>;

/** Chi legge sul server e' sempre un estraneo: il client pubblico, senza sessione. */
function serverIn(mondo: Mondo) {
  globale.__CLIENT_ANONIMO__ = databaseCoiPermessi(dati(), mondo, null).client;
}

/** Un database che non deve essere chiamato: se il browser va in rete, lo dice. */
const esplode = {
  from: () => {
    throw new Error('il browser e andato in rete: la risposta del server non e servita');
  },
};

/** Un browser come quello vero: riceve lo stato del server e ci lavora sopra. */
function browserCon(stato: DehydratedState) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
  hydrate(qc, stato);
  return qc;
}

type Elemento = { type?: unknown; props?: Record<string, unknown> } | null | undefined | string | number | boolean;

/** Cerca, nell'albero restituito dal guscio, lo stato che il guscio consegna alla pagina. */
function statoConsegnato(albero: Elemento): DehydratedState | null {
  if (!albero || typeof albero !== 'object') return null;
  if (Array.isArray(albero)) {
    for (const figlio of albero) {
      const s = statoConsegnato(figlio as Elemento);
      if (s) return s;
    }
    return null;
  }
  const props = albero.props ?? {};
  if (props.state && typeof props.state === 'object' && 'queries' in (props.state as object)) {
    return props.state as DehydratedState;
  }
  return statoConsegnato(props.children as Elemento);
}

/** Tutto il testo scritto dentro un albero di elementi (l'anteprima di WhatsApp). */
function testoDi(albero: Elemento): string {
  if (albero === null || albero === undefined || typeof albero === 'boolean') return '';
  if (typeof albero === 'string' || typeof albero === 'number') return String(albero);
  if (Array.isArray(albero)) return albero.map((x) => testoDi(x as Elemento)).join(' ');
  return testoDi((albero.props ?? {}).children as Elemento);
}

type Guscio = (p: { children: unknown; params: Promise<{ id: string }> }) => Promise<Elemento>;
type GeneraMetadati = (p: { params: Promise<{ id: string }> }) => Promise<{ title?: string; robots?: unknown }>;

const SOLO_SERVER = { veri: ['@tanstack/react-query'] };

/** Le righe che il processo ha scritto come avviso, gia' lette come JSON. */
let avvisi: Array<Record<string, unknown>> = [];
let orologio = Date.UTC(2026, 9, 15, 10, 0, 0);

beforeEach(() => {
  // La lettura dei metadati tiene la risposta in memoria due secondi: fra un mondo e l'altro
  // l'orologio va avanti, cosi' ogni prova legge il suo database e non quello della prova prima.
  // 16/10/2026 — anche il «no» della vista senza la 126 si ricorda, per dieci minuti
  // (`leggiNegozioDallaVista`), e il guscio compilato ha la sua copia di quella memoria: il passo
  // e' di un'ora, cosi' ogni prova parte da un processo che non ha ancora chiesto niente.
  vi.useFakeTimers({ toFake: ['Date'] });
  orologio += 60 * 60_000;
  vi.setSystemTime(orologio);
  avvisi = [];
  vi.spyOn(console, 'warn').mockImplementation((riga: unknown) => {
    try {
      avvisi.push(JSON.parse(String(riga)));
    } catch {
      avvisi.push({ grezzo: String(riga) });
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globale.__CLIENT_ANONIMO__;
});

const avvisoDella126 = () => avvisi.filter((a) => /126/.test(String(a.msg ?? a.grezzo ?? '')));

describe('il guscio della scheda prodotto, eseguito sul server', () => {
  it('gira davvero senza window: e il server, non il browser', () => {
    expect(typeof window).toBe('undefined');
  });

  it.each(MONDI)('consegna la scheda col negozio, e il browser non torna in rete — %s', async (_n, mondo) => {
    serverIn(mondo);
    const guscio = (await monta('app/product/[id]/layout.tsx', SOLO_SERVER)).default as Guscio;
    const stato = statoConsegnato(await guscio({ children: null, params: Promise.resolve({ id: 'p-focaccia' }) }));
    expect(stato, 'il guscio non consegna nessuno stato alla pagina').not.toBeNull();

    const browser = browserCon(stato!);
    const scheda = await browser.fetchQuery(domandaProdotto(esplode, 'p-focaccia'));
    expect(scheda?.profiles?.store_name).toBe('Pane Quotidiano');
    expect(negozioDellaSchedaOperativo(scheda!), 'la pagina direbbe «il negozio non e operativo»').toBe(true);
  });

  it('oggi in produzione, senza la 126: l avviso esce dal processo del server, e il browser trova «Venduto da» gia pronto', async () => {
    serverIn(OGGI);
    const guscio = (await monta('app/product/[id]/layout.tsx', SOLO_SERVER)).default as Guscio;
    const stato = statoConsegnato(await guscio({ children: null, params: Promise.resolve({ id: 'p-focaccia' }) }));

    const righe = avvisoDella126();
    expect(righe, 'nessuna riga di avviso dal server: chi apre i registri non saprebbe che manca la 126').toHaveLength(1);
    expect(righe[0]).toMatchObject({ level: 'warn', codice: '42703' });

    // Il browser fa la SUA domanda, quella del riquadro. Se la chiave fosse diversa partirebbe
    // una lettura vera: il database esplode, e l'avviso tornerebbe sul telefono del cliente.
    const browser = browserCon(stato!);
    const venduto = await browser.fetchQuery(domandaVendutoDa(esplode, PANE));
    expect(venduto).toMatchObject({
      store_name: 'Pane Quotidiano',
      store_address: 'Via Roma 1, Piacenza',
      store_phone: '0523 000000',
      business_vat_number: null,
    });
  });

  it('dopo la 126 il riquadro arriva con ragione sociale e partita IVA, e il server non scrive avvisi', async () => {
    serverIn(DOPO_LA_161);
    const guscio = (await monta('app/product/[id]/layout.tsx', SOLO_SERVER)).default as Guscio;
    const stato = statoConsegnato(await guscio({ children: null, params: Promise.resolve({ id: 'p-focaccia' }) }));

    expect(avvisoDella126()).toEqual([]);
    const venduto = await browserCon(stato!).fetchQuery(domandaVendutoDa(esplode, PANE));
    expect(venduto).toMatchObject({ business_legal_name: 'Pane Quotidiano', business_vat_number: '01234567890' });
  });

  it('per un prodotto di un negozio non approvato non chiede «Venduto da»', async () => {
    serverIn({ ...DOPO_LA_161, prodottiDeiNonApprovatiVisibili: true });
    const guscio = (await monta('app/product/[id]/layout.tsx', SOLO_SERVER)).default as Guscio;
    const stato = statoConsegnato(await guscio({ children: null, params: Promise.resolve({ id: 'p-panettone' }) }));
    const chiave = JSON.stringify(chiaveVendutoDa(SEGRETA));
    expect(stato!.queries.map((q) => JSON.stringify(q.queryKey))).not.toContain(chiave);
  });

  it.each(MONDI)('Google riceve la scheda indicizzabile col nome del negozio — %s', async (_n, mondo) => {
    serverIn(mondo);
    const genera = (await monta('app/product/[id]/layout.tsx', SOLO_SERVER)).generateMetadata as GeneraMetadati;
    const meta = await genera({ params: Promise.resolve({ id: 'p-focaccia' }) });
    expect(meta.title).toContain('Pane Quotidiano');
    expect(meta.robots, 'Google riceverebbe «noindex» su un prodotto in vendita').toBeUndefined();
  });

  it('un prodotto di un negozio non approvato resta fuori da Google anche se la riga trapela', async () => {
    serverIn({ ...DOPO_LA_161, prodottiDeiNonApprovatiVisibili: true });
    const genera = (await monta('app/product/[id]/layout.tsx', SOLO_SERVER)).generateMetadata as GeneraMetadati;
    const meta = await genera({ params: Promise.resolve({ id: 'p-panettone' }) });
    expect(meta.robots).toEqual({ index: false });
  });
});

describe('il guscio della pagina del negozio, eseguito sul server', () => {
  it('oggi in produzione: l avviso della 126 esce dal server e «Venduto da» arriva gia pronto', async () => {
    serverIn(OGGI);
    const guscio = (await monta('app/store/[id]/layout.tsx', SOLO_SERVER)).default as Guscio;
    const stato = statoConsegnato(await guscio({ children: null, params: Promise.resolve({ id: PANE }) }));
    expect(stato, 'il guscio del negozio non consegna nessuno stato').not.toBeNull();

    expect(avvisoDella126(), 'nessuna riga di avviso dal server').toHaveLength(1);
    const venduto = await browserCon(stato!).fetchQuery(domandaVendutoDa(esplode, PANE));
    expect(venduto).toMatchObject({ store_name: 'Pane Quotidiano', store_phone: '0523 000000' });
  });
});

describe('le anteprime per WhatsApp, eseguite', () => {
  it.each(MONDI)('quella del prodotto porta il nome del negozio — %s', async (_n, mondo) => {
    serverIn(mondo);
    const anteprima = (await monta('app/product/[id]/opengraph-image.tsx')).default as (
      p: { params: { id: string } },
    ) => Promise<{ elemento: Elemento }>;
    const immagine = await anteprima({ params: { id: 'p-focaccia' } });
    const testo = testoDi(immagine.elemento);
    expect(testo).toContain('Focaccia al rosmarino');
    expect(testo, 'l anteprima direbbe «MyCity Piacenza» al posto del negozio').toContain('Pane Quotidiano');
  });

  it.each(MONDI)('quella del negozio porta nome e descrizione — %s', async (_n, mondo) => {
    serverIn(mondo);
    const anteprima = (await monta('app/store/[id]/opengraph-image.tsx')).default as (
      p: { params: { id: string } },
    ) => Promise<{ elemento: Elemento }>;
    const testo = testoDi((await anteprima({ params: { id: PANE } })).elemento);
    expect(testo, 'l anteprima direbbe «Negozio su MyCity»').toContain('Pane Quotidiano');
    expect(testo).toContain('Forno a legna dal 1952');
  });

  it('quella di un negozio non approvato resta generica', async () => {
    serverIn(DOPO_LA_161);
    const anteprima = (await monta('app/store/[id]/opengraph-image.tsx')).default as (
      p: { params: { id: string } },
    ) => Promise<{ elemento: Elemento }>;
    const testo = testoDi((await anteprima({ params: { id: SEGRETA } })).elemento);
    expect(testo).toContain('Negozio su MyCity');
    expect(testo).not.toContain('Bottega Segreta');
  });
});
