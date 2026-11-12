// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-019 — Il fattorino preme «Aggiorna stato», il server risponde errore e lui
 * leggeva «Stato aggiornato».
 */

const toasts = vi.hoisted(() => ({ ok: [] as string[], errori: [] as string[], neutri: [] as string[] }));
vi.mock('sonner', () => ({
  toast: Object.assign((m: string) => toasts.neutri.push(m), {
    success: (m: string) => toasts.ok.push(m),
    error: (m: string) => toasts.errori.push(m),
  }),
}));
vi.mock('@/lib/supabase/client', () => {
  const catena: Record<string, unknown> = {};
  catena.select = () => catena;
  catena.eq = () => catena;
  catena.single = async () => ({
    data: { stripe_account_id: 'acct_rider', stripe_charges_enabled: false, stripe_payouts_enabled: false },
    error: null,
  });
  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'rider-1' } } }),
        getSession: async () => ({ data: { session: { access_token: 't' } } }),
      },
      from: () => catena,
    },
  };
});

import RiderConnectButton from '@/components/rider/RiderConnectButton';

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.unstubAllGlobals();
});

describe('R11-019 — «Aggiorna stato» con il server in errore', () => {
  it('dice che non è riuscito, non «stato aggiornato»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: 'x', message: 'Stripe non risponde' } }), { status: 502 })));
    const r = await disegna(createElement(RiderConnectButton));
    chiudi = r.chiudi;
    const bottone = Array.from(r.host.querySelectorAll('button')).find((b) => b.textContent?.includes('Aggiorna stato'));
    expect(bottone).toBeTruthy();
    await act(async () => {
      bottone!.click();
      await new Promise((ok) => setTimeout(ok, 20));
    });
    expect(toasts.neutri.join(' '), 'il server ha detto errore e il fattorino legge «stato aggiornato»').not.toMatch(/Stato aggiornato/);
    expect(toasts.errori.length).toBe(1);
  });
});
