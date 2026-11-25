/**
 * @vitest-environment jsdom
 */
/**
 * 25/11/2026 — La tendina della campanella del negozio diceva «Hai 3 notifiche non lette» e
 * non diceva quali. Nicola: «dentro la finestra delle notifiche in alto a destra siano visibili
 * le ultime notifiche».
 *
 * Qui si monta il guscio VERO col react-query vero e un database finto che applica davvero i
 * filtri (utente, promozioni spente, ordine per data, limite), si apre la campanella e si guarda
 * cosa c'è scritto dentro.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const mondo = vi.hoisted(() => ({
  tabelle: {} as Record<string, Array<Record<string, unknown>>>,
  scritture: [] as Array<{ tabella: string; valori: Riga; filtri: Riga }>,
}));

/** Un pezzetto di PostgREST: select, eq, neq, in, order, limit, maybeSingle, update e il conteggio «head». */
function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  const filtriScritti: Riga = {};
  let soloConto = false;
  let ordine: string | null = null;
  let limite = Infinity;
  let aggiorna: Riga | null = null;
  const righe = () => {
    const tutte = (mondo.tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
    if (ordine) tutte.sort((a, b) => String(b[ordine!]).localeCompare(String(a[ordine!])));
    return tutte.slice(0, limite);
  };
  const q = {
    select: (_c?: string, o?: { count?: string; head?: boolean }) => { soloConto = !!o?.head; return q; },
    update: (v: Riga) => { aggiorna = v; return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); filtriScritti[c] = v; return q; },
    neq: (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return q; },
    in: (c: string, v: unknown[]) => { filtri.push((r) => v.includes(r[c])); return q; },
    order: (c: string) => { ordine = c; return q; },
    limit: (n: number) => { limite = n; return q; },
    maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (aggiorna) {
        for (const r of righe()) Object.assign(r, aggiorna);
        mondo.scritture.push({ tabella: nome, valori: aggiorna, filtri: filtriScritti });
        return Promise.resolve({ error: null }).then(ok, ko);
      }
      return Promise.resolve(soloConto ? { count: righe().length, error: null } : { data: righe(), error: null }).then(ok, ko);
    },
  };
  return q;
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
}));
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
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { signOut: async () => ({}) }, from: (t: string) => tabella(t) },
}));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Forno' }, userEmail: 'f@f.it', isAuthenticated: true, isSeller: true }),
}));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never;

const { default: SellerShell } = await import('@/components/seller/SellerShell');

let smonta: (() => void) | null = null;
afterEach(() => {
  smonta?.();
  smonta = null;
  mondo.tabelle = {};
  mondo.scritture = [];
});

const ora = Date.now();
const fa = (min: number) => new Date(ora - min * 60_000).toISOString();

function riempi() {
  mondo.tabelle.profiles = [{ id: 's-1', notif_promos: false }];
  mondo.tabelle.notifications = [
    { id: 'n1', user_id: 's-1', title: 'Nuovo ordine #1042', body: 'Mario ha ordinato 2 pagnotte', link: '/seller/orders/1042', is_read: false, category: 'order', created_at: fa(3) },
    { id: 'n2', user_id: 's-1', title: 'Nuova recensione', body: '5 stelle per il pane di segale', link: null, is_read: false, category: 'system', created_at: fa(30) },
    { id: 'n3', user_id: 's-1', title: 'Sconto del weekend', body: 'Promo spenta nelle impostazioni', link: null, is_read: false, category: 'promo', created_at: fa(1) },
    { id: 'n4', user_id: 's-1', title: 'Pagamento ricevuto', body: null, link: null, is_read: true, category: 'system', created_at: fa(120) },
    { id: 'n5', user_id: 'altro', title: 'Notifica di un altro negozio', body: null, link: null, is_read: false, category: 'order', created_at: fa(2) },
  ];
}

