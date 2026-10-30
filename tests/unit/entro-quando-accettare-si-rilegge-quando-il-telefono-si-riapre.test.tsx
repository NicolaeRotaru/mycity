/**
 * 30/10/2026 (collaudo dell'ondata 20) — «ENTRO QUANDO ACCETTARE» DOPO LA NOTTE COL TELEFONO BLOCCATO.
 *
 * Le due pagine ordini del negozio scrivono la riga «Accettalo o rifiutalo entro …» con l'ora
 * dell'ultima lettura (`dataUpdatedAt`/`errorUpdatedAt`). Con il telefono bloccato la ricarica
 * automatica si ferma (`refetchIntervalInBackground: false`), e al ritorno sulla pagina non si
 * rileggeva niente (`refetchOnWindowFocus: false` nel QueryProvider): il negoziante che venerdì
 * alle 20:30 aveva lasciato la pagina aperta, sabato alle 8:30 leggeva ancora «entro le 12:00 di
 * domani» — per un ordine che scade quella mattina — fino al giro dopo (90 secondi sulla lista).
 *
 * La prova non copia nessuna opzione: rende le pagine VERE dentro il QueryProvider VERO, si fa
 * dare le opzioni che la pagina passa alla lettura degli ordini, e le fa girare in un osservatore
 * vero di React Query. Poi nasconde la pagina e la riapre come fa il telefono.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  focusManager,
  InfiniteQueryObserver,
  QueryObserver,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import QueryProvider from '@/components/providers/QueryProvider';
import SellerOrdersPage from '@/app/seller/orders/page';
import SellerOrderDetailPage from '@/app/seller/orders/[id]/page';
import { queryKeys } from '@/lib/queries/keys';
import { rigaScadenzaPerIlNegozio } from '@/lib/ordini/scadenza-accettazione';

const { catturate, Catturato } = vi.hoisted(() => {
  class Catturato extends Error {}
  return { catturate: [] as Array<Record<string, unknown>>, Catturato };
});

// Le letture della pagina non partono: si prendono le opzioni che la pagina passa e si ferma il
// disegno. Tutto il resto di React Query (client, osservatori, focus) è quello vero.
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  const cattura = (opzioni: Record<string, unknown>) => {
    catturate.push(opzioni);
    throw new Catturato('opzioni della lettura prese');
  };
  return { ...vero, useQuery: cattura, useInfiniteQuery: cattura };
});

// React 18 nei test non ha `use`: la pagina del dettaglio lo usa solo per leggere i parametri.
vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});

const ID = '11111111-2222-3333-4444-555555555555';

// Venerdì 30/10/2026 alle 20:30 di Piacenza (UTC+1): ordine per «Domani · 9:00–12:00».
const ORDINE = {
  id: ID,
  delivery_status: 'NEW',
  created_at: '2026-10-30T19:30:00.000Z',
  delivery_slot: 'Domani · 9:00–12:00',
  pickup_in_store: false,
  total_price: 12,
  order_items: [],
};

type Pagina = { nome: string; infinita: boolean; chiave: readonly unknown[]; rendi: () => JSX.Element };

const PAGINE: Pagina[] = [
  {
    nome: 'la lista ordini',
    infinita: true,
    chiave: queryKeys.seller.orders,
    rendi: () => <SellerOrdersPage />,
  },
  {
    nome: 'il dettaglio ordine',
    infinita: false,
    chiave: queryKeys.seller.order(ID),
    rendi: () => (
      <SellerOrderDetailPage params={{ valore: { id: ID } } as unknown as Promise<{ id: string }>} />
    ),
  },
];

/** Rende la pagina vera nel provider vero; restituisce il client del provider e le opzioni lette. */
function apri(pagina: Pagina): { client: QueryClient; opzioni: Record<string, unknown> } {
  catturate.length = 0;
  let client: QueryClient | null = null;
  function Prendi() {
    client = useQueryClient();
    return null;
  }
  expect(() =>
    renderToString(
      <QueryProvider>
        <Prendi />
        {pagina.rendi()}
      </QueryProvider>,
    ),
  ).toThrow(Catturato);
  const opzioni = catturate.find((o) => JSON.stringify(o.queryKey) === JSON.stringify(pagina.chiave));
  expect(opzioni, `${pagina.nome}: la lettura degli ordini non si trova`).toBeTruthy();
  expect(client).toBeTruthy();
  return { client: client as unknown as QueryClient, opzioni: opzioni as Record<string, unknown> };
}

