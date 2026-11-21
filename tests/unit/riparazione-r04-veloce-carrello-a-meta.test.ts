import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R04-008 — Carrello di più negozi: se cade la scrittura del secondo ordine, il primo non resta
 * spostato in silenzio.
 *
 * Scelta di Nicola (21/11): il primo ordine resta nella fascia nuova, niente marcia indietro. Il
 * secondo non si perde: se è ancora nuovo lo riprende il giro dopo del freno (che cerca proprio gli
 * ordini nuovi e «Adesso»); se il suo negozio l'aveva già confermato il freno non lo ritroverebbe mai,
 * e allora il cliente legge subito quale ordine non è passato alla fascia (non «tutta la spesa») e gli
 * amministratori quale mettere nella stessa fascia. L'euro della veloce, il rimborso sulla carta e la
 * campanella non vanno due volte e non si perdono.
 * Prima: con il secondo ordine già confermato il giro si fermava sull'errore, il cliente non sapeva
 * niente nemmeno del primo ordine spostato, e il giro dopo non ritrovava più il carrello.
 * (Banco di prova copiato da riparazione-r17-veloce-carrello-riscritto-a-meta.test.ts.)
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const prima: { update?: () => void } = {};
const guasto: { fascia: boolean; ordine: string | null } = { fascia: false, ordine: null };
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db.orders = [];
  db.profiles = [{ id: "forno", store_hours: null }];
  db.cod_checkout_attempts = [];
  db.notifications = [];
  prima.update = undefined;
  guasto.fascia = false;
  guasto.ordine = null;
  chiaviAvvisi.clear();
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

describe("R04-008 · il secondo ordine del carrello non si perde se la sua scrittura cade", () => {
  it("secondo ordine già confermato dal suo negozio: il cliente legge quale ordine non è passato, gli admin quale sistemare, il giro dopo non ripete niente", async () => {
    carrelloDiDueNegozi({ delivery_status: "ACCEPTED" });
    guasto.ordine = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    const fascia = String(o("o1").delivery_slot);
    expect(fascia).toMatch(/^Oggi · /);
    // Il primo resta nella fascia nuova, con l'euro della veloce tolto una volta.
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o2").delivery_slot).toBe(ETICHETTA_ADESSO);

    expect(campanella(), "il cliente sa che il carrello è cambiato").toHaveLength(1);
    const frase = campanella()[0];
    expect(frase).toContain(fascia);
    expect(frase, "la frase non dice che arriva tutta la spesa").toContain("(tranne l’ordine #O2)");
    expect(frase).toContain("L’ordine #O2 non siamo riusciti a spostarlo");
    expect(frase).toContain("alla porta paghi 31,00");
    const email = sendEmailMock.mock.calls.map((c) => String((c[0] as { text?: string }).text ?? ""));
    expect(email.some((t) => t.includes("(tranne l’ordine #O2)"))).toBe(true);

    const daSistemare = avvisi().filter((a) => a.includes("#O2 (ACCEPTED)"));
    expect(daSistemare, "gli amministratori sanno quale ordine mettere nella fascia").toHaveLength(1);
    expect(daSistemare[0]).toContain(`mettilo tu nella fascia ${fascia}`);
    expect(daSistemare[0]).toContain("timeout del database");

    // Il giro dopo non ritrova il carrello (l'ordine rimasto non è più nuovo): niente di doppio.
    notifyAdminsMock.mockClear();
    guasto.ordine = null;
    await giro("2026-10-30T17:21:00.000Z");
    expect(campanella()).toHaveLength(1);
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 100, total_price: 13 });
    expect(avvisi()).toEqual([]);
  });

  it("con la carta: l'euro torna sulla carta una volta, e la frase dice il vero sull'ordine rimasto", async () => {
    carrelloDiDueNegozi({ delivery_status: "ACCEPTED", payment_method: "card", stripe_session_id: "cs_1" });
    Object.assign(o("o1"), { payment_method: "card", stripe_session_id: "cs_1" });
    guasto.ordine = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain("(tranne l’ordine #O2)");
    expect(campanella()[0]).toContain("ti torna sulla carta");
    guasto.ordine = null;
    await giro("2026-10-30T17:21:00.000Z");
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(campanella()).toHaveLength(1);
  });

  it("l'euro della veloce sta sull'ordine rimasto: «a mano» una volta, e il freno non lo toglie dopo", async () => {
    // L'ordine del forno (consegna 4 € con la veloce) è il primo del carrello ed è già confermato; quello
    // della frutta non lo è, e fa scattare il freno.
    db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
    db.orders = [
      ordine({ id: "o2", delivery_status: "ACCEPTED" }),
      ordine({ id: "o1", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o2" }, { id: "o1" }] }];
    guasto.ordine = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1").delivery_slot).toMatch(/^Oggi · /);
    expect(o("o2")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400 });
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain("(tranne l’ordine #O2)");
    expect(campanella()[0]).toContain("te lo rendiamo a mano");
    expect(campanella()[0]).not.toContain("non lo paghi");
    expect(avvisi().filter((a) => a.includes("rendilo a mano"))).toHaveLength(1);
    guasto.ordine = null;
    notifyAdminsMock.mockClear();
    await giro("2026-10-30T17:21:00.000Z");
    expect(o("o2")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400 });
    expect(campanella()).toHaveLength(1);
    expect(avvisi()).toEqual([]);
  });

  it("il negozio del secondo ordine lo conferma mentre il freno sposta il primo: niente «tutta la spesa in fascia»", async () => {
    carrelloDiDueNegozi();
    prima.update = () => { o("o2").delivery_status = "ACCEPTED"; };
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1").delivery_slot).toMatch(/^Oggi · /);
    expect(o("o2").delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain("(tranne l’ordine #O2)");
    expect(avvisi().some((a) => a.includes("#O2 (ACCEPTED)") && a.includes("cambiato nel frattempo"))).toBe(true);
  });

  it("secondo ordine ancora nuovo: il giro dopo lo mette nella stessa fascia e scrive al cliente una volta sola", async () => {
    carrelloDiDueNegozi();
    guasto.ordine = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    const fascia = String(o("o1").delivery_slot);
    expect(o("o2").delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(campanella(), "il cliente lo legge quando il carrello è tutto in fascia").toEqual([]);
    expect(avvisi().some((a) => a.includes("fermo a metà"))).toBe(true);
    guasto.ordine = null;
    await giro("2026-10-30T17:21:00.000Z");
    expect(o("o2").delivery_slot).toBe(fascia);
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).not.toContain("tranne");
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_fee_cents: 100, total_price: 13 });
  });
});