async function apriCampanella() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerShell, null, createElement('p', null, 'contenuto'))));
  });
  smonta = () => { act(() => root.unmount()); div.remove(); };
  await act(async () => {
    div.querySelector('button[aria-label="Notifiche"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  // La lista arriva dopo l'apertura: si aspetta che la lettura finisca.
  for (let i = 0; i < 20 && !div.querySelector('[aria-label="Ultime notifiche"]'); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  return div.querySelector('#pannello-notifiche-venditore') as HTMLElement;
}

describe('la tendina della campanella del negozio', () => {
  it('mostra le ultime notifiche, dalla più nuova, solo del negozio e senza le promo spente', async () => {
    riempi();
    const pannello = await apriCampanella();
    expect(pannello).not.toBeNull();
    const titoli = Array.from(pannello.querySelectorAll('li p:first-child')).map((p) => p.textContent);
    expect(titoli).toEqual(['Nuovo ordine #1042', 'Nuova recensione', 'Pagamento ricevuto']);
    expect(pannello.textContent).toContain('Mario ha ordinato 2 pagnotte');
    expect(pannello.textContent).not.toContain('Sconto del weekend');
    expect(pannello.textContent).not.toContain('altro negozio');
    // Le non lette lo dicono anche al lettore di schermo.
    expect(pannello.querySelectorAll('li .sr-only').length).toBe(2);
    // Niente più frase al posto della lista.
    expect(pannello.textContent).not.toMatch(/Hai \d+ notifich/);
  });

  it('non ne mostra più di sei', async () => {
    mondo.tabelle.profiles = [{ id: 's-1', notif_promos: true }];
    mondo.tabelle.notifications = Array.from({ length: 9 }, (_, i) => ({
      id: `m${i}`, user_id: 's-1', title: `Ordine numero ${i}`, body: null, link: null, is_read: false, category: 'order', created_at: fa(i),
    }));
    const pannello = await apriCampanella();
    expect(pannello.querySelectorAll('li').length).toBe(6);
    expect(pannello.textContent).toContain('Ordine numero 0');
    expect(pannello.textContent).not.toContain('Ordine numero 6');
  });

  it('cliccare una notifica con un indirizzo la segna letta (solo quella, solo del negozio)', async () => {
    riempi();
    const pannello = await apriCampanella();
    const voce = Array.from(pannello.querySelectorAll('a')).find((a) => a.getAttribute('href') === '/seller/orders/1042')!;
    expect(voce).toBeTruthy();
    await act(async () => { voce.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(mondo.scritture).toEqual([{ tabella: 'notifications', valori: { is_read: true }, filtri: { id: 'n1', user_id: 's-1' } }]);
    expect(mondo.tabelle.notifications.find((r) => r.id === 'n1')!.is_read).toBe(true);
    expect(mondo.tabelle.notifications.find((r) => r.id === 'n2')!.is_read).toBe(false);
  });

  it('una notifica non letta senza indirizzo si segna letta col clic (collaudo)', async () => {
    riempi();
    const pannello = await apriCampanella();
    const voce = pannello.querySelector<HTMLButtonElement>('button[aria-label="Nuova recensione: segna come letta"]');
    expect(voce).not.toBeNull();
    await act(async () => { voce!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(mondo.scritture).toEqual([{ tabella: 'notifications', valori: { is_read: true }, filtri: { id: 'n2', user_id: 's-1' } }]);
    // Il fuoco resta nella tendina, sull'elenco (secondo collaudo).
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Ultime notifiche');
  });

  it('senza notifiche lo dice', async () => {
    mondo.tabelle.profiles = [{ id: 's-1', notif_promos: false }];
    mondo.tabelle.notifications = [];
    const pannello = await apriCampanella();
    for (let i = 0; i < 20 && !/Nessuna notifica/.test(pannello.textContent ?? ''); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    }
    expect(pannello.textContent).toContain('Nessuna notifica, per ora.');
  });
});
