import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R09-013 — Il giorno che i lavori si riaccendono, il freno trova ordini «Adesso» nati giorni prima.
 * Prima scriveva al cliente una scadenza già passata («se non conferma entro le … di venerdì 30/10»).
 * Adesso un ordine già scaduto non si scrive a nessuno: lo annulla expire-stale-orders.
 * (Banco di prova copiato da il-freno-della-veloce-dice-il-vero-a-chi-deve-saperlo.test.ts.)
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
const avvisi = () => notifyAdminsMock.mock.calls.map((c) => ({ titolo: c[0], corpo: c[1], chiave: c[3]?.unaVoltaPer }));

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

describe("R09-013 · il freno non manda una scadenza già passata", () => {
  it("ordine veloce nato il 30/10, giro alla riaccensione del 20/11: nessuna frase al cliente né agli amministratori", async () => {
    db.profiles = [{ id: "forno", store_hours: chiusoDomenica }];
    db.orders = [ordine()];
    const { corpo } = await giro("2026-11-20T09:00:00.000Z");
    expect(corpo).toMatchObject({ ok: true, spostati: 0, giaScaduti: 1 });
    expect(db.notifications.filter((n) => n.user_id === "maria")).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(avvisi().filter((a) => /non si è potuto spostare/.test(a.titolo))).toHaveLength(0);
    expect(o("o1").delivery_slot).toBe(ETICHETTA_ADESSO);
  });

  it("un ordine di pochi minuti fa con la scadenza ancora davanti viene ancora avvisato", async () => {
    // Orari non leggibili: il carrello non si sposta e il cliente legge l'ora vera dell'annullo.
    db.profiles = [];
    db.orders = [ordine()];
    await giro("2026-10-30T17:16:00.000Z");
    expect(db.notifications.filter((n) => n.user_id === "maria").length).toBe(1);
  });
});
