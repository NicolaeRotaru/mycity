import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * 30/10/2026 — IL SECONDO GIRO DEL FRENO NON PRENOTA DI NUOVO L EURO GIÀ RESO.
 *
 * Con la carta il freno della veloce rende 1 € con `refundOrder` PRIMA di scrivere la fascia (⑥ in
 * lib/ordini/veloce-non-confermata.ts). Se dopo il rimborso il giro muore, o la scrittura della fascia
 * cade, l ordine resta «Adesso» e il giro dopo lo ritrova. Prima richiamava `refundOrder` con la stessa
 * chiave: Stripe rendeva l euro una volta sola (chiave uguale, rimborso uguale), ma `accumula_rimborso`
 * non ha chiave e prenotava di nuovo: `refunded_amount_cents` diceva 2 €, ne era uscito 1. All annullo
 * il tetto del rimborso era 1 € più basso del vero, e il cliente perdeva quell euro.
 *
 * La prova usa il `refundOrder` VERO (la prova del freno lo simula, e il doppio conto non si vedeva),
 * un database finto che applica i filtri delle scritture, e Stripe finto con la sua idempotenza.
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const guasto: { fascia?: "errore" | "appesa" } = {};
const diario: Array<{ user: string; cents: number; reason: string; ref: string }> = [];
const rimborsiStripe = new Map<string, { id: string; amount: number }>();
const creaRimborso = vi.fn(async (p: { amount: number }, o: { idempotencyKey: string }) => {
  // Stripe: con la stessa chiave risponde lo stesso rimborso, e i soldi escono una volta sola.
  const gia = rimborsiStripe.get(o.idempotencyKey);
  if (gia) return gia;
  const r = { id: `re_${rimborsiStripe.size + 1}`, amount: p.amount, status: "succeeded" };
  rimborsiStripe.set(o.idempotencyKey, r);
  return r;
});

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let quante = Infinity;
  const esegui = () => {
    const trovate = (db[nome] ?? []).filter((r) => filtri.every((f) => f(r))).slice(0, quante);
    if (valori) for (const r of trovate) Object.assign(r, valori);
    return trovate.map((r) => ({ ...r }));
  };
  const risposta = () => {
    if (nome === "orders" && valori && "delivery_slot" in valori && guasto.fascia) {
      const g = guasto.fascia;
      guasto.fascia = undefined;
      if (g === "appesa") return new Promise(() => {});
      return Promise.resolve({ data: null, error: { message: "timeout del database" } });
    }
    return Promise.resolve({ data: esegui(), error: null });
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Riga) => { valori = v; return b; },
    insert: async (righe: Riga | Riga[]) => { (db[nome] ??= []).push(...(Array.isArray(righe) ? righe : [righe])); return { error: null }; },
    eq: (k: string, v: unknown) => { filtri.push((r) => r[k] === v); return b; },
    is: (k: string, v: unknown) => { filtri.push((r) => (r[k] ?? null) === v); return b; },
    in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
    lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return b; },
    contains: () => b,
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => ({ data: esegui()[0] ?? null, error: null }),
    single: async () => {
      const r = esegui()[0];
      return r ? { data: r, error: null } : { data: null, error: { code: "PGRST116", message: "nessuna riga" } };
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => risposta().then(ok, ko),
  };
  return b;
}

