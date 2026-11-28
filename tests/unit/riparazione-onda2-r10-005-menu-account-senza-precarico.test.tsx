// @vitest-environment jsdom
/**
 * R10-005 (onda 2, 28/11/2026) — LE VOCI DEL MENU ACCOUNT SI PRECARICAVANO ANCORA.
 *
 * In onda 1 le voci della barra laterale del negozio hanno perso il precarico automatico di Next
 * (ogni precarico di /seller/… ripassa dal controllo d'accesso del middleware: getUser + lettura di
 * profiles, due chiamate a Supabase per voce). Restavano col precarico le voci del menu in fondo
 * alla barra (components/seller/MenuAccount.tsx): «Abbonamento», «Profilo e impostazioni» e «Vai al
 * marketplace», che partivano appena il menu si apriva. Qui il menu VERO, aperto col clic, con un
 * next/link finto che registra la prop `prefetch` che riceve.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: ({ href, children, prefetch, ...r }: Record<string, unknown>) =>
      ce('a', { href: String(href), 'data-prefetch': prefetch === undefined ? 'predefinito' : String(prefetch), ...r }, children as never),
  };
});
vi.mock('@/components/seller/preventivo-agenzia', () => ({
  CHIAVE_PREVENTIVO: ['preventivo-agenzia'],
  leggiPreventivoAgenzia: async () => null,
}));
vi.mock('@/components/account/CambiaAccount', () => ({ default: () => null }));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: MenuAccount } = await import('@/components/seller/MenuAccount');

describe('R10-005 — il menu account del negozio non precarica le sue voci', () => {
  it('IL CASO DELLA VOCE — aperto il menu, ogni link ha prefetch={false}', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const root = createRoot(div);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(MenuAccount, { nome: 'Forno', iniziali: 'FO', email: 'f@f.it', compatto: false, onEsci: () => undefined }),
        ),
      );
    });
    await act(async () => {
      (div.querySelector('button[aria-controls="menu-account-venditore"]') as HTMLButtonElement).click();
    });
    const voci = Array.from(div.querySelectorAll('#menu-account-venditore a'));
    // Il menu ha davvero le sue voci: la prova non passa a vuoto.
    expect(voci.map((a) => a.getAttribute('href'))).toEqual(expect.arrayContaining(['/seller/profile', '/?shop=1']));
    expect(voci.length).toBeGreaterThanOrEqual(3);
    const conPrecarico = voci.filter((a) => a.getAttribute('data-prefetch') !== 'false').map((a) => a.getAttribute('href'));
    expect(conPrecarico).toEqual([]);
    act(() => root.unmount());
  });
});
