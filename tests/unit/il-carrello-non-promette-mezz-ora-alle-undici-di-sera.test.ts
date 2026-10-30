/**
 * @vitest-environment jsdom
 */
/**
 * 6/9/2026 — ALLE UNDICI DI SERA IL CARRELLO DICEVA «CONSEGNA IN 30-60 MIN». LA CASSA DICEVA DOMANI.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Le due righe di disponibilità del carrello — «Disponibile · …» e «Ne restano solo N · …» —
 * chiudevano sempre con la stessa coda, perché quei minuti erano scritti lì dentro a mano. Non
 * guardavano l'orologio. La cassa, un clic dopo, l'orologio lo guarda: offre «Adesso» solo mentre
 * un rider c'è davvero (`expressSiPuo`). Alle 22:00 la stessa persona leggeva mezz'ora nel carrello
 * e trovava domani allo schermo successivo: la sorpresa all'ultimo passo, quella che fa abbandonare.
 *
 * ── 30/10/2026: la prova guarda il carrello, non il suo sorgente ───────────────────────────────
 * Fino all'ondata 13 questa prova cercava nel sorgente del carrello le frasi della regola. Dal
 * 29/10 la frase nasce in `rigaQuandoArrivaNelCarrello`, insieme alla risposta della cassa
 * (/api/consegna/veloce): la prova era rossa su un carrello giusto. Adesso il carrello si MONTA
 * davvero, con un orologio finto e una risposta finta della veloce, e si legge quello che scrive.
 * Diventa rossa se il carrello torna a promettere i minuti alle 23, se li promette senza aver
 * sentito la cassa, se la riga sotto il totale dice il contrario di quella del prodotto, o se il
 * carrello smette di rileggere l'ora mentre resta aperto.
 *
 * ── 30/10/2026 (ondata 17): carrello e cassa leggono lo stesso orologio ───────────────────────────
 * Il carrello e la cassa leggono l'ora del TELEFONO. Per qualche ora il carrello era passato da
 * solo all'ora di Roma, e un telefono a Bucarest alle 21:30 (a Roma le 20:30) leggeva «Consegna in
 * 30-60 min» nel carrello e trovava «Adesso» spento in cassa. Il blocco in fondo monta il carrello
 * e il riquadro vero della cassa allo stesso istante, su telefoni a Roma, Bucarest e Londra.
 * Tornano anche due controlli persi: il disegno che arriva dal server parte senza ora, e la riga
 * «Ne restano solo N» si prova montata, con la scorta bassa.
 *
 * ⚠️ Cosa NON prova: un browser vero (qui c'è jsdom) né la rotta /api/consegna/veloce, che qui è
 * finta: la sua regola la prova `la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino`.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import { rigaQuandoArrivaNelCarrello } from '@/lib/ordini/consegna-veloce';
import { romeNow } from '@/lib/store-hours';
import {
  APERTURA_EXPRESS,
  CHIUSURA_EXPRESS,
  expressSiPuo,
  giornoDiPartenza,
} from '@/lib/quando-arriva';
import CartPage from '@/app/cart/page';
import { DeliverySlotPicker } from '@/components/checkout/DeliverySlotPicker';
import { accendi } from './aiuti/schermo';

const banco = vi.hoisted(() => ({
  prodotti: [] as Array<{ id: string; stock: number | null; price: number | null }>,
}));

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => new Map() }));
vi.mock('@/lib/supabase/client', () => {
  const lettura = (righe: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq', 'order', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: righe, error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: (t: string) => lettura(t === 'products' ? banco.prodotti : []),
    },
  };
});

/** Cosa risponde la cassa alla domanda «la veloce si può, adesso?». */
type Risposta = 'si' | 'no' | 'muta' | 'cade';
let risposta: Risposta = 'no';
const reteDiPartenza = globalThis.fetch;
// L'import pigro del database, dentro la pagina, sfugge al vi.mock qui sopra: nasce il client vero,
// su un indirizzo finto, e ogni sua lettura riceve un 503 (la pagina si disegna lo stesso, come
// quando la rete cade davvero). Le variabili, impostate prima di ogni prova, restano tali.
// Fa eccezione la lettura dei prodotti: risponde con la scorta e il prezzo del banco, così una
// scorta bassa arriva davvero alla pagina (la riga «Ne restano solo N»).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'chiave-finta';
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/rest/v1/products')) {
    const corpo = JSON.stringify(banco.prodotti);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => corpo,
      json: async () => JSON.parse(corpo),
    };
  }
  if (!url.includes('/api/consegna/veloce')) {
    return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
  }
  if (risposta === 'muta') return new Promise(() => undefined);
  if (risposta === 'cade') throw new Error('rete caduta');
  return {
    ok: true,
    json: async () => (risposta === 'si' ? { possibile: true } : { possibile: false, perche: 'nessun fattorino online' }),
  };
}) as unknown as typeof fetch;

