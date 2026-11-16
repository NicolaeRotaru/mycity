// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R29-011 — Un ordine in contanti rimborsato tutto prima della rimessa spariva dai contanti da
 * chiedere al fattorino.
 *
 * Il rimborso pieno scrive `payout_status = 'REFUNDED'` (il negozio non va pagato) anche se la
 * rimessa di quel giorno non è confermata; la pagina delle rimesse leggeva solo
 * AWAITING_REMITTANCE. I contanti, che il fattorino ha ancora in tasca, non comparivano più fra
 * quelli da farsi consegnare, e MyCity rimborsava il cliente di tasca sua. Adesso restano da
 * chiedere finché la rimessa di quel fattorino per quel giorno non è confermata dopo l'incasso.
 *
 * Il finto database risponde secondo la domanda (tabella e stato del bonifico). Dati finti.
 */

const RIDER = '11111111-1111-4111-8111-111111111111';
const IN_ATTESA = 'aaaaaaaa-1111-4111-8111-111111111111';
const RIMBORSATO = 'bbbbbbbb-2222-4222-8222-222222222222';

type Domanda = { tabella: string; filtri: Record<string, unknown> };
let ordini: Array<Record<string, unknown>> = [];
let rimesse: Array<Record<string, unknown>> = [];
const domande: Domanda[] = [];

function rispondi(q: Domanda): { data: unknown; error: null; count?: number } {
  if (q.tabella === 'cod_reconciliations') return { data: rimesse, error: null };
  const stato = q.filtri.payout_status;
  const righe = ordini.filter((o) => o.payout_status === stato);
  return { data: righe, error: null, count: righe.length };
}

function catena(tabella: string): unknown {
  const q: Domanda = { tabella, filtri: {} };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, k) => {
      if (k === 'then') {
        return (ok: (r: unknown) => unknown) => {
          domande.push(q);
          return Promise.resolve(rispondi(q)).then(ok);
        };
      }
      if (k === 'eq') return (c: string, v: unknown) => { q.filtri[c] = v; return p; };
      return () => p;
    },
    apply: () => p,
  });
  return p;
}
vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: (t: string) => catena(t), auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

/** Un ordine in contanti consegnato il 4/11 alle 11 (ora di Piacenza), contanti confermati alle 11:05. */
function ordine(id: string, payout_status: string, total_price: number) {
  return {
    id, rider_id: RIDER, delivered_at: '2026-11-04T10:00:00Z', total_price, shipping_cost: 3,
    rider_fee_cents: 300, pickup_in_store: false, payment_method: 'cod', delivery_status: 'DELIVERED',
    cash_confirmed_at: '2026-11-04T10:05:00Z', payout_status, rider: { full_name: 'Luca' },
  };
}

let chiudi: (() => void) | null = null;
afterEach(() => { chiudi?.(); chiudi = null; });
beforeEach(() => { ordini = []; rimesse = []; domande.length = 0; });

async function apri(): Promise<string> {
  const mod = (await import('@/app/admin/cod-remittance/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return (r.host.textContent ?? '').replace(/ /g, ' ');
}

describe('R29-011 — i contanti che il fattorino ha in mano restano da chiedere', () => {
  it('un ordine da 23 € rimborsato per intero prima della rimessa: i suoi 20 € restano nel gruppo del fattorino', async () => {
    // 13 € in attesa (10 € da rimettere) e 23 € rimborsati (20 € da rimettere: il compenso di 3 € resta al fattorino).
    ordini = [ordine(IN_ATTESA, 'AWAITING_REMITTANCE', 13), ordine(RIMBORSATO, 'REFUNDED', 23)];
    const testo = await apri();
    expect(testo, 'i contanti dell ordine rimborsato sono spariti da quelli da chiedere').toContain('30,00');
    expect(testo).toContain('2 ordini COD');
    expect(testo).toContain('di cui 1 rimborsati per intero');
  });

  it('solo l ordine rimborsato, rimessa non ancora confermata: il gruppo c è, non «nessuna rimessa»', async () => {
    ordini = [ordine(RIMBORSATO, 'REFUNDED', 23)];
    const testo = await apri();
    expect(testo, 'il fattorino ha 20 € in tasca e la pagina dice che non c è niente da chiedere').not.toContain('Nessuna rimessa COD in attesa');
    expect(testo).toContain('20,00');
  });

  it('rimessa di quel giorno confermata dopo l incasso: i contanti sono rientrati, non si chiedono due volte', async () => {
    ordini = [ordine(IN_ATTESA, 'AWAITING_REMITTANCE', 13), ordine(RIMBORSATO, 'REFUNDED', 23)];
    rimesse = [{ rider_id: RIDER, for_date: '2026-11-04', remitted_at: '2026-11-04T18:00:00Z' }];
    const testo = await apri();
    expect(testo).toContain('10,00');
    expect(testo).not.toContain('30,00');
    expect(testo).toContain('1 ordini COD');
  });

  it('rimessa confermata prima dell incasso (un altro giro dello stesso giorno): i contanti sono ancora da chiedere', async () => {
    ordini = [ordine(RIMBORSATO, 'REFUNDED', 23)];
    rimesse = [{ rider_id: RIDER, for_date: '2026-11-04', remitted_at: '2026-11-04T09:00:00Z' }];
    const testo = await apri();
    expect(testo).toContain('20,00');
  });
});
