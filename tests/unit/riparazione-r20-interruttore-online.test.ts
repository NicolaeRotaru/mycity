/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { contrasto, SOGLIA_TESTO } from '@/lib/design/contrasto';
import { colore } from './aiuti/tavolozza-del-sito';

/**
 * R20-002 — Sulla bacheca del fattorino:
 *  · l'interruttore online era alto 32 px (58×32): un pollice in strada sbaglia il tocco;
 *  · le consegne «in preparazione» avevano `opacity-75`: targhetta e compenso sotto 4,5:1;
 *  · senza rete, toccando l'interruttore la richiesta restava in pausa: grigio, nessun messaggio,
 *    e poi si accendeva da solo quando la rete tornava.
 *
 * La pagina si monta col react-query vero.
 */

const mondo = vi.hoisted(() => ({
  rete: true,
  scritture: 0,
  toastErrori: [] as string[],
}));

vi.mock('sonner', () => ({
  toast: { error: (m: string) => { mondo.toastErrori.push(m); }, success: () => {} },
}));
vi.mock('next-intl', () => import('./aiuti/finti/next-intl.mjs'));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: { href: string; children: unknown }) => ce('a', { href, ...r }, children as never) };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { full_name: 'Luca Verdi' }, userEmail: null }),
}));
vi.mock('@/lib/analytics/events', async (vero) => ({
  ...(await vero<typeof import('@/lib/analytics/events')>()),
  trackErrorShown: () => {},
}));
vi.mock('@/lib/supabase/client', () => {
  // Senza rete supabase-js non lancia: risponde con un errore «Failed to fetch».
  const SENZA_RETE = { message: 'TypeError: Failed to fetch', code: '' };
  const catena = (tavola: string) => {
    let scrive = false;
    const risposta = () => {
      if (scrive) {
        mondo.scritture += 1;
        return mondo.rete ? { data: null, error: null } : { data: null, error: SENZA_RETE };
      }
      if (tavola === 'ordini_disponibili_rider') {
        return {
          data: [{
            id: 'dddddddd-4444-4444-8444-dddddddddddd', seller_id: 'n-frutta', store_name: 'Frutta Bella',
            store_address: 'Via Roma 3', delivery_city: 'Piacenza', delivery_zip: '29121', delivery_status: 'ACCEPTED',
            payment_method: 'card', total_price: 18, shipping_cost: 3, rider_fee_cents: 300, delivery_slot: null,
            articoli: 2, created_at: '2026-11-13T09:00:00Z',
          }],
          error: null,
        };
      }
      if (tavola === 'profiles') return { data: { rider_is_online: true, rider_zones: [] }, error: null };
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'limit']) c[m] = () => c;
    c.update = () => { scrive = true; return c; };
    c.single = async () => risposta();
    c.maybeSingle = async () => risposta();
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
    return c;
  };
  return {
    supabase: {
      from: catena,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        // Anche chiedere chi è collegato passa dalla rete.
        getUser: async () => (mondo.rete
          ? { data: { user: { id: 'luca' } }, error: null }
          : { data: { user: null }, error: { message: 'Failed to fetch', status: 0, name: 'AuthRetryableFetchError' } }),
      },
    },
  };
});

const { default: Bacheca } = await import('@/app/rider/page');

let radice: Root | null = null;
let div: HTMLDivElement | null = null;

const gira = async (volte = 10) => {
  for (let i = 0; i < volte; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
};

async function accendi() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  div = document.createElement('div');
  document.body.appendChild(div);
  radice = createRoot(div);
  await act(async () => {
    radice!.render(createElement(QueryClientProvider, { client: qc }, createElement(Bacheca as never)));
  });
  await gira();
  return div;
}

/** L'altezza che una lista di classi Tailwind dà a un elemento, in pixel (h-N = N×4 px). */
const altezza = (classi: string): number => {
  const libera = classi.match(/(?:^|\s)(?:min-)?h-\[(\d+)px\]/);
  if (libera) return Number(libera[1]);
  const scala = classi.match(/(?:^|\s)h-(\d+(?:\.5)?)(?:\s|$)/);
  return scala ? Number(scala[1]) * 4 : 0;
};

/** Il prodotto delle opacità dichiarate dall'elemento in su, fino a `fino` compreso. */
const opacita = (el: Element, fino: Element): number => {
  let a = 1;
  for (let n: Element | null = el; n; n = n.parentElement) {
    for (const m of (n.getAttribute('class') ?? '').matchAll(/(?:^|\s)opacity-(\d+)(?=\s|$)/g)) a *= Number(m[1]) / 100;
    if (n === fino) break;
  }
  return a;
};

