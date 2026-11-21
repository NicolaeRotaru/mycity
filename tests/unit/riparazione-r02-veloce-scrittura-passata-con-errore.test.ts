import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R02-003 — Carrello di più negozi: la scrittura del secondo ordine PASSA nel database ma la risposta
 * torna con un errore (un timeout dopo il salvataggio).
 *
 * Il freno rilegge gli ordini rimasti indietro: quello che trova già nella fascia era «a posto», ma
 * non entrava fra gli ordini scritti. Due casi con la stessa causa:
 * (a) l'euro della veloce stava su quell'ordine: la consegna era già scesa di 1 €, eppure cliente e
 *     amministratori leggevano «rendilo a mano» (l'euro poteva tornare due volte);
 * (b) l'euro stava sul primo ordine e il secondo era già confermato dal suo negozio: negozio e
 *     fattorino non ricevevano «il carrello ha cambiato fascia», e il cliente leggeva «puoi annullarlo»
 *     su un ordine che non si annulla più.
 * (Banco di prova copiato da riparazione-r04-veloce-carrello-a-meta.test.ts.)
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const prima: { update?: () => void } = {};
const guasto: { fascia: boolean; ordine: string | null; passaConErrore: string | null } = { fascia: false, ordine: null, passaConErrore: null };
const sendEmailMock = vi.fn(async (_m: unknown) => ({ ok: true }));
const chiaviAvvisi = new Set<string>();
const notifyAdminsMock = vi.fn(async (_t: string, _b: string, _l: string, op?: { unaVoltaPer?: string }) => {
  const k = op?.unaVoltaPer;
  if (k && chiaviAvvisi.has(k)) return "gia-mandato";
  if (k) chiaviAvvisi.add(k);
  return "scritto";
});
const rpcMock = vi.fn(async (_n: string, _a: unknown) => ({ data: null, error: null }));
const refundOrderMock = vi.fn(async (a: { orderId: string; amountCents: number }) => {
  const r = db.orders.find((x) => x.id === a.orderId)!;
  r.refunded_amount_cents = Number(r.refunded_amount_cents ?? 0) + a.amountCents;
  r.stripe_refund_id = "re_1";
  return { refundId: "re_1", reversedCents: 0, pieno: false, importoCents: a.amountCents };
});

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let quante = Infinity;
  let perId: unknown = null;
  const esegui = () => {
    if (valori && prima.update) { const f = prima.update; prima.update = undefined; f(); }
    const trovate = (db[nome] ?? []).filter((r) => filtri.every((f) => f(r))).slice(0, quante);
    if (valori) for (const r of trovate) Object.assign(r, valori);
    return trovate.map((r) => ({ ...r }));
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Riga) => { valori = v; return b; },
    insert: async (righe: Riga | Riga[]) => { (db[nome] ??= []).push(...(Array.isArray(righe) ? righe : [righe])); return { error: null }; },
    eq: (k: string, v: unknown) => { if (k === "id") perId = v; filtri.push((r) => r[k] === v); return b; },
    in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
    lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return b; },
    contains: () => b,
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => ({ data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      // La scrittura passa nel database, ma la risposta torna con un errore (timeout dopo il commit).
      if (nome === "orders" && valori && "delivery_slot" in valori && guasto.passaConErrore && perId === guasto.passaConErrore) {
        esegui();
        return Promise.resolve({ data: null, error: { message: "timeout dopo il salvataggio" } }).then(ok, ko);
      }
      if (nome === "orders" && valori && "delivery_slot" in valori && guasto.ordine && perId === guasto.ordine) {
        return Promise.resolve({ data: null, error: { message: "timeout del database" } }).then(ok, ko);
      }
      if (nome === "orders" && valori && "delivery_slot" in valori && guasto.fascia) {
        return Promise.resolve({ data: null, error: { message: "timeout del database" } }).then(ok, ko);
      }
      return Promise.resolve({ data: esegui(), error: null }).then(ok, ko);
    },
  };
  return b;
}

