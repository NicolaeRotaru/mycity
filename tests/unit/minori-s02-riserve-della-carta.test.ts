import { describe, it, expect, vi } from 'vitest';

/**
 * Sessione S02 (5/11/2026) — i tentativi con la carta e la cassa in contanti.
 *  · 1611: una riga di intento senza id di sessione, appena nata, non si fa scadere (la cassa con la
 *          carta sta nascendo): vale come pagina ancora aperta, e la merce resta riservata;
 *  · 30:   se il database non risponde, il cancello dei contanti dice il guasto (503), non «chiudi la
 *          pagina della carta».
 */
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { liberaRiserveAbbandonate } from '@/lib/ordini/riserve-abbandonate';
import { MOTIVO_CARTA_ANCORA_APERTA, MOTIVO_NON_GUARDATO, ordineInContantiPuoNascere } from '@/lib/ordini/ordine-in-contanti-puo-nascere';
import { SESSIONE_NON_GUARDATA } from '@/lib/ordini/tentativi-aperti-da-liberare';

const PANE = '11111111-1111-1111-1111-111111111111';

function dbFinto(riga: Record<string, unknown>) {
  const scritture: unknown[] = [];
  const rpc: string[] = [];
  const b = (valore: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'limit', 'neq', 'is', 'lt']) q[m] = () => q;
    q.update = (v: unknown) => { scritture.push(v); return q; };
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve(valore).then(ok);
    return q;
  };
  return {
    scritture,
    rpc,
    client: {
      from: (t: string) => (t === 'pending_checkouts' ? b({ data: [riga], error: null }) : b({ data: [], error: null })),
      rpc: (n: string) => { rpc.push(n); return Promise.resolve({ data: null, error: null }); },
    },
  };
}

const riga = (creata: string) => ({
  id: 'pending-nascente',
  created_at: creata,
  groups: [{ items: [{ productId: PANE, quantity: 1, variantId: null }] }],
  coupon_code: null,
  stripe_session_id: null,
  delivery: { impronta_carrello: 'un-altro-carrello' },
});

describe('1611 · la cassa con la carta che sta nascendo', () => {
  it('una riga di pochi secondi senza id di sessione non scade e la merce non torna in vendita', async () => {
    const db = dbFinto(riga(new Date(Date.now() - 5_000).toISOString()));
    const esito = await liberaRiserveAbbandonate(db.client as never, { buyerId: 'maria', soloConProdotti: [PANE] });
    expect(db.scritture).toHaveLength(0);
    expect(db.rpc).not.toContain('restore_stock');
    expect(esito.liberati).toEqual([]);
    expect(esito.ancoraPagabili).toEqual(['nascente:pending-nascente']);
    expect(ordineInContantiPuoNascere(esito)).toMatchObject({ puoNascere: false, motivo: MOTIVO_CARTA_ANCORA_APERTA });
  });

  it('una riga vecchia senza id (la chiamata a Stripe è morta) si libera come prima', async () => {
    const db = dbFinto(riga(new Date(Date.now() - 10 * 60_000).toISOString()));
    const esito = await liberaRiserveAbbandonate(db.client as never, { buyerId: 'maria', soloConProdotti: [PANE] });
    expect(esito.ancoraPagabili).toEqual([]);
    expect(db.scritture.length).toBeGreaterThan(0);
  });
});

describe('30 · il guasto non è una pagina della carta aperta', () => {
  it('con SESSIONE_NON_GUARDATA il motivo è il guasto, e chi chiama lo sa (nonGuardato)', () => {
    const esito = ordineInContantiPuoNascere({ liberati: [], ancoraPagabili: [SESSIONE_NON_GUARDATA] });
    expect(esito).toMatchObject({ puoNascere: false, motivo: MOTIVO_NON_GUARDATO, nonGuardato: true });
  });

  it('la rotta dei contanti risponde 503 sul guasto', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/api/orders/cod/route.ts', 'utf8');
    expect(src).toMatch(/if \(cancelloContanti\.nonGuardato\) \{[\s\S]{0,200}ApiErrors\.unavailable\(cancelloContanti\.motivo\)/);
  });
});