/** Un colore visto con un'opacità sopra uno sfondo. */
const sopra = (testo: string, sfondo: string, alfa: number): string => {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [t, s] = [c(testo), c(sfondo)];
  return `#${t.map((v, i) => Math.round(alfa * v + (1 - alfa) * s[i]).toString(16).padStart(2, '0')).join('')}`;
};

const toneDi = (classi: string, prefisso: 'text' | 'bg') =>
  (classi.match(new RegExp(`(?:^|\\s)${prefisso}-([a-z]+-\\d+)(?=\\s|$)`)) ?? [])[1];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mondo.rete = true;
  mondo.scritture = 0;
  mondo.toastErrori = [];
  onlineManager.setOnline(true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ incassi: [] }), { status: 200 })));
});

afterEach(async () => {
  await act(async () => { radice?.unmount(); });
  div?.remove();
  radice = null;
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

describe('R20-002 — l’interruttore online e le consegne in preparazione', () => {
  it('l’interruttore online è alto almeno 44 px', async () => {
    const d = await accendi();
    const interruttore = d.querySelector('button[role="switch"]');
    expect(interruttore, 'l’interruttore non c’è: la prova girerebbe a vuoto').toBeTruthy();
    expect(altezza(interruttore!.getAttribute('class') ?? ''), 'l’interruttore è più basso di 44 px').toBeGreaterThanOrEqual(44);
  }, 30000);

  it('sulle consegne in preparazione compenso e targhetta si leggono (almeno 4,5:1)', async () => {
    const d = await accendi();
    const targhetta = Array.from(d.querySelectorAll('span')).find((s) => (s.textContent ?? '').trim() === 'In preparazione');
    expect(targhetta, 'la consegna in preparazione non si è disegnata').toBeTruthy();
    const scheda = targhetta!.closest('div.rounded-xl')!;
    const compenso = Array.from(scheda.querySelectorAll('span')).find((s) => /€/.test(s.textContent ?? ''))!;
    expect(compenso, 'il compenso della consegna in preparazione non c’è').toBeTruthy();

    const fondoScheda = colore(toneDi(scheda.getAttribute('class') ?? '', 'bg')!);
    const testoCompenso = colore(toneDi(compenso.getAttribute('class') ?? '', 'text')!);
    const rapportoCompenso = contrasto(sopra(testoCompenso, fondoScheda, opacita(compenso, scheda)), fondoScheda);
    expect(rapportoCompenso, `il compenso si legge a ${rapportoCompenso.toFixed(2)}:1`).toBeGreaterThanOrEqual(SOGLIA_TESTO);

    const classiTarghetta = targhetta!.getAttribute('class') ?? '';
    const fondoTarghetta = colore(toneDi(classiTarghetta, 'bg')!);
    const testoTarghetta = colore(toneDi(classiTarghetta, 'text')!);
    const alfa = opacita(targhetta!, scheda);
    const rapportoTarghetta = contrasto(sopra(testoTarghetta, fondoScheda, alfa), sopra(fondoTarghetta, fondoScheda, alfa));
    expect(rapportoTarghetta, `la targhetta si legge a ${rapportoTarghetta.toFixed(2)}:1`).toBeGreaterThanOrEqual(SOGLIA_TESTO);
  }, 30000);

  it('senza rete, toccato l’interruttore, avvisa subito che la richiesta non è partita', async () => {
    const d = await accendi();
    const interruttore = d.querySelector('button[role="switch"]') as HTMLButtonElement;
    expect(interruttore.getAttribute('aria-checked')).toBe('true');

    mondo.rete = false;
    onlineManager.setOnline(false);
    await act(async () => { interruttore.click(); });
    await gira();

    expect(mondo.toastErrori, 'senza rete nessun messaggio: il fattorino non sa se è online').toHaveLength(1);
    expect(mondo.toastErrori[0]).toMatch(/connessione|rete/i);
    expect(mondo.toastErrori[0], 'senza rete gli si dice che non è autenticato').not.toMatch(/autenticat/i);
    expect(interruttore.disabled, 'l’interruttore resta grigio, in attesa di una rete che non c’è').toBe(false);

    // Torna la rete: niente cambi «da soli» alle spalle del fattorino.
    mondo.rete = true;
    await act(async () => { onlineManager.setOnline(true); });
    await gira();
    expect(mondo.scritture, 'tornata la rete, l’interruttore si è cambiato da solo').toBe(0);
  }, 30000);
});
