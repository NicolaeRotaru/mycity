/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MutationObserver, QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R15-013 — Tre tocchi veloci sul cuore, la rete che consegna le richieste in disordine.
 *
 * In palestra (7/11): prodotto non fra i preferiti, tre tocchi a 120 ms l'uno dall'altro, richieste
 * ritardate di 200, 2.500 e 200 ms. Partivano tutte e tre insieme: POST 201, POST 409 (il terzo
 * tocco trova la riga ancora lì), DELETE 204 in ritardo. Il 409 diventava errore, il cuore si
 * ribaltava, poi il DELETE cancellava la riga: cuore vuoto e niente preferito, con l'ultimo tocco
 * «aggiungi».
 *
 * Qui gira l'aggancio vero (`useFavorites`) con un finto server che applica ogni richiesta quando
 * «arriva», dopo il suo ritardo, e rifiuta il doppione come Postgres (23505). L'orologio è finto.
 */

const server = vi.hoisted(() => {
  const stato = {
    righe: new Set<string>(),
    /** I ritardi delle prossime richieste di scrittura, nell'ordine in cui partono. */
    ritardi: [] as number[],
    /** Le scritture nell'ordine in cui il server le ha applicate. */
    arrivate: [] as string[],
  };
  const chiave = (u: unknown, p: unknown) => `${String(u)}|${String(p)}`;
  const attesa = () => {
    const ms = stato.ritardi.shift() ?? 0;
    return new Promise<void>((r) => setTimeout(r, ms));
  };
  const promessa = <T,>(fn: () => Promise<T>) => ({
    then: (ok: (v: T) => unknown, ko?: (e: unknown) => unknown) => fn().then(ok, ko),
  });
  const supabase = {
    from: (_tabella: string) => ({
      select: (_c: string) => ({
        eq: (_col: string, utente: string) =>
          promessa(async () => ({
            data: [...stato.righe].filter((k) => k.startsWith(`${utente}|`)).map((k) => ({ product_id: k.split('|')[1] })),
            error: null,
          })),
      }),
      insert: (r: { user_id: string; product_id: string }) =>
        promessa(async () => {
          await attesa();
          const k = chiave(r.user_id, r.product_id);
          if (stato.righe.has(k)) {
            stato.arrivate.push('POST 409');
            return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          stato.righe.add(k);
          stato.arrivate.push('POST 201');
          return { error: null };
        }),
      delete: () => ({
        eq: (_c1: string, utente: string) => ({
          eq: (_c2: string, prodotto: string) =>
            promessa(async () => {
              await attesa();
              stato.righe.delete(chiave(utente, prodotto));
              stato.arrivate.push('DELETE 204');
              return { error: null };
            }),
        }),
      }),
    }),
  };
  return { stato, supabase };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: server.supabase }));
vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => 'cliente-1' }));
vi.mock('@/lib/analytics/events', () => ({ trackFavoriteAdded: () => {} }));

const { useFavorites } = await import('@/components/hooks/useFavorites');
const { CHIAVE_PREFERITI, opzioniDelTocco } = await import('@/lib/preferiti/tocco-del-cuore');

const PRODOTTO = 'prodotto-7';

let radice: Root;
let contenitore: HTMLDivElement;
let qc: QueryClient;
let gancio: ReturnType<typeof useFavorites>;

function Sonda() {
  gancio = useFavorites();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  server.stato.righe.clear();
  server.stato.ritardi.length = 0;
  server.stato.arrivate.length = 0;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  radice = createRoot(contenitore);
});
afterEach(() => {
  act(() => radice.unmount());
  contenitore.remove();
  qc.clear();
  vi.useRealTimers();
});

/** Monta l'aggancio con la lista già letta: quella del server in questo momento. */
async function monta(inCache: string[]) {
  qc.setQueryData(CHIAVE_PREFERITI, new Set(inCache));
  await act(async () => {
    radice.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda)));
  });
}

const cuorePieno = () => qc.getQueryData<Set<string>>(CHIAVE_PREFERITI)?.has(PRODOTTO);