const admin = {
  from: (t: string) => tabella(t),
  rpc: async (nome: string, a: Record<string, unknown>) => {
    if (nome === "wallet_credit") {
      // Il diario del credito: (reason, ref) è unico (migrazioni 098 e 143).
      if (diario.some((d) => d.reason === a.p_reason && d.ref === a.p_ref)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      diario.push({ user: String(a.p_user), cents: Number(a.p_cents), reason: String(a.p_reason), ref: String(a.p_ref) });
      return { data: 0, error: null };
    }
    if (nome !== "accumula_rimborso") return { data: null, error: null };
    // Come la funzione vera: somma in una riga sola, col tetto del lordo. Nessuna chiave.
    const r = db.orders.find((x) => x.id === a.p_order_id)!;
    const nuovo = Number(r.refunded_amount_cents ?? 0) + Number(a.p_delta);
    if (nuovo > Number(r.gross_total_cents)) return { data: [], error: null };
    r.refunded_amount_cents = nuovo;
    return { data: [{ totale_rimborsato: nuovo, totale_ordine: r.gross_total_cents }], error: null };
  },
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@esempio.it` } }, error: null }) } },
};

vi.mock("@/lib/api/middleware", () => ({ withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock("@/lib/email/client", () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({ refunds: { create: creaRimborso }, transfers: { createReversal: vi.fn(async () => ({ id: "trr_1" })) } }),
}));
vi.mock("@/lib/stripe/webhook/comune", async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: vi.fn(async () => "mandato"),
}));
vi.mock("@/lib/supabase/server", () => ({ getAdminSupabase: () => admin }));

function ordine(): Riga {
  return {
    id: "o1", user_id: "maria", seller_id: "forno", delivery_status: "NEW", delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: "card", payment_status: "PAID", total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: "cs_1", stripe_payment_intent: "pi_1", stripe_refund_id: null, refunded_amount_cents: 0,
    seller_payout_cents: 1350, seller_payout_reversed_cents: 0, payout_status: "PENDING", rider_id: null,
    created_at: "2026-10-30T17:05:00.000Z",
  };
}

async function giro(ora: string) {
  vi.setSystemTime(new Date(ora));
  const { GET } = await import("@/app/api/cron/veloce-non-confermata/route");
  const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request("http://x/api/cron/veloce-non-confermata"));
  return res.json();
}

const o1 = () => db.orders.find((r) => r.id === "o1")!;
const campanella = () => String(db.notifications.find((n) => n.user_id === "maria")?.body);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db.orders = [ordine()];
  db.profiles = [{ id: "forno", store_hours: null }];
  db.notifications = [];
  db.cod_checkout_attempts = [];
  guasto.fascia = undefined;
  rimborsiStripe.clear();
  diario.length = 0;
  creaRimborso.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("il freno non prenota due volte l euro della veloce", () => {
  it("la fascia non si scrive al primo giro: il secondo giro sposta il carrello e il libro dice 1 €, non 2", async () => {
    guasto.fascia = "errore";
    await giro("2026-10-30T17:16:00.000Z");
    expect(o1()).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, refunded_amount_cents: 100 });
    await giro("2026-10-30T17:21:00.000Z");
    expect(o1().delivery_slot).toBe("Oggi · 18:00–19:30");
    expect(rimborsiStripe.size).toBe(1);
    expect(o1().refunded_amount_cents).toBe(100);
    expect(campanella()).toContain("ti torna sulla carta");
  });

  it("il primo giro muore dopo il rimborso: il secondo giro non lo prenota di nuovo", async () => {
    guasto.fascia = "appesa";
    void giro("2026-10-30T17:16:00.000Z");
    await vi.waitFor(() => expect(o1().stripe_refund_id).toBe("re_1"));
    await giro("2026-10-30T17:21:00.000Z");
    expect(o1().delivery_slot).toBe("Oggi · 18:00–19:30");
    expect(rimborsiStripe.size).toBe(1);
    expect(o1().refunded_amount_cents).toBe(100);
    expect(campanella()).toContain("ti torna sulla carta");
  });

  it("un rimborso di prima che non è l euro della veloce: niente prenotazione nuova, il cliente legge «a mano»", async () => {
    Object.assign(o1(), { refunded_amount_cents: 250, stripe_refund_id: "re_vecchio", payment_status: "PARTIALLY_REFUNDED" });
    await giro("2026-10-30T17:16:00.000Z");
    expect(creaRimborso).not.toHaveBeenCalled();
    expect(o1().refunded_amount_cents).toBe(250);
    expect(campanella()).toContain("a mano");
    expect(campanella()).not.toContain("ti torna sulla carta");
  });
});

describe("contanti pagati col credito MyCity: l euro della veloce torna sul credito, una volta sola", () => {
  it("spesa da 19 € tutta col credito: dopo il freno 1 € torna sul credito, alla porta non paga niente, e il conto torna", async () => {
    db.orders = [{ ...ordine(), payment_method: "cod", payment_status: "PENDING", stripe_session_id: null, stripe_payment_intent: null, total_price: 0, wallet_applied_cents: 1900 }];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }] }];
    // Il primo giro accredita e poi non scrive la fascia: il secondo la scrive, e non accredita di nuovo.
    guasto.fascia = "errore";
    await giro("2026-10-30T17:16:00.000Z");
    await giro("2026-10-30T17:21:00.000Z");
    const r = o1();
    expect(r).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", gross_total_cents: 1800, wallet_applied_cents: 1800, total_price: 0, delivery_fee_cents: 300 });
    expect(diario).toEqual([{ user: "maria", cents: 100, reason: "cod_refund", ref: "veloce_non_confermata_o1" }]);
    expect(campanella()).toMatch(/1,00\s€ ti torna sul credito MyCity e alla porta non paghi niente/);
    expect(campanella()).not.toContain("-1,00");
  });

  it("50 centesimi in contanti e il resto col credito: 50 centesimi tolti alla porta, 50 tornano sul credito", async () => {
    db.orders = [{ ...ordine(), payment_method: "cod", payment_status: "PENDING", stripe_session_id: null, stripe_payment_intent: null, total_price: 0.5, wallet_applied_cents: 1850 }];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }] }];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o1()).toMatchObject({ gross_total_cents: 1800, wallet_applied_cents: 1800, total_price: 0 });
    expect(diario).toHaveLength(1);
    expect(diario[0].cents).toBe(50);
  });
});
