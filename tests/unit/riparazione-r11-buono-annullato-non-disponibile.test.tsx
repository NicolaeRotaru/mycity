// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R11-018 — Un buono regalo annullato (pagamento tornato indietro) o scaduto si
 * leggeva «Disponibile», col codice in chiaro e il tasto per copiarlo.
 */

const stato = vi.hoisted(() => ({ buoni: [] as unknown[] }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/lib/supabase/client', () => {
  const catena = (dati: () => unknown): unknown => {
    const p: unknown = new Proxy(function () {}, {
      get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve({ data: dati(), error: null }).then(ok) : () => p),
      apply: () => p,
    });
    return p;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'cliente-1' } } }) },
      from: (t: string) => catena(() => (t === 'gift_cards' ? stato.buoni : null)),
      rpc: () => catena(() => 0),
    },
  };
});

let chiudi: (() => void) | null = null;
beforeEach(() => {
  window.history.replaceState({}, '', '/profile/gift-cards?giftcard=success');
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
});

const buono = (code: string, extra: Record<string, unknown>) => ({
  code, amount_cents: 2500, balance_cents: 0, buyer_id: 'altro', recipient_email: null, recipient_name: null,
  message: null, redeemed_at: null, expires_at: '2099-01-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', ...extra,
});

describe('R11-018 — buono annullato o scaduto', () => {
  it('non si legge «Disponibile» e il codice non è in chiaro', async () => {
    stato.buoni = [
      buono('ANNULLATO-1234', { voided_at: '2026-10-20T00:00:00Z', void_reason: 'disputed' }),
      buono('SCADUTO-5678', { balance_cents: 2500, expires_at: '2026-01-01T00:00:00Z' }),
    ];
    const mod = (await import('@/app/profile/gift-cards/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    await act(async () => { await new Promise((ok) => setTimeout(ok, 20)); });
    const testo = r.host.textContent ?? '';
    expect(testo, 'un buono annullato o scaduto si legge «Disponibile»').not.toMatch(/Disponibile/);
    expect(testo).toMatch(/Annullata/);
    expect(testo).toMatch(/Scaduta/);
    expect(testo).not.toContain('ANNULLATO-1234');
    expect(testo).not.toContain('SCADUTO-5678');
  });
});