describe('R15-013 — tre tocchi veloci con le richieste in disordine', () => {
  it('l’ultimo tocco «aggiungi» vince: cuore pieno, riga nel database, nessun errore', async () => {
    await monta([]);
    server.stato.ritardi.push(200, 2500, 200);
    const errori: unknown[] = [];
    const tocca = () => {
      void gancio.toggle.mutateAsync(PRODOTTO).catch((e: unknown) => errori.push(e));
    };

    await act(async () => {
      tocca(); // aggiungi
      await vi.advanceTimersByTimeAsync(120);
      tocca(); // togli
      await vi.advanceTimersByTimeAsync(120);
      tocca(); // aggiungi
    });
    expect(cuorePieno(), 'subito dopo il terzo tocco il cuore è pieno').toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(errori, '«Non sono riuscito a salvare il preferito» con un salvataggio riuscito').toEqual([]);
    expect(server.stato.righe.has(`cliente-1|${PRODOTTO}`), 'la rimozione in ritardo ha cancellato il preferito').toBe(true);
    expect(cuorePieno(), 'cuore vuoto anche se l’ultimo tocco era «aggiungi»').toBe(true);
    expect(server.stato.arrivate, 'le scritture sullo stesso prodotto arrivano nell’ordine dei tocchi').toEqual([
      'POST 201',
      'DELETE 204',
      'POST 201',
    ]);
  });

  it('una riga che c’è già (409) è un preferito salvato, non un errore', async () => {
    // Salvato da un'altra scheda: il database ce l'ha, la lista in mano no.
    server.stato.righe.add(`cliente-1|${PRODOTTO}`);
    await monta([]);
    let errore: unknown = null;
    await act(async () => {
      const tocco = gancio.toggle.mutateAsync(PRODOTTO).catch((e: unknown) => {
        errore = e;
      });
      await vi.advanceTimersByTimeAsync(1000);
      await tocco;
    });
    expect(errore, 'il doppione diventa «non sono riuscito a salvare»').toBeNull();
    expect(cuorePieno(), 'il cuore si ribalta su un preferito che è salvato').toBe(true);
    expect(server.stato.righe.has(`cliente-1|${PRODOTTO}`)).toBe(true);
  });
});

describe('R15-013 — un rifiuto a metà fila non ribalta il cuore scelto dopo', () => {
  it('aggiungi, togli rifiutato, aggiungi: fra il rifiuto e l’ultima risposta il cuore resta pieno', async () => {
    const q = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    q.setQueryData(CHIAVE_PREFERITI, new Set<string>());
    const risposte: Array<{ verso: string; rispondi: (e?: Error) => void }> = [];
    const opzioni = opzioniDelTocco(q, (_id, verso) =>
      new Promise<void>((ok, ko) => {
        risposte.push({ verso, rispondi: (e) => (e ? ko(e) : ok()) });
      }),
    );
    const osservatore = new MutationObserver(q, opzioni);
    const tocca = () => osservatore.mutate(PRODOTTO).catch((e: unknown) => e);
    const pieno = () => q.getQueryData<Set<string>>(CHIAVE_PREFERITI)?.has(PRODOTTO);

    const t1 = tocca();
    const t2 = tocca();
    const t3 = tocca();
    await vi.advanceTimersByTimeAsync(0);
    expect(pieno()).toBe(true);
    expect(risposte.map((r) => r.verso), 'una scrittura alla volta sullo stesso prodotto').toEqual(['aggiungi']);

    risposte[0].rispondi();
    await vi.advanceTimersByTimeAsync(0);
    expect(risposte.map((r) => r.verso)).toEqual(['aggiungi', 'togli']);

    risposte[1].rispondi(new Error('rete caduta'));
    await vi.advanceTimersByTimeAsync(0);
    expect(pieno(), 'il rifiuto del secondo tocco ha svuotato il cuore scelto col terzo').toBe(true);
    expect(risposte.map((r) => r.verso)).toEqual(['aggiungi', 'togli', 'aggiungi']);

    risposte[2].rispondi();
    await Promise.all([t1, t2, t3]);
    expect(pieno()).toBe(true);
  });
});
