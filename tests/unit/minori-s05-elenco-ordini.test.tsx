// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { fake, disegna, aspetta, type Domanda } from './aiuti/cabina-admin';

/**
 * S05 · schede 349 e 477 (lista) — elenco ordini dell'admin.
 */

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next/navigation', () => ({ useParams: () => ({}), useRouter: () => ({ push: () => {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('@/components/admin/RimborsiDaDividere', () => ({ RimborsiDaDividere: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const riga = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `0000000${i}`.slice(-8) + '-0000-4000-8000-000000000000', total_price: 10, delivery_status: 'NEW',
  created_at: '2026-11-04T10:00:00Z', payment_method: 'card', delivery_full_name: 'M', delivery_city: 'PC',
  seller: { store_name: 'Forno' }, rider: null, ...extra,
});

describe('elenco ordini admin', () => {
  it('349: «Carica altri 50» non svuota la pagina mentre legge', async () => {
    let letture = 0;
    fake.rispondi = (q: Domanda) => {
      if (q.tabella !== 'orders') return { data: [], error: null };
      letture += 1;
      // La seconda lettura resta in viaggio: si guarda cosa c'è a schermo intanto.
      if (letture > 1) return new Promise(() => {}) as never;
      return { data: Array.from({ length: 50 }, (_, i) => riga(i)), error: null };
    };
    const mod = (await import('@/app/admin/orders/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const altri = [...r.host.querySelectorAll('button')].find((b) => /Carica altri/.test(b.textContent ?? ''));
    expect(altri).toBeDefined();
    await act(async () => { altri?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await aspetta();
    expect(letture).toBeGreaterThan(1);
    expect(r.host.querySelectorAll('tbody tr').length, 'la tabella è sparita durante la lettura').toBe(50);
  });

  it('477: niente «Annulla» su un ordine in contanti già consegnato', async () => {
    fake.rispondi = (q: Domanda) => (q.tabella === 'orders'
      ? { data: [riga(1, { delivery_status: 'DELIVERED', payment_method: 'cod' }), riga(2, { delivery_status: 'ASSIGNED', payment_method: 'cod' })], error: null }
      : { data: [], error: null });
    const mod = (await import('@/app/admin/orders/page')) as { default: () => ReactNode };
    const r = await disegna(createElement(mod.default));
    chiudi = r.chiudi;
    const righe = [...r.host.querySelectorAll('tbody tr')];
    expect(righe[0].textContent).not.toContain('Annulla');
    expect(righe[1].textContent).toContain('Annulla');
  });
});
