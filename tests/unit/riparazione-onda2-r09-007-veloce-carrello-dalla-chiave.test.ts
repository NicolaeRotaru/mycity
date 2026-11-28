import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R09-007 (onda 2) — ANCHE IL FRENO DELLA VELOCE RITROVA IL CARRELLO IN CONTANTI SENZA LA RIGA DEL TENTATIVO.
 *
 * Il freno della veloce non confermata trovava il carrello in contanti solo dalla riga di
 * `cod_checkout_attempts`: senza la riga ogni ordine passava alla fascia da solo, con la sua campanella
 * al cliente, e l'euro della veloce restava sull'ordine che lo portava (R09-013 lo diceva agli
 * amministratori, ma il freno non cambiava). Ora ogni ordine nasce con la chiave del suo carrello
 * (`orders.cod_cart_key`, migrazione 999p): senza la riga il freno legge la chiave e fa
 * esattamente quello che fa con la riga.
 *
 * Mai unire carrelli diversi: contano la chiave e il cliente, non i minuti.
 * (Il banco è quello di riparazione-r09-veloce-contanti-senza-riga.)
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


/** La fotografia del giro: fascia, consegna, fattorino e totale di ogni ordine, e le campanelle al cliente. */
function fotografia() {
  return {
    ordini: db.orders.map((r) => ({
      id: r.id, fascia: r.delivery_slot, consegna: r.delivery_fee_cents, fattorino: r.rider_fee_cents, totale: r.total_price, stato: r.delivery_status,
    })),
    campanelle: (db.notifications ?? []).filter((n) => n.user_id === "maria").length,
  };
}

describe("R09-007 · il freno della veloce ritrova il carrello in contanti dalla chiave sull ordine", () => {
  it("senza la riga ma con la chiave: il freno fa quello che fa con la riga, e nessun avviso", async () => {
    // Con la riga: il carrello si sposta intero.
    db.orders = [ordine(), frutta()];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    await giro();
    const conLaRiga = fotografia();

    // Senza la riga, con la chiave scritta con gli ordini.
    db.orders = [ordine({ cod_cart_key: "ka" }), frutta({ cod_cart_key: "ka" })];
    db.cod_checkout_attempts = [];
    db.notifications = [];
    chiaviAvvisi.clear();
    arrivati.length = 0;
    await giro();

    expect(fotografia(), "senza la riga il freno ha trattato gli ordini uno alla volta").toEqual(conLaRiga);
    expect(daControllare(), "con la chiave il carrello è certo: niente da controllare a mano").toEqual([]);
  });

  it("i due ordini finiscono nella stessa fascia, con una campanella sola al cliente", async () => {
    db.orders = [ordine({ cod_cart_key: "ka" }), frutta({ cod_cart_key: "ka" })];
    await giro();
    const fasce = new Set(db.orders.map((r) => r.delivery_slot));
    expect(fasce.size).toBe(1);
    expect(String([...fasce][0])).toMatch(/^Oggi · /);
    expect(fotografia().campanelle).toBe(1);
  });

  it("un ordine di un altro carrello dello stesso cliente (altra chiave) non entra nel carrello", async () => {
    const latte = ordine({ id: "o3", seller_id: "latte", total_price: 9, gross_total_cents: 900, created_at: "2026-10-30T17:05:30.000Z", delivery_slot: "Oggi · 18:00–19:30", cod_cart_key: "kb" });
    db.orders = [ordine({ cod_cart_key: "ka" }), frutta({ cod_cart_key: "ka" }), latte];
    await giro();
    expect(db.orders.find((r) => r.id === "o3")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", total_price: 9 });
    expect(daControllare()).toEqual([]);
  });

  it("la stessa chiave su un ordine di un altro cliente non conta", async () => {
    db.orders = [ordine({ cod_cart_key: "ka" }), frutta({ id: "luca", user_id: "luca", cod_cart_key: "ka", delivery_slot: "Oggi · 18:00–19:30" })];
    await giro();
    expect(db.orders.find((r) => r.id === "luca")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30" });
  });

  it("senza riga e senza chiave (ordini nati prima della migrazione): come prima, da soli e con l avviso", async () => {
    db.orders = [ordine(), frutta()];
    await giro();
    expect(daControllare()).toHaveLength(1);
  });
});
