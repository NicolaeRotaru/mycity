import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

/**
 * 30/10/2026 — Il database finto e il carrello delle prove dell'annullo, in una copia sola.
 *
 * Applica davvero filtri e scritture (come quello di
 * se-un-negozio-rifiuta-la-consegna-si-rifa-sui-negozi-rimasti.test.ts), e in più:
 *  · `prima124: true` fa il database di prima della migrazione 124: la colonna
 *    `gross_total_cents` non c'è, e un'istruzione che la nomina fallisce INTERA
 *    con 42703, come fa PostgreSQL;
 *  · `auth.admin.getUserById` risponde con un indirizzo, così l'email di annullo parte
 *    e la si può leggere dal finto `sendEmail`.
 */
export type Riga = Record<string, unknown>;

const COLONNA_124 = 'gross_total_cents';
const colonnaMancante = { code: '42703', message: `column orders.${COLONNA_124} does not exist` };

export function finto(tabelle: Record<string, Riga[]>, opzioni: { prima124?: boolean } = {}) {
  if (opzioni.prima124) for (const r of tabelle.orders ?? []) delete r[COLONNA_124];
  const from = (t: string) => {
    const righe = (tabelle[t] ??= []);
    const filtri: Array<(r: Riga) => boolean> = [];
    let valori: Riga | null = null;
    let lim = Infinity;
    let unico = false;
    let fuoriSchema = false;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: (colonne?: string) => {
        if (opzioni.prima124 && t === 'orders' && String(colonne ?? '').includes(COLONNA_124)) fuoriSchema = true;
        return q;
      },
      order: () => q,
      update: (v: Riga) => {
        if (opzioni.prima124 && t === 'orders' && COLONNA_124 in v) fuoriSchema = true;
        valori = v;
        return q;
      },
      insert: (v: Riga | Riga[]) => (righe.push(...(Array.isArray(v) ? v : [v])), q),
      eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filtri.push((r) => r[c] !== v), q),
      lt: (c: string, v: unknown) => (filtri.push((r) => String(r[c]) < String(v)), q),
      in: (c: string, vs: unknown[]) => (filtri.push((r) => vs.includes(r[c])), q),
      contains: (c: string, v: string) => {
        const voluti = JSON.parse(v) as Riga[];
        filtri.push((r) =>
          voluti.every((w) => ((r[c] as Riga[]) ?? []).some((x) => Object.entries(w).every(([k, val]) => x[k] === val))),
        );
        return q;
      },
      limit: (n: number) => ((lim = n), q),
      maybeSingle: () => ((unico = true), q),
      single: () => ((unico = true), q),
      then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) => {
        // PostgreSQL non ignora una colonna che non conosce: l'istruzione non tocca niente.
        if (fuoriSchema) return Promise.resolve({ data: null, error: colonnaMancante }).then(ok, ko);
        const prese = righe.filter((r) => filtri.every((f) => f(r)));
        if (valori) for (const r of prese) Object.assign(r, valori);
        const data = prese.slice(0, lim).map((r) => ({ ...r }));
        return Promise.resolve({ data: unico ? (data[0] ?? null) : data, error: null }).then(ok, ko);
      },
    });
    return q;
  };
  const auth = { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: `${id}@esempio.it` } }, error: null }) } };
  return { from, rpc: async () => ({ data: null, error: null }), auth, tabelle };
}

export const ingressi = (merci: number[], veloce = false): IngressiPrezzo => ({
  gruppi: merci.map((s, i) => ({ sellerId: `s${i}`, subtotalCents: s })),
  coordinateNegozio: () => ({ lat: null, lng: null }),
  consegnaLat: null,
  consegnaLng: null,
  pickupInStore: false,
  couponSpedizioneGratis: false,
  couponScontoCents: 0,
  consegnaVeloce: veloce,
});

/** Gli ordini come li scrive la cassa: stessi centesimi di prezziDelCarrello. */
export function carrello(
  nomi: string[],
  merci: number[],
  pagamento: 'cod' | 'card',
  o: { creati?: string[]; veloce?: boolean } = {},
) {
  const e = prezziDelCarrello(ingressi(merci, o.veloce));
  return e.gruppi.map((g, i) => ({
    id: nomi[i],
    user_id: 'u1',
    seller_id: g.sellerId,
    delivery_status: 'NEW',
    payment_method: pagamento,
    payment_status: pagamento === 'card' ? 'PAID' : 'PENDING',
    stripe_payment_intent: pagamento === 'card' ? 'pi_1' : null,
    stripe_session_id: pagamento === 'card' ? 'cs_1' : null,
    total_price: g.totalCents / 100,
    gross_total_cents: g.totalCents,
    wallet_applied_cents: 0,
    shipping_cost: g.shippingCents / 100,
    delivery_fee_cents: g.deliveryFeeCents,
    rider_fee_cents: g.riderFeeCents,
    discount_amount: 0,
    delivery_slot: o.veloce ? ETICHETTA_ADESSO : 'Oggi 18:00-20:00',
    pickup_in_store: false,
    coupon_code: null,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    internal_dispute_status: null,
    created_at: o.creati?.[i] ?? `2026-10-29T10:00:0${i}Z`,
  }));
}

/** Il tentativo di cassa dei contanti: è lui che lega gli ordini dello stesso carrello. */
export const tentativoDiCassa = (ids: string[]) => [{ chiave: 'k', user_id: 'u1', order_ids: ids.map((id) => ({ id })) }];
