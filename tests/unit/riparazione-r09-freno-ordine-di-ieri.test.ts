import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R09-006 — Il giorno che i lavori si riaccendono, il freno della veloce trova anche ordini «Adesso»
 * nati ieri, già oltre la loro scadenza. Prima li spostava su una fascia di «Domani» (contata dal
 * giorno dell'ordine) e scriveva al cliente la fascia nuova; poi arrivava l'annullo. Adesso un ordine
 * già scaduto non si sposta e non si scrive a nessuno: lo annulla expire-stale-orders, che avvisa lui.
 * Rotta vera, database finto, orologio finto (banco di prova copiato da
 * riparazione-r09-freno-scadenza-passata.test.ts).
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const prima: { update?: () => void } = {};
const guasto: { fascia: boolean } = { fascia: false };
const sendEmailMock = vi.fn(async (_m: unknown) => ({ ok: true }));
const chiaviAvvisi = new Set<string>();
const notifyAdminsMock = vi.fn(async (_t: string, _b: string, _l: string, op?: { unaVoltaPer?: string }) => {
  const k = op?.unaVoltaPer;
  if (k && chiaviAvvisi.has(k)) return "gia-mandato";
  if (k) chiaviAvvisi.add(k);
  return "scritto";
});
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
    eq: (k: string, v: unknown) => { filtri.push((r) => r[k] === v); return b; },
    in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
    lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return b; },
    contains: () => b,
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => ({ data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
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
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@esempio.it` } }, error: null }) } },
  }),
}));


/** Venerdì 20/11 alle 18:05 a Piacenza (UTC+1): la veloce dal forno aperto fino alle 21. */
const NATO_IERI = "2026-11-20T17:05:00.000Z";

function ordine(p: Riga = {}): Riga {
  return {
    id: "o1", user_id: "maria", seller_id: "forno", delivery_status: "NEW", delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: "cod", payment_status: "PENDING", total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: null, created_at: NATO_IERI, refunded_amount_cents: 0, stripe_refund_id: null, ...p,
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
  chiaviAvvisi.clear();
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
  refundOrderMock.mockClear();
});
afterEach(() => vi.useRealTimers());

const lunSab: [string, string][] = [["08:00", "21:00"]];
const chiusoDomenica = { mon: lunSab, tue: lunSab, wed: lunSab, thu: lunSab, fri: lunSab, sat: lunSab, sun: [] };

/** Sabato 21/11 alle 10:00 a Piacenza: il primo giro dopo la riaccensione dei lavori. */
const RIACCENSIONE = "2026-11-21T09:00:00.000Z";

describe("il freno non sposta un ordine veloce già scaduto", () => {
  it("ordine veloce nato ieri sera, giro alla riaccensione: resta com'è, nessuna fascia nuova al cliente", async () => {
    db.profiles = [{ id: "forno", store_hours: chiusoDomenica }];
    db.orders = [ordine({ created_at: NATO_IERI })];
    const { corpo } = await giro(RIACCENSIONE);
    expect(o("o1").delivery_slot, "il freno ha spostato un ordine già scaduto").toBe(ETICHETTA_ADESSO);
    expect(corpo).toMatchObject({ ok: true, spostati: 0, giaScaduti: 1 });
    expect(db.notifications.filter((n) => n.user_id === "maria"), "il cliente ha ricevuto una fascia nuova per un ordine che si annulla").toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it("anche senza orari del negozio: nato ieri, oltre le tre ore, non si sposta", async () => {
    db.profiles = [{ id: "forno", store_hours: null }];
    db.orders = [ordine({ created_at: NATO_IERI })];
    const { corpo } = await giro(RIACCENSIONE);
    expect(o("o1").delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(corpo).toMatchObject({ ok: true, spostati: 0, giaScaduti: 1 });
    expect(db.notifications.filter((n) => n.user_id === "maria")).toHaveLength(0);
  });

  it("controprova: l'ordine di dodici minuti fa con la scadenza davanti si sposta ancora, e il cliente lo sa", async () => {
    db.profiles = [{ id: "forno", store_hours: chiusoDomenica }];
    db.orders = [ordine({ created_at: "2026-11-21T08:48:00.000Z" })];
    const { corpo } = await giro(RIACCENSIONE);
    expect(corpo).toMatchObject({ ok: true, spostati: 1 });
    expect(String(o("o1").delivery_slot)).toMatch(/^Oggi · /);
    expect(db.notifications.filter((n) => n.user_id === "maria").length).toBeGreaterThan(0);
  });
});
