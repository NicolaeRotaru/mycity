/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R28-003 — La pagina della cassa gira davvero (montata, con un carrello e un database finto) e gli
 * orari dei negozi (`store_hours`) arrivano al selettore delle fasce e al freno di «Ordina»
 * (`consegnaScelta`). Le prove vecchie su questo filo cercano parole nel sorgente: restano verdi
 * anche se la pagina smette di leggere o di passare gli orari. Qui si guardano i valori che
 * arrivano ai due punti. Orologio finto: mercoledì 27 maggio 2026, 10:00 a Roma.
 */
const ORARI_FORNO = { mon: [], tue: [], wed: [['08:00', '12:00']], thu: [], fri: [], sat: [], sun: [] };
const SELLER = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';

const visti = vi.hoisted(() => ({ picker: [] as unknown[], freno: [] as unknown[], letture: [] as string[] }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined }),
  usePathname: () => '/checkout',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: Record<string, unknown>) => ce('a', { href: String(href) }, children as never) };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock('@/lib/analytics/events', () => ({
  trackCheckoutStarted: vi.fn(), trackCheckoutStep: vi.fn(), trackCouponApplied: vi.fn(), trackOrderPlaced: vi.fn(),
}));
vi.mock('@/lib/cart', () => ({
  getCart: () => [{ id: PRODOTTO, name: 'Pane', price: 5, quantity: 1, sellerId: SELLER, image: '' }],
  clearCart: vi.fn(), removeFromCart: vi.fn(), rimuoviRigaSenzaVariante: vi.fn(), cartCount: () => 1,
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: async () => new Map(),
  discountedUnitCents: (p: number) => Math.round(p * 100),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({
  fetchSellerPublicMap: async (_c: unknown, _ids: string[], colonne: string) => {
    visti.letture.push(colonne);
    return new Map([[SELLER, { id: SELLER, store_name: 'Forno', store_lat: 45.05, store_lng: 9.69, store_hours: ORARI_FORNO }]]);
  },
}));
vi.mock('@/lib/supabase/client', () => {
  const risposta = (data: unknown) => {
    const b: Record<string, unknown> = {
      select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b,
      then: (res: (v: unknown) => unknown) => res({ data, error: null }),
    };
    return b;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: null } }), getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
      from: (t: string) => risposta(t === 'products' ? [{ id: PRODOTTO, seller_id: SELLER, stock: 10, has_variants: false, price: 5, express_enabled: null }] : []),
    },
  };
});
vi.mock('@/lib/quando-arriva', async (o) => {
  const vero = (await o()) as typeof import('@/lib/quando-arriva');
  return { ...vero, consegnaScelta: (s: Parameters<typeof vero.consegnaScelta>[0]) => { visti.freno.push(s.orari); return vero.consegnaScelta(s); } };
});
vi.mock('@/components/checkout/DeliverySlotPicker', () => ({
  DeliverySlotPicker: (p: { orariNegozi?: unknown }) => { visti.picker.push(p.orariNegozi); return null; },
}));
vi.mock('@/components/checkout/StepCard', async () => ({ StepCard: ({ children }: { children?: unknown }) => children ?? null }));
vi.mock('@/components/checkout/StepIndicator', () => ({ StepIndicator: () => null, CHECKOUT_STEPS: [] }));
vi.mock('@/components/checkout/ScheletroCassa', () => ({ ScheletroCassa: () => null }));
vi.mock('@/components/checkout/ShippingAddressForm', () => ({ ShippingAddressForm: () => null, useCoordinateDellaZona: () => ({ coordinate: null }) }));
vi.mock('@/components/checkout/PaymentMethodSelector', () => ({ PaymentMethodSelector: () => null, raccogliMetodoScelto: () => null }));
vi.mock('@/components/checkout/OrderSummary', () => ({ OrderSummary: () => null, vaiAlPrimoBlocco: () => undefined }));
vi.mock('@/components/checkout/CartGroupsList', () => ({ CartGroupsList: () => null }));
vi.mock('@/components/checkout/CouponInput', () => ({ CouponInput: () => null }));

import CheckoutPage from '@/app/checkout/page';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-27T08:00:00Z'));
  visti.picker.length = 0; visti.freno.length = 0; visti.letture.length = 0;
});
afterEach(() => vi.useRealTimers());

async function monta() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(CheckoutPage))); });
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return () => act(() => root.unmount());
}

describe('R28-003 · la cassa montata passa gli orari dei negozi al selettore e al freno', () => {
  it('legge store_hours e li dà al selettore delle fasce', async () => {
    const smonta = await monta();
    expect(visti.letture.some((c) => /\bstore_hours\b/.test(c)), 'la cassa non chiede store_hours').toBe(true);
    expect(visti.picker.at(-1), 'il selettore non riceve gli orari del forno').toEqual([ORARI_FORNO]);
    smonta();
  });

  it('li dà anche al controllo che frena «Ordina» (consegnaScelta)', async () => {
    const smonta = await monta();
    expect(visti.freno.at(-1), 'il freno non riceve gli orari del forno').toEqual([ORARI_FORNO]);
    smonta();
  });
});
