// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R26-009 — Le rimesse contanti avevano ancora un tetto di 1000 righe senza avviso.
 *
 * La pagina chiedeva 1001 righe per accorgersi del taglio, ma il database ne
 * consegna al massimo 1000 (`max_rows`, supabase/config.toml): la riga in piu'
 * non arrivava mai, l'avviso «Elenco tagliato» non scattava e il «totale da
 * rimettere» sembrava completo. Qui il finto si comporta come il server vero:
 * al massimo 1000 righe, e il conteggio esatto a parte.
 */

const MAX_ROWS = 1000;
let inAttesa = 0;
function catena(): unknown {
  const risposta = () => ({
    data: Array.from({ length: Math.min(inAttesa, MAX_ROWS) }, (_, i) => ordine(i)),
    error: null,
    count: inAttesa,
  });
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? (ok: (r: unknown) => unknown) => Promise.resolve(risposta()).then(ok) : () => p),
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: () => catena(), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const RIDER = '11111111-1111-4111-8111-111111111111';
function ordine(i: number) {
  return {
    id: `o${i}`, rider_id: RIDER, delivered_at: '2026-11-04T10:00:00Z', total_price: 13, shipping_cost: 3,
    rider_fee_cents: 300, pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED',
    cash_confirmed_at: '2026-11-04T10:05:00Z', rider: { full_name: 'Luca' },
  };
}

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });

async function apri() {
  const mod = (await import('@/app/admin/cod-remittance/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

describe('R26-009 — il tetto delle rimesse si dice anche col server che taglia a 1000', () => {
  it('1500 consegne in attesa, 1000 lette: la pagina dice «Elenco tagliato» e «almeno»', async () => {
    inAttesa = 1500;
    const host = await apri();
    expect(host.textContent, 'il taglio a 1000 righe resta muto').toContain('Elenco tagliato');
    expect(host.textContent).toMatch(/almeno/);
  });

  it('1000 consegne esatte: nessun avviso', async () => {
    inAttesa = 1000;
    const host = await apri();
    expect(host.textContent).not.toContain('Elenco tagliato');
  });
});
