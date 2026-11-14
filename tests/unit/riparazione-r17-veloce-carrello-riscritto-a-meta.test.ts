import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * R17-012 — Il giro dopo una scrittura caduta a metà non promette al cliente un euro già tolto.
 *
 * Contanti, carrello di due negozi: il forno (19 €, consegna 4 € con la veloce) e la frutta (13 €,
 * consegna 1 €). Il forno non conferma in 10 minuti. Il giro delle 18:16 riscrive l'ordine del forno
 * (consegna 4 € -> 3 €, l'euro della veloce tolto) e cade sulla scrittura dell'ordine della frutta.
 * Prima: al giro dopo il conto del carrello non si riconosceva più (l'ordine del forno era già senza
 * la veloce), l'euro andava «a mano», Maria leggeva «te lo rendiamo a mano» e gli amministratori
 * «rendi l'euro se c'era»: un euro già tolto poteva tornare due volte. E l'avviso del guasto non
 * diceva che l'euro era già tolto. Adesso l'avviso lo dice, e il giro dopo riconosce il conto
 * riscritto a metà: Maria legge che l'euro non lo paga e quanto paga alla porta.
 * (Banco di prova copiato da riparazione-r09-carrello-spostato-a-meta.test.ts.)
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

function carrelloDiDueNegozi() {
  db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
  db.orders = [
    ordine(),
    ordine({ id: "o2", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
  ];
  db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
}

describe("R17-012 · il carrello riscritto a metà non promette un euro già tolto", () => {
  it("l avviso del guasto dice che l euro è già tolto, e il giro dopo non scrive «a mano» a nessuno", async () => {
    carrelloDiDueNegozi();
    guasto.ordine = "o2";
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18, gross_total_cents: 1800 });
    expect(o("o2").delivery_slot).toBe(ETICHETTA_ADESSO);
    const guastoAMeta = avvisi().find((a) => a.includes("fermo a metà"));
    expect(guastoAMeta, "c è l avviso del freno fermo a metà").toBeTruthy();
    expect(guastoAMeta).toContain("#O1");
    expect(guastoAMeta, "l avviso non dice che l euro è già tolto").toContain("euro della veloce già tolto");
    expect(campanella()).toEqual([]);

    guasto.ordine = null;
    notifyAdminsMock.mockClear();
    const secondo = await giro("2026-10-30T17:21:00.000Z");
    expect(secondo.corpo).toMatchObject({ ok: true, spostati: 1, daSistemareAMano: 0 });
    expect(o("o2").delivery_slot).toBe(o("o1").delivery_slot);
    // Il conto resta quello giusto: l'euro tolto una volta, dall'ordine del forno.
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_fee_cents: 100, total_price: 13 });

    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain("non lo paghi");
    expect(campanella()[0]).toContain("alla porta paghi 31,00");
    expect(campanella()[0]).not.toContain("a mano");
    expect(avvisi().filter((a) => a.includes("a mano"))).toEqual([]);
  });

  it("senza guasti il carrello si sposta in un giro, come prima", async () => {
    carrelloDiDueNegozi();
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_fee_cents: 100, total_price: 13 });
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain("alla porta paghi 31,00");
  });

  it("un conto cambiato da altro (non dal freno) resta a una persona, come prima", async () => {
    carrelloDiDueNegozi();
    // Qualcuno ha già messo in fascia l ordine della frutta con una consegna che la regola non dà.
    Object.assign(o("o2"), { delivery_slot: "Oggi · 18:00–19:30", delivery_fee_cents: 250, total_price: 14.5, gross_total_cents: 1450 });
    await giro("2026-10-30T17:16:00.000Z");
    expect(campanella()[0]).toContain("te lo rendiamo a mano");
  });
});
