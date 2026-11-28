/**
 * @vitest-environment jsdom
 */
/**
 * 28/11/2026 — L'ADMIN CHE APRIVA UNA NOTIFICA FINIVA NEL PANNELLO DEL NEGOZIO.
 *
 * Nicola, dal telefono, alle 15:45: entrato come amministratore, preme la campanella, preme la notifica
 * e «mi manda nella versione venditore». Nel database l'avviso «Ordine di servizio per SDG: …» va solo
 * agli amministratori, ma portava a /seller/ordini-sdg: la pagina del negozio SDG, col guscio e il menu
 * del venditore. Tre notifiche così erano già scritte (PROVA SDG, Raquel Cafè, Movida Cafè).
 *
 * La prova monta la campanella VERA col react-query vero e un database finto, apre la tendina e guarda
 * dove porta la notifica: per l'admin nella pagina dell'admin, per il negozio dove portava prima.
 * E controlla la regola da sola, sui casi scomodi (la coda dell'indirizzo, «/sellers», un percorso che
 * nell'admin non ha la gemella).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { indirizzoDellaNotifica } from '@/lib/notifiche/indirizzo-per-chi-apre';

type Riga = Record<string, unknown>;

const mondo = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  ruolo: 'admin' as 'admin' | 'seller',
}));

/** Un pezzetto di PostgREST: quello che legge la campanella. */
function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let soloConto = false;
  let ordine: string | null = null;
  let limite = Infinity;
  const righe = () => {
    const tutte = (mondo.tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
    if (ordine) tutte.sort((a, b) => String(b[ordine!]).localeCompare(String(a[ordine!])));
    return tutte.slice(0, limite);
  };
  const q = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { soloConto = !!o?.head; return q; },
    update: () => q,
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    neq: (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return q; },
    order: (c: string) => { ordine = c; return q; },
    limit: (n: number) => { limite = n; return q; },
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(soloConto ? { count: righe().length, error: null } : { data: righe(), error: null }).then(ok, ko),
  };
  return q;
}

vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: ({ href, children, onClick, ...r }: Record<string, unknown>) =>
      ce('a', {
        href: String(href),
        ...r,
        onClick: (e: MouseEvent) => { e.preventDefault(); (onClick as ((e: MouseEvent) => void) | undefined)?.(e); },
      }, children as never),
  };
});
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: (t: string) => tabella(t) } }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u-1', role: mondo.ruolo },
    isAuthenticated: true,
    isAdmin: mondo.ruolo === 'admin',
    isSeller: mondo.ruolo === 'seller',
  }),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: CampanellaConTendina } = await import('@/components/account/CampanellaConTendina');

let smonta: (() => void) | null = null;
afterEach(() => {
  smonta?.();
  smonta = null;
  mondo.tabelle = {};
});

const ora = Date.now();
const fa = (min: number) => new Date(ora - min * 60_000).toISOString();