vi.mock("@/lib/api/middleware", () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
  withAuthRateLimit: (_o: unknown, h: (a: unknown) => unknown) => (req: unknown, ctx?: { params?: Record<string, string> }) =>
    h({ req, user: { id: "maria" }, params: ctx?.params ?? {} }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (m: unknown) => sendEmailMock(m) }));
vi.mock("@/lib/stripe/payout", () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrderMock(a) }));
vi.mock("@/lib/stripe/webhook/comune", async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: (t: string, b: string, l: string, op?: { unaVoltaPer?: string }) => notifyAdminsMock(t, b, l, op),
}));
vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
    rpc: async (nome: string, a: unknown) => rpcMock(nome, a),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@esempio.it` } }, error: null }) } },
  }),
}));

/** 18:05 a Piacenza (il 30/10 l ora legale è già finita: UTC+1). */
const NATO = "2026-10-30T17:05:00.000Z";

function ordine(p: Riga = {}): Riga {
  return {
    id: "o1", user_id: "maria", seller_id: "forno", delivery_status: "NEW", delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: "cod", payment_status: "PENDING", total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: null, created_at: NATO, refunded_amount_cents: 0, stripe_refund_id: null, ...p,
  };
}

async function giro(ora: string) {
  vi.setSystemTime(new Date(ora));
  const { GET } = await import("@/app/api/cron/veloce-non-confermata/route");
  const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request("http://x/api/cron/veloce-non-confermata"));
  return { status: res.status, corpo: await res.json() };
}

const o = (id: string) => db.orders.find((r) => r.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db.orders = [];
  db.profiles = [{ id: "forno", store_hours: null }];
  db.cod_checkout_attempts = [];
  db.notifications = [];
  prima.update = undefined;
  guasto.fascia = false;
  guasto.ordine = null;
  guasto.passaConErrore = null;
  chiaviAvvisi.clear();
  rpcMock.mockClear();
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
  refundOrderMock.mockClear();
});
afterEach(() => vi.useRealTimers());


const avvisi = () => notifyAdminsMock.mock.calls.map((c) => `${c[0]} — ${c[1]}`);
const campanella = () => db.notifications.filter((n) => n.user_id === "maria").map((n) => String(n.body));

function carrelloDiDueNegozi(o2: Riga = {}) {
  db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
  db.orders = [
    ordine(),
    ordine({ id: "o2", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z", ...o2 }),
  ];
  db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
}

const avvisiA = (chi: string) => db.notifications.filter((n) => n.user_id === chi).map((n) => `${n.title} — ${n.body}`);

describe("R02-003 · la scrittura del secondo ordine passa ma risponde errore", () => {
  it("(a) l'euro della veloce stava su quell'ordine: è già tolto, nessuno legge «a mano», e il giro dopo non ripete niente", async () => {
    // L'ordine del forno (consegna 4 € con la veloce) è il primo del carrello ed è già confermato;
    // quello della frutta non lo è, e fa scattare il freno.
    db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
    db.orders = [
      ordine({ id: "o2", delivery_status: "ACCEPTED" }),
      ordine({ id: "o1", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o2" }, { id: "o1" }] }];
    guasto.passaConErrore = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    const fascia = String(o("o1").delivery_slot);
    expect(fascia).toMatch(/^Oggi · /);
    // Nel database l'ordine del forno è già nella fascia, con l'euro tolto.
    expect(o("o2")).toMatchObject({ delivery_slot: fascia, delivery_fee_cents: 300, total_price: 18 });

    expect(campanella()).toHaveLength(1);
    const frase = campanella()[0];
    expect(frase, "l'euro è già tolto: niente «a mano»").not.toContain("a mano");
    expect(frase).toContain("non lo paghi");
    expect(frase).toContain("alla porta paghi 31,00");
    expect(frase).not.toContain("tranne");
    expect(avvisi().filter((a) => a.includes("a mano")), "gli amministratori non rendono l'euro una seconda volta").toEqual([]);
    expect(avvisiA("forno").some((a) => a.includes("Il carrello ha cambiato fascia") && a.includes("#O2"))).toBe(true);

    notifyAdminsMock.mockClear();
    guasto.passaConErrore = null;
    await giro("2026-10-30T17:21:00.000Z");
    expect(campanella()).toHaveLength(1);
    expect(o("o2")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 100, total_price: 13 });
    expect(avvisi()).toEqual([]);
  });

  it("(a) con l'euro pagato col credito MyCity: torna sul credito una volta e la frase lo dice, senza «a mano»", async () => {
    db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
    db.orders = [
      ordine({ id: "o2", delivery_status: "ACCEPTED", total_price: 0, wallet_applied_cents: 1900 }),
      ordine({ id: "o1", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o2" }, { id: "o1" }] }];
    guasto.passaConErrore = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    const fascia = String(o("o1").delivery_slot);
    expect(o("o2")).toMatchObject({ delivery_slot: fascia, delivery_fee_cents: 300, wallet_applied_cents: 1800 });
    expect(rpcMock.mock.calls.filter((c) => c[0] === "wallet_credit")).toHaveLength(1);
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toMatch(/1,00\s€ ti torna sul credito MyCity/);
    expect(campanella()[0]).toContain("alla porta paghi 13,00");
    expect(campanella()[0]).not.toContain("a mano");
    expect(avvisi().filter((a) => a.includes("a mano"))).toEqual([]);

    guasto.passaConErrore = null;
    await giro("2026-10-30T17:21:00.000Z");
    expect(rpcMock.mock.calls.filter((c) => c[0] === "wallet_credit")).toHaveLength(1);
    expect(campanella()).toHaveLength(1);
  });

  it("(b) euro sul primo ordine, secondo già confermato: negozio e fattorino del secondo lo sanno, e il cliente non legge che lo può annullare", async () => {
    carrelloDiDueNegozi({ delivery_status: "ASSIGNED", rider_id: "luca" });
    guasto.passaConErrore = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    const fascia = String(o("o1").delivery_slot);
    expect(fascia).toMatch(/^Oggi · /);
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_slot: fascia, delivery_fee_cents: 100, total_price: 13 });

    expect(avvisiA("frutta").filter((a) => a.includes("Il carrello ha cambiato fascia") && a.includes("#O2")), "il negozio del secondo ordine").toHaveLength(1);
    expect(avvisiA("luca").filter((a) => a.includes("Consegna spostata in una fascia") && a.includes(fascia)), "il fattorino del secondo ordine").toHaveLength(1);

    expect(campanella()).toHaveLength(1);
    const frase = campanella()[0];
    expect(frase).toContain("L’ordine che un negozio ha già confermato non si annulla più");
    expect(frase).not.toContain("tranne");
    expect(frase).toContain("alla porta paghi 31,00");
    expect(avvisi().filter((a) => a.includes("a mano") || a.includes("mettilo tu"))).toEqual([]);

    // Il giro dopo non ritrova niente: nessuna campanella doppia, a nessuno.
    notifyAdminsMock.mockClear();
    guasto.passaConErrore = null;
    await giro("2026-10-30T17:21:00.000Z");
    expect(campanella()).toHaveLength(1);
    expect(avvisiA("frutta")).toHaveLength(1);
    expect(avvisiA("luca")).toHaveLength(1);
    expect(avvisi()).toEqual([]);
  });

  it("un ordine di un altro carrello dello stesso cliente non si tocca", async () => {
    carrelloDiDueNegozi({ delivery_status: "ACCEPTED" });
    db.orders.push(ordine({ id: "x9", seller_id: "forno", delivery_status: "ACCEPTED", created_at: "2026-10-30T16:00:00.000Z" }));
    guasto.passaConErrore = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("x9")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400, total_price: 19 });
    expect(db.notifications.some((n) => String(n.body).includes("#X9"))).toBe(false);
  });
});
