// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * LA VOCE «RESI» DEL MENU ACCOUNT PORTA AI RESI DEL CLIENTE.
 *
 * 1/11/2026 — Chiesto un reso, il cliente apriva «Resi» dal menu dell'account
 * (barra laterale e striscia del telefono) e arrivava a /returns, la pagina
 * delle regole: della sua richiesta nessuna traccia. Si monta il guscio vero
 * dell'account e si guarda dove portano le due voci «Resi».
 */
const stato = vi.hoisted(() => ({ pathname: '/orders' }));

vi.mock('next/navigation', () => ({
  usePathname: () => stato.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ profile: null, userEmail: null }) }));
vi.mock('@/components/hooks/useNotificationsCount', () => ({ useNotificationsCount: () => 0 }));
vi.mock('@/components/hooks/useMessagesUnread', () => ({ useMessagesUnread: () => 0 }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { signOut: vi.fn() } } }));

import AccountShell from '@/components/account/AccountShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let contenitore: HTMLDivElement;

async function monta(pathname: string) {
  stato.pathname = pathname;
  contenitore = document.createElement('div');
  document.body.appendChild(contenitore);
  root = createRoot(contenitore);
  await act(async () => root.render(createElement(AccountShell, null, createElement('p', null, 'contenuto'))));
}
const voci = (testo: string) =>
  Array.from(contenitore.querySelectorAll('a')).filter((a) => (a.textContent ?? '').trim() === testo);

afterEach(async () => {
  await act(async () => root.unmount());
  contenitore.remove();
});

describe('la voce Resi del menu account', () => {
  it('porta alla lista dei resi del cliente, non alla pagina delle regole', async () => {
    await monta('/orders');
    const resi = voci('Resi');
    expect(resi.length).toBeGreaterThan(0);
    for (const a of resi) expect(a.getAttribute('href')).toBe('/orders/resi');
  });

  it('sulla lista dei resi si accende «Resi», non «Ordini»', async () => {
    await monta('/orders/resi');
    for (const a of voci('Resi')) expect(a.getAttribute('aria-current')).toBe('page');
    for (const a of voci('Ordini')) expect(a.getAttribute('aria-current')).not.toBe('page');
  });
});
