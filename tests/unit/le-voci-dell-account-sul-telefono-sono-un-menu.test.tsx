/**
 * @vitest-environment jsdom
 */
/**
 * 28/11/2026 — SUL TELEFONO LE VOCI DELL'ACCOUNT ERANO UNA RIGA DI PILLOLE CHE SCORREVA DI LATO.
 *
 * Nicola, dal telefono, sulla pagina Profilo: «Profilo, Ordini, Resi, Indirizzi…» in una riga di
 * pillole, se ne vedevano tre e mezza; «mettile in forma di menu… molto più bella». La stessa riga
 * stava nel pannello demo del preventivo.
 *
 * La prova monta il guscio VERO dell'area account e quello della demo, e guarda cosa c'è: un riquadro
 * che dice dove sei e un pulsante «Menu»; nessuna voce sparsa nella pagina finché non lo si apre; aperto,
 * un pannello con i quattro gruppi, tutte le voci, quella dove sei accesa e i da leggere contati; si
 * chiude con Esc, e una voce porta alla sua pagina chiudendo il pannello.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  percorso: '/profile',
  vai: [] as string[],
  notifiche: 3,
  messaggi: 2,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mondo.percorso,
  useRouter: () => ({ push: (h: string) => { mondo.vai.push(h); }, replace: () => undefined, refresh: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never),
  };
});
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getUser: async () => ({ data: { user: { created_at: '2026-03-01T10:00:00Z' } } }) } },
}));
vi.mock('@/lib/auth/uscita', () => ({ esciEVaiAllAccesso: async () => undefined }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 'u-1', role: 'admin', full_name: 'Assistenza MyCity' }, userEmail: 'a@a.it', isAuthenticated: true, isAdmin: true }),
}));
vi.mock('@/components/hooks/useNotificationsCount', () => ({ useNotificationsCount: () => mondo.notifiche }));
vi.mock('@/components/hooks/useMessagesUnread', () => ({ useMessagesUnread: () => mondo.messaggi }));
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { default: AccountShell } = await import('@/components/account/AccountShell');
const { default: DemoShell } = await import('@/components/preventivo/DemoShell');

let smonta: (() => void) | null = null;
beforeEach(() => {
  mondo.percorso = '/profile';
  mondo.vai = [];
  mondo.notifiche = 3;
  mondo.messaggi = 2;
});
afterEach(() => {
  smonta?.();
  smonta = null;
});

async function monta(elemento: ReturnType<typeof createElement>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, elemento));
  });
  smonta = () => { act(() => root.unmount()); div.remove(); };
  return div;
}

/** Il pulsante che apre il menu del telefono. */
function pulsanteMenu(div: HTMLElement): HTMLButtonElement {
  const b = Array.from(div.querySelectorAll('button[aria-haspopup="dialog"]')).find((x) => x.textContent?.includes('Menu'));
  expect(b, 'il riquadro col pulsante «Menu» non c’è').toBeTruthy();
  return b as HTMLButtonElement;
}

async function clic(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
}

describe("l'area account sul telefono", () => {
  it('non ha più la riga di pillole che scorre: c’è un riquadro che dice dove sei', async () => {
    const div = await monta(createElement(AccountShell, null, createElement('p', null, 'contenuto')));
    // La striscia orizzontale era un <nav> che scorreva di lato (overflow-x-auto).
    expect(div.querySelector('nav.overflow-x-auto')).toBeNull();
    const b = pulsanteMenu(div);
    expect(b.textContent).toContain('Il tuo account');
    expect(b.textContent).toContain('Profilo');
    // I da leggere si vedono anche da chiuso: 3 notifiche + 2 messaggi.
    expect(b.textContent).toContain('5 da leggere');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(div.querySelector('[role="dialog"]')).toBeNull();
  });

  it('aperto, mostra tutte le voci nei quattro gruppi, con quella dove sei accesa e i numeri giusti', async () => {
    mondo.percorso = '/profile/addresses';
    const div = await monta(createElement(AccountShell, null, createElement('p', null, 'contenuto')));
    expect(pulsanteMenu(div).textContent).toContain('Indirizzi');
    await clic(pulsanteMenu(div));
    const pannello = div.querySelector('[role="dialog"][aria-label="Menu account"]') as HTMLElement;
    expect(pannello).not.toBeNull();
    const testo = pannello.textContent ?? '';
    for (const gruppo of ['Account', 'Attività', 'Premi', 'Preferenze']) expect(testo).toContain(gruppo);
    const voci = Array.from(pannello.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));
    expect(voci).toEqual([
      '/profile', '/orders', '/profile/returns', '/profile/addresses',
      '/favorites', '/messages', '/notifications',
      '/profile/loyalty', '/profile/referral', '/profile/gift-cards', '/profile/achievements',
      '/profile/settings',
    ]);
    const accese = Array.from(pannello.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute('href'));
    expect(accese).toEqual(['/profile/addresses']);
    expect(pannello.querySelector('a[href="/notifications"]')!.textContent).toContain('3 da leggere');
    expect(pannello.querySelector('a[href="/messages"]')!.textContent).toContain('2 da leggere');
    // Chi sei, in cima; «Esci» in fondo.
    expect(testo).toContain('Assistenza MyCity');
    expect(Array.from(pannello.querySelectorAll('button')).some((x) => x.textContent?.includes('Esci'))).toBe(true);
  });

  it('una voce porta alla sua pagina e chiude il pannello; Esc lo chiude e basta', async () => {
    const div = await monta(createElement(AccountShell, null, createElement('p', null, 'contenuto')));
    await clic(pulsanteMenu(div));
    await clic(div.querySelector('[role="dialog"] a[href="/orders"]')!);
    expect(mondo.vai).toEqual(['/orders']);
    expect(div.querySelector('[role="dialog"]')).toBeNull();

    await clic(pulsanteMenu(div));
    expect(div.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(div.querySelector('[role="dialog"]')).toBeNull();
    expect(mondo.vai).toEqual(['/orders']);
  });
});

describe('il pannello demo del preventivo sul telefono', () => {
  it('ha lo stesso menu: le voci aperte portano alla pagina, quelle chiuse si vedono col lucchetto', async () => {
    mondo.percorso = '/preventivo/ABC123';
    const div = await monta(createElement(DemoShell, { codice: 'ABC123', nome: 'Forno Rossi', consigliato: null, children: createElement('p', null, 'contenuto') }));
    // La riga scura che scorreva di lato non c'è più.
    expect(div.querySelector('nav.overflow-x-auto')).toBeNull();
    await clic(pulsanteMenu(div));
    const pannello = div.querySelector('[role="dialog"]') as HTMLElement;
    expect(pannello).not.toBeNull();
    const testo = pannello.textContent ?? '';
    for (const v of ['Dashboard', 'Ordini', 'Prodotti', 'Promozioni', 'Guadagni', 'Abbonamento']) expect(testo).toContain(v);
    // Le chiuse non sono link e lo dicono a chi non vede il lucchetto.
    const link = Array.from(pannello.querySelectorAll('nav a')).map((a) => a.textContent ?? '');
    expect(link.some((t) => t.includes('Ordini'))).toBe(false);
    expect(link.some((t) => t.includes('Abbonamento'))).toBe(true);
    expect(testo).toContain('si accende quando attivi l’abbonamento');
  });
});