const UN_FILONE = { id: 'p-filone', name: 'Filone', price: 15, quantity: 1, sellerId: 'neg-pane', storeName: 'Pane Quotidiano' };
const UNA_FOCACCIA = { id: 'p-focaccia', name: 'Focaccia', price: 4, quantity: 1, sellerId: 'neg-pane', storeName: 'Pane Quotidiano' };

/**
 * L'istante in cui il telefono segna le ore dette, il 30/10/2026: è l'orologio che leggono sia il
 * carrello sia la cassa. Che le due letture coincidano su telefoni con fusi diversi lo prova il
 * blocco «il carrello legge lo stesso orologio della cassa», in fondo.
 */
function sulTelefono(ore: number, minuti: number): Date {
  return new Date(2026, 9, 30, ore, minuti);
}

let schermo: ReturnType<typeof accendi> | null = null;

afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
});

/** Lascia arrivare le letture: l'import pigro del database, la scorta, la risposta della veloce. */
async function assesta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Le righe del carrello e la scorta che ne dice il database. */
type Scaffale = Array<{ riga: typeof UN_FILONE; scorta: number }>;

/** Il carrello aperto in un istante preciso, con la risposta detta della cassa e la scorta detta. */
async function carrelloAllIstante(istante: Date, r: Risposta, scaffale: Scaffale = [{ riga: UN_FILONE, scorta: 50 }]) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(istante);
  risposta = r;
  banco.prodotti = scaffale.map((x) => ({ id: x.riga.id, stock: x.scorta, price: x.riga.price }));
  localStorage.setItem('cart', JSON.stringify(scaffale.map((x) => x.riga)));
  schermo = accendi(CartPage);
  await assesta();
  const s = schermo;
  const righe = () => [...s.radice.querySelectorAll('p')].map((p) => (p.textContent ?? '').trim());
  return {
    /**
     * Quello che la pagina PROMETTE, cioè tutto tranne il listino «Come si calcola la consegna»
     * (il riquadro che si apre, `<details>`): lì la veloce compare come voce di prezzo, a
     * qualunque ora, e non dice che un rider c'è adesso.
     */
    pagina: () => {
      const copia = s.radice.cloneNode(true) as HTMLElement;
      copia.querySelectorAll('details').forEach((d) => d.remove());
      return copia.textContent ?? '';
    },
    riga: () => righe().find((t) => t.startsWith('Disponibile')),
    /** La riga di una scorta bassa: «Ne restano solo N», col tempo di consegna se ce n'è uno. */
    rigaDellaScorta: () => righe().find((t) => t.startsWith('Ne restano solo')),
  };
}

/** Il carrello con un filone di Pane Quotidiano, aperto all'ora del telefono detta, con la risposta detta. */
const carrelloAlle = (ore: number, minuti: number, r: Risposta, scaffale?: Scaffale) =>
  carrelloAllIstante(sulTelefono(ore, minuti), r, scaffale);

