import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R09-013 (campagna 26/11) — Il freno della veloce in contanti, se manca la riga del carrello in
 * `cod_checkout_attempts`, trattava ogni ordine da solo senza dirlo a nessuno: gli ordini dello stesso
 * carrello passavano alla fascia uno alla volta, con due campanelle, e nessun avviso.
 *
 * Regola (come nell'annullo): gli ordini non si uniscono mai perché sono nati vicini. Il freno non
 * sposta niente in più, ma gli amministratori lo sanno, una volta per gruppo, con i codici degli
 * ordini da guardare; e resta una riga nel registro.
 *
 * Il database finto applica i filtri che il freno usa (anche `contains` sugli id della riga).
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const chiaviAvvisi = new Set<string>();
/** Gli avvisi arrivati davvero agli amministratori (non quelli fermati da `unaVoltaPer`). */
const arrivati: Array<{ titolo: string; corpo: string; chiave?: string }> = [];
const notifyAdminsMock = vi.fn(async (t: string, b: string, _l: string, op?: { unaVoltaPer?: string }) => {
  const k = op?.unaVoltaPer;
  if (k && chiaviAvvisi.has(k)) return "gia-mandato";
  if (k) chiaviAvvisi.add(k);
  arrivati.push({ titolo: t, corpo: b, chiave: k });
  return "scritto";
});
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() }));

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let quante = Infinity;
  const esegui = () => {
    const trovate = (db[nome] ?? []).filter((r) => filtri.every((f) => f(r))).slice(0, quante);
    if (valori) for (const r of trovate) Object.assign(r, valori);
    return trovate.map((r) => ({ ...r }));
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Riga) => { valori = v; return b; },
    insert: async (righe: Riga | Riga[]) => { (db[nome] ??= []).push(...(Array.isArray(righe) ? righe : [righe])); return { error: null }; },
    eq: (k: string, v: unknown) => { filtri.push((r) => r[k] === v); return b; },
    neq: (k: string, v: unknown) => { filtri.push((r) => r[k] !== v); return b; },
    in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
    lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return b; },
    contains: (k: string, v: string) => {
      const cercati = (JSON.parse(v) as Array<{ id: string }>).map((x) => x.id);
      filtri.push((r) => cercati.every((id) => ((r[k] as Array<{ id: string }>) ?? []).some((x) => x.id === id)));
      return b;
    },
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => ({ data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: esegui(), error: null }).then(ok, ko),
  };
  return b;
}

const admin = {
  from: (t: string) => tabella(t),
  rpc: async () => ({ data: null, error: null }),
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@esempio.it` } }, error: null }) } },
};

vi.mock("@/lib/logger", () => ({ logger }));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/stripe/payout", () => ({ refundOrder: vi.fn(async () => ({ refundId: "re_1", reversedCents: 0, pieno: false, importoCents: 100 })) }));
vi.mock("@/lib/stripe/webhook/comune", async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: (t: string, b: string, l: string, op?: { unaVoltaPer?: string }) => notifyAdminsMock(t, b, l, op),
}));
vi.mock("@/lib/supabase/server", () => ({ getAdminSupabase: () => admin }));

import { frenoDellaVeloce } from "@/lib/ordini/veloce-non-confermata";

/** 18:05 a Piacenza (il 30/10 l ora legale è già finita: UTC+1). */
const NATO = "2026-10-30T17:05:00.000Z";
const ADESSO = "2026-10-30T17:16:00.000Z";

function ordine(p: Riga = {}): Riga {
  return {
    id: "o1", user_id: "maria", seller_id: "forno", delivery_status: "NEW", delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: "cod", payment_status: "PENDING", total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: null, created_at: NATO, refunded_amount_cents: 0, stripe_refund_id: null, ...p,
  };
}
/** La frutta dello stesso carrello di Maria: 13 €, nata un millesimo dopo il pane. */
const frutta = (p: Riga = {}) =>
  ordine({ id: "o2", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z", ...p });

async function giro() {
  vi.setSystemTime(new Date(ADESSO));
  return frenoDellaVeloce(admin as never, new Date(ADESSO));
}
const daControllare = () => arrivati.filter((a) => /carrello da controllare a mano/.test(a.titolo));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db.orders = [];
  db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }, { id: "latte", store_hours: null }];
  db.cod_checkout_attempts = [];
  db.notifications = [];
  chiaviAvvisi.clear();
  arrivati.length = 0;
  notifyAdminsMock.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("R09-013 · il freno della veloce in contanti senza la riga del carrello non passa in silenzio", () => {
  it("due ordini dello stesso cliente nati insieme, senza riga: gli amministratori lo sanno una volta, con i due codici", async () => {
    db.orders = [ordine(), frutta()];
    await giro();
    // Il freno non li unisce: ognuno passa alla fascia da solo, come prima.
    expect(String(db.orders[0].delivery_slot)).toMatch(/^Oggi · /);
    const a = daControllare();
    expect(a, "una volta per gruppo, non una per ordine").toHaveLength(1);
    expect(a[0].corpo).toContain("#O1");
    expect(a[0].corpo).toContain("#O2");
    expect(a[0].corpo).toContain("da solo");
    expect(a[0].chiave).toBe("veloce-carrello-senza-riga-o1-o2");
    // E resta la riga nel registro.
    expect(logger.warn.mock.calls.some((c) => /carrello in contanti senza riga/.test(String(c[0])))).toBe(true);
  });

  it("con la riga del carrello il freno sposta il carrello intero, e nessun avviso", async () => {
    db.orders = [ordine(), frutta()];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    await giro();
    expect(daControllare()).toEqual([]);
  });

  it("un ordine da solo, senza riga e senza altri ordini vicini, non manda avvisi", async () => {
    db.orders = [ordine()];
    await giro();
    expect(String(db.orders[0].delivery_slot)).toMatch(/^Oggi · /);
    expect(daControllare()).toEqual([]);
  });

  it("l ordine vicino che sta nella riga di un altro carrello è di quel carrello: non si nomina", async () => {
    const latte = ordine({ id: "o3", seller_id: "latte", total_price: 9, gross_total_cents: 900, created_at: "2026-10-30T17:04:30.000Z", delivery_slot: "Oggi · 18:00–19:30" });
    db.orders = [ordine(), latte];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o3" }] }];
    await giro();
    expect(daControllare()).toEqual([]);
  });

  it("non conta gli ordini pagati con la carta, quelli annullati, quelli di un altro cliente o nati più di due minuti prima", async () => {
    db.orders = [
      ordine(),
      frutta({ id: "carta", payment_method: "card", stripe_session_id: "cs_1", delivery_slot: "Oggi · 18:00–19:30" }),
      frutta({ id: "annullato", delivery_status: "CANCELED" }),
      frutta({ id: "luca", user_id: "luca" }),
      frutta({ id: "prima", created_at: "2026-10-30T17:02:00.000Z", delivery_slot: "Oggi · 18:00–19:30" }),
    ];
    await giro();
    expect(daControllare()).toEqual([]);
  });
});
