import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";
import { scadenzaAccettazione } from "@/lib/ordini/scadenza-accettazione";

/**
 * IL SECONDO FRENO DELLA VELOCE (carta #220, scelta di Nicola del 30/10 alle 16:13).
 *
 * La veloce promette 30-60 minuti dalla conferma del negozio e costa 1 € in più. Prima, se il
 * negozio non confermava, l ordine restava «Adesso» per tre ore e poi moriva: il cliente aspettava
 * e la veloce l aveva pagata. Adesso, dopo 10 minuti senza conferma, il carrello passa alla prima
 * fascia ancora possibile e l euro della veloce non si paga.
 *
 * La prova chiama la rotta vera, su un database finto che applica davvero i filtri delle scritture
 * (così una scrittura condizionata che non trova la riga non scrive niente), con un orologio finto.
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const prima: { update?: () => void } = {};
const sendEmailMock = vi.fn(async (_m: unknown) => ({ ok: true }));
const notifyAdminsMock = vi.fn(async (..._a: unknown[]) => undefined);

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
    contains: (k: string, v: string) => {
      const ids = (JSON.parse(v) as Array<{ id: string }>).map((x) => x.id);
      filtri.push((r) => ids.every((id) => ((r[k] as Array<{ id: string }>) ?? []).some((x) => x.id === id)));
      return b;
    },
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => ({ data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve({ data: esegui(), error: null }).then(ok, ko),
  };
  return b;
}

vi.mock("@/lib/api/middleware", () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (m: unknown) => sendEmailMock(m) }));
vi.mock("@/lib/stripe/webhook/comune", async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: (...a: unknown[]) => notifyAdminsMock(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
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
    stripe_session_id: null, created_at: NATO, ...p,
  };
}

async function giro(ora: string) {
  vi.setSystemTime(new Date(ora));
  const { GET } = await import("@/app/api/cron/veloce-non-confermata/route");
  const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request("http://x/api/cron/veloce-non-confermata"));
  return res.json();
}

const o = (id: string) => db.orders.find((r) => r.id === id)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db.orders = [];
  db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
  db.cod_checkout_attempts = [];
  db.notifications = [];
  prima.update = undefined;
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("il secondo freno della veloce", () => {
  it("alle 18:16 la spesa di Maria passa a «Stasera · 18:00–20:00» e alla porta paga 18 € invece di 19", async () => {
    db.orders = [ordine()];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({
      delivery_slot: "Stasera · 18:00–20:00", delivery_status: "NEW",
      delivery_fee_cents: 300, rider_fee_cents: 300, gross_total_cents: 1800, total_price: 18,
    });
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({ user_id: "maria", link: "/orders/o1" });
    expect(String(db.notifications[0].body)).toContain("Stasera · 18:00–20:00");
    expect(String(db.notifications[0].body)).toContain("non lo paghi");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toMatchObject({ to: "maria@esempio.it" });
  });

  it("prima dei 10 minuti non si tocca niente", async () => {
    db.orders = [ordine()];
    await giro("2026-10-30T17:12:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400, total_price: 19 });
    expect(db.notifications).toHaveLength(0);
  });

  it("un ordine già accettato dal negozio non si tocca", async () => {
    db.orders = [ordine({ delivery_status: "ACCEPTED" })];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400, total_price: 19 });
    expect(db.notifications).toHaveLength(0);
  });

  it("se il negozio accetta mentre il freno lavora, vince l accettazione e il cliente non riceve niente", async () => {
    db.orders = [ordine()];
    prima.update = () => { db.orders[0].delivery_status = "ACCEPTED"; };
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_status: "ACCEPTED", delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400, total_price: 19 });
    expect(db.notifications).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("con la spesa piccola la veloce era compresa: cambia solo la fascia, il totale resta", async () => {
    db.orders = [ordine({ total_price: 12, gross_total_cents: 1200 })];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: "Stasera · 18:00–20:00", delivery_fee_cents: 400, total_price: 12, gross_total_cents: 1200 });
    expect(db.notifications).toHaveLength(1);
  });

  it("carrello di due negozi: il forno non conferma, anche la frutta già accettata cambia fascia e l euro si toglie una volta", async () => {
    db.orders = [
      ordine(),
      ordine({ id: "o2", seller_id: "frutta", delivery_status: "ACCEPTED", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: "Stasera · 18:00–20:00", delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_slot: "Stasera · 18:00–20:00", delivery_status: "ACCEPTED", delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
    expect(db.notifications).toHaveLength(1);
  });

  it("alle 20:30 le fasce di oggi sono finite: la prima di domani, e la scadenza si conta su quella", async () => {
    db.orders = [ordine({ created_at: "2026-10-30T19:15:00.000Z" })];
    await giro("2026-10-30T19:30:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: "Domani · 9:00–12:00", delivery_fee_cents: 300, total_price: 18 });
    const scade = scadenzaAccettazione({ created_at: String(o("o1").created_at), delivery_slot: String(o("o1").delivery_slot) });
    expect(scade?.toISOString()).toBe("2026-10-31T11:00:00.000Z");
  });

  it("due giri di fila: un avviso solo, l euro tolto una volta sola", async () => {
    db.orders = [ordine()];
    await giro("2026-10-30T17:16:00.000Z");
    await giro("2026-10-30T17:21:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(db.notifications).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("il freno gira da solo, ogni cinque minuti", () => {
    const conf = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(conf.crons).toContainEqual({ path: "/api/cron/veloce-non-confermata", schedule: "*/5 * * * *" });
  });
});