describe('alle undici di sera la consegna in mezz\'ora non esiste', () => {
  it('la cassa non offre l\'express alle 22, e riparte da domani', () => {
    expect(expressSiPuo(22), 'a quest\'ora nessun rider è in strada').toBe(false);
    expect(giornoDiPartenza(22), 'la cassa apre già su domani').toBe('tomorrow');
  });

  it('e nemmeno alle 7 del mattino — ma lì il giorno è ancora oggi', () => {
    expect(expressSiPuo(7)).toBe(false);
    expect(giornoDiPartenza(7), 'alle 7 la fascia delle 15:00-18:00 c\'è ancora').toBe('today');
  });

  it('mentre in pieno orario l\'express c\'è, e non va perso per eccesso di prudenza', () => {
    expect(expressSiPuo(APERTURA_EXPRESS)).toBe(true);
    expect(expressSiPuo(14)).toBe(true);
    // Le 20 sono l'ora di punta della cena: qui l'express si offre ancora.
    expect(expressSiPuo(CHIUSURA_EXPRESS - 1)).toBe(true);
    expect(expressSiPuo(CHIUSURA_EXPRESS)).toBe(false);
  });
});

describe('il carrello montato dice quello che la cassa offrirà davvero', () => {
  it('alle 14, con un fattorino online, promette la mezz\'ora: la prova non passa per pigrizia', async () => {
    const c = await carrelloAlle(14, 0, 'si');
    expect(c.riga()).toBe(`Disponibile · Consegna in ${EXPRESS_ETA_LABEL}`);
  });

  it('alle 23 non promette nessuna mezz\'ora, in nessuna riga della pagina', async () => {
    const c = await carrelloAlle(23, 0, 'no');
    expect(c.riga(), 'la riga di disponibilità resta, senza i minuti').toMatch(/^Disponibile · /);
    expect(c.pagina(), `«${EXPRESS_ETA_LABEL}» alle 23: la cassa offrirà domani`).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('alle 23 non la promette nemmeno se la risposta della veloce è rimasta quella delle 20:59', async () => {
    // L'orologio di chi guarda è il secondo lucchetto: una risposta vecchia di un minuto, o un
    // telefono con l'ora più avanti del server, non bastano a promettere un rider che non c'è.
    const c = await carrelloAlle(23, 0, 'si');
    expect(c.riga()).toMatch(/^Disponibile · /);
    expect(c.pagina()).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('alle 7 del mattino niente mezz\'ora', async () => {
    const c = await carrelloAlle(7, 0, 'no');
    expect(c.pagina()).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('alle 14 senza fattorino, o col negozio chiuso, niente mezz\'ora', async () => {
    const c = await carrelloAlle(14, 0, 'no');
    expect(c.riga()).toMatch(/^Disponibile · /);
    expect(c.pagina()).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('finché la cassa non risponde, o se la rete cade, non promette nessun tempo', async () => {
    const muta = await carrelloAlle(14, 0, 'muta');
    expect(muta.riga(), 'nessuna risposta: la riga non inventa un tempo').toBe('Disponibile');
    expect(muta.pagina()).not.toContain(EXPRESS_ETA_LABEL);
    schermo?.smonta();
    schermo = null;
    vi.useRealTimers();
    const cade = await carrelloAlle(14, 0, 'cade');
    expect(cade.riga()).toBe('Disponibile');
    expect(cade.pagina()).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('un carrello lasciato aperto attraversa le 21: l\'ora si rilegge da sola', async () => {
    const c = await carrelloAlle(20, 59, 'si');
    expect(c.riga()).toBe(`Disponibile · Consegna in ${EXPRESS_ETA_LABEL}`);
    // Passano due minuti. La cassa risponde ancora sì (risposta vecchia): conta l'orologio.
    vi.setSystemTime(sulTelefono(21, 1));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await assesta();
    expect(c.riga(), 'alle 21:01 la pagina prometteva ancora la mezz\'ora letta alle 20:59').toMatch(/^Disponibile · /);
    expect(c.pagina()).not.toContain(EXPRESS_ETA_LABEL);
  });
});

describe('la riga «Ne restano solo N» dice lo stesso tempo della riga «Disponibile»', () => {
  // Il filone ha scorta piena, la focaccia ne ha 2: due righe dello stesso negozio, due rami diversi.
  const scaffale: Scaffale = [
    { riga: UN_FILONE, scorta: 50 },
    { riga: UNA_FOCACCIA, scorta: 2 },
  ];

  it('alle 14 col sì della cassa: «Ne restano solo 2 · Consegna in …», come «Disponibile»', async () => {
    const c = await carrelloAlle(14, 0, 'si', scaffale);
    expect(c.riga()).toBe(`Disponibile · Consegna in ${EXPRESS_ETA_LABEL}`);
    expect(c.rigaDellaScorta(), 'la riga della scorta bassa non dice il tempo della cassa').toBe(
      `Ne restano solo 2 · Consegna in ${EXPRESS_ETA_LABEL}`,
    );
  });

  it('alle 14 senza fattorino: nessun minuto nemmeno qui, e la coda è quella di «Disponibile»', async () => {
    const c = await carrelloAlle(14, 0, 'no', scaffale);
    const coda = (c.riga() ?? '').replace(/^Disponibile · /, '');
    expect(coda.length, 'la riga «Disponibile» non dice più quando arriva').toBeGreaterThan(0);
    expect(c.rigaDellaScorta(), 'la riga della scorta bassa scrive i minuti a mano').toBe(`Ne restano solo 2 · ${coda}`);
    expect(c.rigaDellaScorta()).not.toContain(EXPRESS_ETA_LABEL);
  });

  it('alle 23, anche con la risposta rimasta quella delle 20:59, niente minuti accanto alla scorta', async () => {
    const c = await carrelloAlle(23, 0, 'si', scaffale);
    expect(c.rigaDellaScorta()).toMatch(/^Ne restano solo 2/);
    expect(c.rigaDellaScorta()).not.toContain(EXPRESS_ETA_LABEL);
  });
});

describe('il primo disegno, quello che arriva dal server, non sa che ore sono', () => {
  const CARRELLO = readFileSync('app/cart/page.tsx', 'utf8');

  it("il disegno del server non promette nessun tempo, e l'ora del carrello parte da null", () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(sulTelefono(14, 0));
    risposta = 'si';
    banco.prodotti = [{ id: UN_FILONE.id, stock: 50, price: UN_FILONE.price }];
    localStorage.setItem('cart', JSON.stringify([UN_FILONE]));
    const dalServer = renderToString(createElement(CartPage));
    expect(dalServer.length, 'il disegno del server è vuoto: la prova non misurerebbe niente').toBeGreaterThan(100);
    expect(dalServer, "l'HTML del server promette un tempo con l'ora del server, non di chi compra").not.toContain(
      EXPRESS_ETA_LABEL,
    );
    // Finché il carrello non è letto, la pagina non mostra righe: un'ora presa dal server non si
    // vedrebbe a occhio. Per questo si guarda anche come nasce lo stato dell'ora, e che senza ora
    // né la riga del prodotto né quella sotto il totale promettano un tempo.
    expect(CARRELLO, "l'ora del carrello deve partire da null, non da `new Date()`").toMatch(
      /\[oraDiAdesso, setOraDiAdesso\] = useState<number \| null>\(null\)/,
    );
    expect(CARRELLO, 'senza ora la riga sotto il totale non deve promettere niente').toMatch(/oraDiAdesso === null \? null/);
    expect(rigaQuandoArrivaNelCarrello(null, true), 'senza ora la riga del prodotto non deve promettere niente').toBeNull();
  });

  it("nel browser, letta l'ora, la frase della consegna arriva", async () => {
    const c = await carrelloAlle(14, 0, 'si');
    expect(c.riga()).toBe(`Disponibile · Consegna in ${EXPRESS_ETA_LABEL}`);
  });
});

describe('il carrello legge lo stesso orologio della cassa, su qualunque telefono', () => {
  const fusoDiPartenza = process.env.TZ;
  afterEach(() => {
    if (fusoDiPartenza === undefined) delete process.env.TZ;
    else process.env.TZ = fusoDiPartenza;
  });

  /** Lo scarto dal tempo universale di ogni fuso il 30/10/2026, in minuti come li dà `getTimezoneOffset`. */
  const SCARTO: Record<string, number> = { 'Europe/Rome': -60, 'Europe/Bucharest': -120, 'Europe/London': 0 };

  /** Un istante visto da un telefono col fuso detto. */
  function telefonoA(fuso: string, istanteUtc: string): Date {
    process.env.TZ = fuso;
    const istante = new Date(istanteUtc);
    expect(istante.getTimezoneOffset(), `il fuso ${fuso} non ha preso: la prova non misurerebbe niente`).toBe(SCARTO[fuso]);
    return istante;
  }

  /**
   * La cassa, un tocco dopo il carrello, allo stesso istante e con la stessa risposta della veloce:
   * offre «Adesso»? Si monta il riquadro vero della cassa, non una copia della sua regola.
   */
  async function laCassaOffreAdesso(veloceDisponibile: boolean): Promise<boolean> {
    const cassa = accendi(DeliverySlotPicker, {
      day: 'today',
      onDayChange: () => undefined,
      todayTime: '',
      onTodayTimeChange: () => undefined,
      tomorrowTime: '',
      onTomorrowTimeChange: () => undefined,
      veloceDisponibile,
      prezzoVeloce: '+1 €',
    });
    try {
      await assesta();
      const adesso = cassa.radice.querySelector<HTMLButtonElement>('button[aria-label^="Adesso,"]');
      expect(adesso, 'il riquadro «Adesso» della cassa non si trova: la prova non misurerebbe niente').not.toBeNull();
      return !adesso!.disabled;
    } finally {
      cassa.smonta();
    }
  }

  /** Il carrello e la cassa allo stesso istante, col sì della veloce: chi promette la mezz'ora? */
  async function carrelloECassa(fuso: string, istanteUtc: string) {
    const istante = telefonoA(fuso, istanteUtc);
    const carrello = await carrelloAllIstante(istante, 'si');
    const promette = carrello.pagina().includes(EXPRESS_ETA_LABEL);
    const offre = await laCassaOffreAdesso(true);
    schermo?.smonta();
    schermo = null;
    localStorage.clear();
    vi.useRealTimers();
    return { promette, offre };
  }

  it('Bucarest alle 21:30 (a Roma le 20:30): il carrello non promette la mezz\'ora che la cassa non offre', async () => {
    expect(romeNow(new Date('2026-10-30T19:30:00Z')).getHours(), 'a Roma sono le 20: il caso è quello giusto').toBe(20);
    const { promette, offre } = await carrelloECassa('Europe/Bucharest', '2026-10-30T19:30:00Z');
    expect(offre, 'la cassa legge l\'ora del telefono: alle 21:30 «Adesso» è spento').toBe(false);
    expect(promette, 'il carrello scrive «Consegna in 30-60 min» e la cassa, un tocco dopo, parte da una fascia').toBe(false);
  });

  // Gli istanti intorno alle due porte della veloce: le 8 e le 21, viste da tre telefoni diversi.
  const ISTANTI = [
    '2026-10-30T05:30:00Z',
    '2026-10-30T06:30:00Z',
    '2026-10-30T07:30:00Z',
    '2026-10-30T13:00:00Z',
    '2026-10-30T18:30:00Z',
    '2026-10-30T19:30:00Z',
    '2026-10-30T20:30:00Z',
  ];
  for (const fuso of Object.keys(SCARTO)) {
    it(`un telefono col fuso ${fuso}: a ogni ora il carrello promette la veloce solo se la cassa la offre`, async () => {
      const esiti: string[] = [];
      for (const istanteUtc of ISTANTI) {
        const { promette, offre } = await carrelloECassa(fuso, istanteUtc);
        esiti.push(`${istanteUtc} carrello ${promette ? 'promette' : 'tace'} · cassa ${offre ? 'offre' : 'spenta'}`);
      }
      const discordi = esiti.filter((e) => /promette · cassa spenta|tace · cassa offre/.test(e));
      expect(discordi, 'carrello e cassa dicono due cose diverse allo stesso istante').toEqual([]);
      // Non passa per pigrizia: in ogni fuso c'è almeno un'ora con la veloce e una senza.
      expect(esiti.some((e) => e.includes('cassa offre')), esiti.join('\n')).toBe(true);
      expect(esiti.some((e) => e.includes('cassa spenta')), esiti.join('\n')).toBe(true);
    }, 20_000);
  }
});

// Finito il file, la rete torna chiusa come la lascia _setup.ts.
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});
