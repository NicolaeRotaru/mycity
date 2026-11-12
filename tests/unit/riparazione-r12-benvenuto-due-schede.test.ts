/**
 * R12-004 — Lo stesso cliente poteva usare il codice «solo primo ordine» due
 * volte, aprendo la cassa in due schede: validateCoupon contava zero ordini in
 * tutte e due (il primo non era ancora nato) e claim_coupon scalava il
 * contatore senza sapere chi lo usava. Qui la rivendicazione porta il cliente,
 * e il database finto si comporta come la migrazione 361 (blocco per codice e
 * cliente); senza la 361 (PGRST202) si torna alla firma vecchia.
 * La regola nel database vero: tests/sql/rls/riparazione-r12-benvenuto-una-volta.test.sql.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/coupons', () => ({
  validateCoupon: vi.fn(async () => ({
    ok: true,
    coupon: { code: 'BENVENUTO5', first_order_only: true },
    discount: 5,
    freeShipping: false,
  })),
}));

import { rivendicaIlCodiceSconto } from '@/lib/ordini/rivendica-il-codice-sconto';

/** Il database dopo la 361: la firma a due argomenti blocca il secondo uso dello stesso cliente. */
function databaseCon361() {
  const rivendicati = new Set<string>();
  const chiamate: Array<Record<string, unknown>> = [];
  return {
    chiamate,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chiamate.push({ nome, ...args });
      if (nome !== 'claim_coupon') return { data: null, error: { message: 'inatteso' } };
      if (!('p_user_id' in args)) return { data: true, error: null }; // firma vecchia: non sa chi
      const chiave = `${args.p_code}|${args.p_user_id}`;
      if (rivendicati.has(chiave)) return { data: false, error: null };
      rivendicati.add(chiave);
      return { data: true, error: null };
    },
  };
}

const libere = { liberati: [], ancoraPagabili: [] };
const lettura = { from: () => ({}) };
const richiesta = (userId: string) => ({ codice: 'BENVENUTO5', subtotaleCents: 3000, userId });

describe('R12-004 il benvenuto non si prende due volte con due schede', () => {
  let db: ReturnType<typeof databaseCon361>;
  beforeEach(() => {
    db = databaseCon361();
  });

  it('due schede dello stesso cliente quasi insieme: una sola ha lo sconto', async () => {
    const [a, b] = await Promise.all([
      rivendicaIlCodiceSconto(libere, { admin: db, lettura }, richiesta('maria')),
      rivendicaIlCodiceSconto(libere, { admin: db, lettura }, richiesta('maria')),
    ]);
    expect([a.ok, b.ok].filter(Boolean), 'dieci euro di benvenuto invece di cinque').toHaveLength(1);
    expect(db.chiamate.every((c) => c.p_user_id === 'maria'), 'la rivendicazione deve dire chi è il cliente').toBe(true);
  });

  it('un altro cliente lo rivendica lo stesso', async () => {
    const a = await rivendicaIlCodiceSconto(libere, { admin: db, lettura }, richiesta('maria'));
    const b = await rivendicaIlCodiceSconto(libere, { admin: db, lettura }, richiesta('luca'));
    expect(a.ok && b.ok).toBe(true);
  });

  it('senza la migrazione 361 (PGRST202) si torna alla firma vecchia e la cassa non si ferma', async () => {
    const vecchio = {
      chiamate: [] as Array<Record<string, unknown>>,
      rpc: async (nome: string, args: Record<string, unknown>) => {
        vecchio.chiamate.push({ nome, ...args });
        if ('p_user_id' in args) return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
        return { data: true, error: null };
      },
    };
    const esito = await rivendicaIlCodiceSconto(libere, { admin: vecchio, lettura }, richiesta('maria'));
    expect(esito.ok).toBe(true);
    expect(vecchio.chiamate).toHaveLength(2);
  });
});