/** Apre la pagina all'ora data, la nasconde per `nascostoMs`, la riapre: cosa legge il negoziante. */
async function riapri(pagina: Pagina, apertaAlle: string, nascostoMs: number) {
  vi.setSystemTime(new Date(apertaAlle));
  const { client, opzioni } = apri(pagina);
  client.mount(); // quello che fa QueryClientProvider nel browser
  let letture = 0;
  const queryFn = async () => {
    letture += 1;
    return pagina.infinita ? [ORDINE] : ORDINE;
  };
  const osservatore = pagina.infinita
    ? new InfiniteQueryObserver(client, { ...opzioni, queryFn } as never)
    : new QueryObserver(client, { ...opzioni, queryFn } as never);
  const smetti = osservatore.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(10);
  const lettureAllApertura = letture;

  focusManager.setFocused(false); // schermo bloccato
  await vi.advanceTimersByTimeAsync(nascostoMs);
  const lettureDaNascosta = letture;

  focusManager.setFocused(true); // il telefono si riapre
  await vi.advanceTimersByTimeAsync(50);
  const r = osservatore.getCurrentResult();
  // La stessa formula delle due pagine.
  const lettoAlle = new Date(Math.max(r.dataUpdatedAt, r.errorUpdatedAt) || Date.now());
  const adesso = new Date();

  smetti();
  client.unmount();
  client.clear();
  return { lettureAllApertura, lettureDaNascosta, letture, lettoAlle, adesso };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('«entro quando accettare» si riscrive quando il telefono si riapre', () => {
  for (const pagina of PAGINE) {
    it(`${pagina.nome}: lasciata aperta venerdì alle 20:30, sabato alle 8:30 dice «di oggi», non «di domani»`, async () => {
      const r = await riapri(pagina, '2026-10-30T19:30:05.000Z', 12 * 3_600_000 + 5_000);
      expect(r.lettureAllApertura).toBe(1);
      // Da bloccato il telefono non legge (risparmio batteria e traffico): resta così.
      expect(r.lettureDaNascosta).toBe(1);
      // Alla riapertura si rilegge subito, non al giro dopo.
      expect(r.letture).toBe(2);
      expect(r.adesso.getTime() - r.lettoAlle.getTime()).toBeLessThan(1_000);
      const riga = rigaScadenzaPerIlNegozio(ORDINE, r.lettoAlle);
      expect(riga).toBe(rigaScadenzaPerIlNegozio(ORDINE, r.adesso));
      expect(riga).toContain('12:00 di oggi');
    });

    it(`${pagina.nome}: nascosta 4,4 secondi a cavallo della fine della fascia, al ritorno dice che è finita`, async () => {
      // Sabato 31/10 alle 11:59:57 di Piacenza; si riapre alle 12:00:01,4.
      const r = await riapri(pagina, '2026-10-31T10:59:57.000Z', 4_400);
      expect(r.lettureDaNascosta).toBe(1);
      expect(r.letture).toBe(2);
      expect(r.adesso.getTime() - r.lettoAlle.getTime()).toBeLessThan(1_000);
      const riga = rigaScadenzaPerIlNegozio(ORDINE, r.lettoAlle);
      expect(riga).toBe(rigaScadenzaPerIlNegozio(ORDINE, r.adesso));
      // Alle 12:00 finiscono insieme la fascia e il tempo per accettare: la riga lo dice.
      expect(riga).toContain('Il tempo per accettarlo è finito');
    });
  }
});