async function apriCampanella() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(CampanellaConTendina, { userId: 'u-1', idPannello: 'pannello-notifiche-admin' })));
  });
  smonta = () => { act(() => root.unmount()); div.remove(); };
  await act(async () => {
    div.querySelector('button[aria-haspopup="dialog"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  for (let i = 0; i < 20 && !div.querySelector('[aria-label="Ultime notifiche"]'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  return div.querySelector('#pannello-notifiche-admin') as HTMLElement;
}

/** Il link della voce col titolo dato. */
function linkDi(pannello: HTMLElement, titolo: string): string | null {
  const voce = Array.from(pannello.querySelectorAll('li a')).find((a) => a.textContent?.includes(titolo));
  return voce?.getAttribute('href') ?? null;
}

describe("la campanella dell'admin non porta nel pannello del negozio", () => {
  it("l'avviso dell'ordine di servizio di SDG già scritto col link vecchio apre la pagina dell'admin", async () => {
    mondo.ruolo = 'admin';
    mondo.tabelle.profiles = [{ id: 'u-1', notif_promos: false }];
    mondo.tabelle.notifications = [
      // Le righe vere del 28/11, col link com'è nel database.
      { id: 'n1', user_id: 'u-1', title: 'Ordine di servizio per SDG: Movida Cafè', body: null, link: '/seller/ordini-sdg', is_read: false, category: 'system', created_at: fa(3) },
      { id: 'n2', user_id: 'u-1', title: 'Movida Cafè ha accettato il preventivo', body: null, link: '/admin/preventivi', is_read: false, category: 'system', created_at: fa(4) },
      { id: 'n3', user_id: 'u-1', title: 'Nuova richiesta di assistenza', body: null, link: '/messages/4c7b', is_read: true, category: 'system', created_at: fa(60) },
    ];
    const pannello = await apriCampanella();
    expect(pannello).not.toBeNull();
    expect(linkDi(pannello, 'Ordine di servizio per SDG')).toBe('/admin/ordini-sdg');
    // Quelle che portavano già nel posto giusto restano come sono.
    expect(linkDi(pannello, 'ha accettato il preventivo')).toBe('/admin/preventivi');
    expect(linkDi(pannello, 'Nuova richiesta di assistenza')).toBe('/messages/4c7b');
    // Nessuna voce della tendina apre l'area negozio.
    for (const a of Array.from(pannello.querySelectorAll('a'))) expect(a.getAttribute('href')).not.toMatch(/^\/seller(\/|$)/);
  });

  it('per il negozio la stessa campanella porta dove portava prima', async () => {
    mondo.ruolo = 'seller';
    mondo.tabelle.profiles = [{ id: 'u-1', notif_promos: false }];
    mondo.tabelle.notifications = [
      { id: 'n1', user_id: 'u-1', title: 'Nuovo ordine #1042', body: null, link: '/seller/orders/1042', is_read: false, category: 'order', created_at: fa(3) },
    ];
    const pannello = await apriCampanella();
    expect(linkDi(pannello, 'Nuovo ordine #1042')).toBe('/seller/orders/1042');
  });
});

describe('la regola: dove porta una notifica, secondo chi la apre', () => {
  const admin = { isAdmin: true };
  const negozio = { isAdmin: false };

  it("per l'admin le pagine del negozio con la gemella vanno alla gemella", () => {
    expect(indirizzoDellaNotifica('/seller/ordini-sdg', admin)).toBe('/admin/ordini-sdg');
    expect(indirizzoDellaNotifica('/seller/ordini-sdg/', admin)).toBe('/admin/ordini-sdg');
    expect(indirizzoDellaNotifica('/seller/ordini-sdg?id=7#sopra', admin)).toBe('/admin/ordini-sdg?id=7#sopra');
    expect(indirizzoDellaNotifica('/seller/orders/abc-123', admin)).toBe('/admin/orders/abc-123');
    expect(indirizzoDellaNotifica('/seller/orders', admin)).toBe('/admin/orders');
    expect(indirizzoDellaNotifica('/seller/products/9/edit', admin)).toBe('/admin/products');
  });

  it("per l'admin una pagina del negozio senza gemella porta al cruscotto dell'admin, mai nel negozio", () => {
    expect(indirizzoDellaNotifica('/seller/dashboard', admin)).toBe('/admin');
    expect(indirizzoDellaNotifica('/seller', admin)).toBe('/admin');
    expect(indirizzoDellaNotifica('/seller?tab=1', admin)).toBe('/admin');
  });

  it('non tocca quello che non è area negozio, né i link di chi non è admin', () => {
    expect(indirizzoDellaNotifica('/sellers/roma', admin)).toBe('/sellers/roma');
    expect(indirizzoDellaNotifica('/admin/preventivi', admin)).toBe('/admin/preventivi');
    expect(indirizzoDellaNotifica('/orders/1', admin)).toBe('/orders/1');
    expect(indirizzoDellaNotifica('/seller/ordini-sdg', negozio)).toBe('/seller/ordini-sdg');
    expect(indirizzoDellaNotifica('/seller/orders/1', negozio)).toBe('/seller/orders/1');
  });
});
