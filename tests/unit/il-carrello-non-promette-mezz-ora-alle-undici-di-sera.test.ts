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
 * ⚠️ Cosa NON prova: un browser vero (qui c'è jsdom) né la rotta /api/consegna/veloce, che qui è
 * finta: la sua regola la prova `la-consegna-veloce-si-vende-solo-se-c-e-un-fattorino`.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act } from 'react';
import { EXPRESS_ETA_LABEL } from '@/lib/delivery';
import {
  APERTURA_EXPRESS,
  CHIUSURA_EXPRESS,
  expressSiPuo,
  giornoDiPartenza,
} from '@/lib/quando-arriva';
import CartPage from '@/app/cart/page';
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
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'chiave-finta';
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
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

/** Il carrello con un filone di Pane Quotidiano, aperto all'ora detta, con la risposta detta. */
async function carrelloAlle(ore: number, minuti: number, r: Risposta) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, ore, minuti));
  risposta = r;
  banco.prodotti = [{ id: UN_FILONE.id, stock: 50, price: UN_FILONE.price }];
  localStorage.setItem('cart', JSON.stringify([UN_FILONE]));
  schermo = accendi(CartPage);
  await assesta();
  const s = schermo;
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
    riga: () =>
      [...s.radice.querySelectorAll('p')]
        .map((p) => (p.textContent ?? '').trim())
        .find((t) => t.startsWith('Disponibile')),
  };
}

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
    vi.setSystemTime(new Date(2026, 9, 30, 21, 1));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await assesta();
    expect(c.riga(), 'alle 21:01 la pagina prometteva ancora la mezz\'ora letta alle 20:59').toMatch(/^Disponibile · /);
    expect(c.pagina()).not.toContain(EXPRESS_ETA_LABEL);
  });
});

// Finito il file, la rete torna chiusa come la lascia _setup.ts.
afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});
