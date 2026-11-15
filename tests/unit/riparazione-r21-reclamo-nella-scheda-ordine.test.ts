// @vitest-environment jsdom
/**
 * R21-017 — Nella scheda ordine dell'amministratore un reclamo aperto non si
 * vedeva: «Contestazione: —» e «Bonifico al negozio: trattenuto», nessun motivo.
 *
 * La riga leggeva solo `orders.dispute_status` (la contestazione in banca). Dalla
 * migrazione 184 il reclamo vive solo nella tabella `disputes`, ed è lì che il
 * giro dei bonifici lo legge per fermare il pagamento. Qui la pagina vera,
 * montata, con un database finto che ha il reclamo aperto solo in `disputes`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { fake, disegna, type Domanda } from './aiuti/cabina-admin';

const ID = '21017000-2222-4333-8444-555555555555';
vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./aiuti/cabina-admin')).fake }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ID }), useRouter: () => ({ push: () => {} }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; fake.azzera(); });

const ORDINE = {
  id: ID, user_id: 'u', seller_id: 's', rider_id: null, total_price: 30, shipping_cost: 0,
  discount_amount: 0, coupon_code: null, payment_method: 'card', payment_status: 'PAID',
  delivery_status: 'DELIVERED', pickup_in_store: false, delivery_slot: null,
  created_at: '2026-11-10T10:00:00Z', accepted_at: null, ready_at: null,
  picked_up_at: null, delivered_at: '2026-11-10T12:00:00Z', canceled_at: null,
  delivery_full_name: 'Maria', delivery_phone: null, delivery_address: 'Via Roma 1', delivery_city: 'Piacenza',
  delivery_zip: '29121', delivery_notes: null, refunded_amount_cents: 0, payout_status: 'HELD',
  dispute_status: null, internal_dispute_status: null, seller: { store_name: 'Forno' }, rider: null, order_items: [],
};
const RECLAMO_APERTO = { id: 'rec-1', order_id: ID, status: 'open', created_at: '2026-11-11T09:30:00Z' };

/**
 * Il database finto risponde come quello vero: l'ordine dalla sua riga, i reclami
 * filtrati per ordine e per stato (se la pagina chiede gli stati).
 */
async function apri(
  ordine: Record<string, unknown>,
  reclami: Array<Record<string, unknown>> | 'guasto',
): Promise<HTMLElement> {
  fake.rispondi = (q: Domanda) => {
    if (q.tabella === 'orders') return { data: { ...ORDINE, ...ordine }, error: null };
    if (q.tabella === 'disputes') {
      if (reclami === 'guasto') return { data: null, error: { message: 'rete caduta' } };
      const stati = q.filtri.status as string[] | undefined;
      return {
        data: reclami.filter((r) => r.order_id === q.filtri.order_id && (!stati || stati.includes(String(r.status)))),
        error: null,
      };
    }
    return { data: [], error: null };
  };
  const mod = (await import('@/app/admin/orders/[id]/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function riga(host: HTMLElement, etichetta: string): HTMLElement | null {
  const dt = [...host.querySelectorAll('dt')].find((d) => d.textContent === etichetta);
  return (dt?.nextElementSibling as HTMLElement | null) ?? null;
}

describe('R21-017 il reclamo aperto si vede nella scheda ordine', () => {
  it('IL CASO DEL NEGOZIO CHE CHIEDE «PERCHÉ NON MI PAGATE?» — reclamo aperto solo in disputes', async () => {
    const host = await apri({}, [RECLAMO_APERTO]);
    const contestazione = riga(host, 'Contestazione')!;
    expect(contestazione.textContent, 'la scheda dice «—» con un reclamo aperto').not.toBe('—');
    expect(contestazione.textContent).toMatch(/reclamo aperto dal 11 nov 2026/);
    expect(contestazione.querySelector('a')?.getAttribute('href'), 'manca la strada per andare al reclamo').toBe('/admin/disputes');
    expect(riga(host, 'Bonifico al negozio')!.textContent).toBe('trattenuto · fermo per: reclamo aperto');
  });

  it('un reclamo già chiuso non conta come aperto, e senza niente resta «—»', async () => {
    const host = await apri({}, [{ ...RECLAMO_APERTO, status: 'resolved' }]);
    expect(riga(host, 'Contestazione')!.textContent).toBe('—');
    expect(riga(host, 'Bonifico al negozio')!.textContent).toBe('trattenuto');
  });

  it('il reclamo interno e la contestazione in banca si vedono tutti e due, in italiano', async () => {
    const host = await apri({ internal_dispute_status: 'RIMBORSO_DA_RIPARTIRE', dispute_status: 'WON' }, []);
    const testo = riga(host, 'Contestazione')!.textContent ?? '';
    expect(testo).toContain('interna: rimborso da ripartire');
    expect(testo).toContain('in banca: vinta');
    expect(testo).not.toMatch(/RIMBORSO_DA_RIPARTIRE|WON/);
    expect(riga(host, 'Bonifico al negozio')!.textContent).toBe('trattenuto · fermo per: contestazione interna (rimborso da ripartire)');
  });

  it('un reclamo interno chiuso a favore del cliente ferma il bonifico e lo dice', async () => {
    const host = await apri({ internal_dispute_status: 'LOST' }, []);
    expect(riga(host, 'Contestazione')!.textContent).toBe('interna: chiusa a favore del cliente');
    expect(riga(host, 'Bonifico al negozio')!.textContent).toMatch(/fermo per: contestazione interna \(chiusa a favore del cliente\)/);
  });

  it('se i reclami non si leggono non dice «—»: dice che non li ha letti', async () => {
    const host = await apri({}, 'guasto');
    expect(riga(host, 'Contestazione')!.textContent).toMatch(/non riesco a leggerli/);
    expect(riga(host, 'Bonifico al negozio')!.textContent).toBe('trattenuto · fermo per: reclami non letti');
  });
});
