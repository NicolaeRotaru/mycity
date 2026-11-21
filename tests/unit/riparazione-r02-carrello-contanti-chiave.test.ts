import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";
import { annullaERimborsa } from "@/lib/ordini/annulla";
import { finto, carrello, type Riga } from "./carrello-finto";

/**
 * R02-002 — Il carrello in contanti si ritrova anche senza la riga del tentativo di cassa.
 *
 * Dalla migrazione 640 ogni ordine nato dallo stesso invio della cassa in contanti porta la stessa
 * chiave (`orders.carrello_contanti`). Se la riga di `cod_checkout_attempts` manca o non si legge, il
 * carrello è fatto dagli ordini dello stesso cliente con la stessa chiave: la regola del negozio che
 * rifiuta scatta (lib/ordini/annulla.ts) e il freno della veloce sposta tutto il carrello
 * (lib/ordini/veloce-non-confermata.ts). Prima della 640 la colonna non c'è: si fa come prima.
 * (Banchi di prova: tests/unit/carrello-finto.ts per l'annullo, e quello di
 * riparazione-r04-veloce-carrello-a-meta.test.ts per il freno.)
 */

const db: Record<string, Riga[]> = {};
/** Il database di prima della 640: chiedere la chiave del carrello fa fallire l istruzione intera. */
const prima640 = { attivo: false };
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

const COLONNA_MANCANTE = { code: "42703", message: "column orders.carrello_contanti does not exist" };

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let quante = Infinity;
  let perId: unknown = null;
  let chiedeLaChiave = false;
  const esegui = () => {
    if (valori && prima.update) { const f = prima.update; prima.update = undefined; f(); }
    const trovate = (db[nome] ?? []).filter((r) => filtri.every((f) => f(r))).slice(0, quante);
    if (valori) for (const r of trovate) Object.assign(r, valori);
    return trovate.map((r) => ({ ...r }));
  };
  const b: Record<string, unknown> = {
    select: (c?: string) => { if (nome === "orders" && String(c ?? "").includes("carrello_contanti")) chiedeLaChiave = true; return b; },
    update: (v: Riga) => { valori = v; return b; },
    insert: async (righe: Riga | Riga[]) => { (db[nome] ??= []).push(...(Array.isArray(righe) ? righe : [righe])); return { error: null }; },
    eq: (k: string, v: unknown) => { if (k === "carrello_contanti") chiedeLaChiave = true; if (k === "id") perId = v; filtri.push((r) => r[k] === v); return b; },
    in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
    lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return b; },
    contains: () => b,
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => (chiedeLaChiave && prima640.attivo ? { data: null, error: COLONNA_MANCANTE } : { data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (chiedeLaChiave && prima640.attivo) return Promise.resolve({ data: null, error: COLONNA_MANCANTE }).then(ok, ko);
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
vi.mock("@/lib/stripe/rimborsi-da-dividere", () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
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
  prima640.attivo = false;
  finto640.attivo = false;
  guasto.fascia = false;
  guasto.ordine = null;
  chiaviAvvisi.clear();
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
  refundOrderMock.mockClear();
});
afterEach(() => vi.useRealTimers());



// ── L'annullo: il database finto delle prove dell'annullo, con la colonna della 640 (o senza) ──────
const finto640 = { attivo: false };
let fdb: ReturnType<typeof finto>;
/** Come `finto`, ma prima della 640 un'istruzione che nomina la chiave fallisce intera (42703). */
function conLaChiave(base: ReturnType<typeof finto>, opz: { rigaIlleggibile?: boolean } = {}) {
  return {
    ...base,
    from: (t: string) => {
      const q = base.from(t) as Record<string, (...a: unknown[]) => unknown>;
      let rotta = t === "cod_checkout_attempts" && !!opz.rigaIlleggibile;
      const errore = () => (rotta && t === "cod_checkout_attempts"
        ? { message: "cod_checkout_attempts non risponde" }
        : COLONNA_MANCANTE);
      const p: Record<string, unknown> = new Proxy(q, {
        get(bersaglio, k: string) {
          if (k === "then") {
            return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
              rotta ? Promise.resolve({ data: null, error: errore() }).then(ok, ko) : (bersaglio.then as (a: unknown, b: unknown) => unknown)(ok, ko);
          }
          const f = bersaglio[k];
          if (typeof f !== "function") return f;
          return (...a: unknown[]) => {
            if (finto640.attivo && t === "orders" && ((k === "select" && String(a[0] ?? "").includes("carrello_contanti")) || (k === "eq" && a[0] === "carrello_contanti"))) rotta = true;
            f(...a);
            return p;
          };
        },
      });
      return p;
    },
  };
}
const rigaA = (id: string) => fdb.tabelle.orders.find((r) => r.id === id)!;
const annulla = (id: string) => annullaERimborsa(fdb as never, { ...rigaA(id) } as never, { reason: "Il negozio ha rifiutato l ordine" } as never);
const avvisiDaControllare = () => notifyAdminsMock.mock.calls.filter((c) => /carrello da controllare a mano/.test(String(c[0])));
/** Il carrello A: pane (15 €) e frutta (12 €) in contanti, nati alle 10:01, con la chiave della cassa. */
const carrelloA = (chiave: string | null = "k-a") =>
  carrello(["pane", "frutta"], [1500, 1200], "cod", { creati: ["2026-10-29T10:01:00Z", "2026-10-29T10:01:01Z"] })
    .map((r) => ({ ...r, carrello_contanti: chiave }));

describe("R02-002 · l annullo ritrova il carrello in contanti dalla chiave sugli ordini", () => {
  it("senza la riga del tentativo la regola del negozio che rifiuta scatta lo stesso", async () => {
    fdb = conLaChiave(finto({ orders: carrelloA(), cod_checkout_attempts: [] })) as never;
    expect(await annulla("pane")).toMatchObject({ ok: true });
    expect(rigaA("pane").delivery_status).toBe("CANCELED");
    // La consegna del carrello passa alla frutta: 3 € e 3 € al fattorino, alla porta 15 €.
    expect(rigaA("frutta")).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    expect(avvisiDaControllare(), "con la chiave non serve una persona").toEqual([]);
  });

  it("anche con la riga del tentativo che non si legge", async () => {
    fdb = conLaChiave(finto({ orders: carrelloA(), cod_checkout_attempts: [] }), { rigaIlleggibile: true }) as never;
    await annulla("pane");
    expect(rigaA("frutta")).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    expect(avvisiDaControllare()).toEqual([]);
  });

  it("un altro carrello dello stesso cliente e la stessa chiave di un altro cliente non si toccano", async () => {
    const b: Riga[] = carrello(["b1", "b2"], [1500, 1300], "cod", { creati: ["2026-10-29T10:00:00Z", "2026-10-29T10:00:01Z"] })
      .map((r) => ({ ...r, carrello_contanti: "k-b" }));
    const luca: Riga[] = carrello(["l1"], [1200], "cod", { creati: ["2026-10-29T10:01:02Z"] })
      .map((r) => ({ ...r, id: "l1", user_id: "u2", carrello_contanti: "k-a" }));
    fdb = conLaChiave(finto({ orders: [...b, ...carrelloA(), ...luca], cod_checkout_attempts: [] })) as never;
    const prima = { b1: { ...rigaA("b1") }, b2: { ...rigaA("b2") }, l1: { ...rigaA("l1") } };
    await annulla("pane");
    expect(rigaA("frutta")).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    for (const id of ["b1", "b2", "l1"] as const) {
      expect(rigaA(id)).toMatchObject({
        delivery_fee_cents: prima[id].delivery_fee_cents, rider_fee_cents: prima[id].rider_fee_cents, total_price: prima[id].total_price,
      });
    }
  });

  it("prima della 640 (la colonna non c è) fa come prima: niente spostato, nessun guasto, e gli amministratori lo sanno", async () => {
    finto640.attivo = true;
    fdb = conLaChiave(finto({ orders: carrelloA(null), cod_checkout_attempts: [] })) as never;
    expect(await annulla("pane")).toMatchObject({ ok: true });
    expect(rigaA("frutta")).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
    expect(avvisiDaControllare()).toHaveLength(1);
  });
});

// ── Il freno della veloce ─────────────────────────────────────────────────────────────────────────
const avvisi = () => notifyAdminsMock.mock.calls.map((c) => `${c[0]} — ${c[1]}`);
const campanella = () => db.notifications.filter((n) => n.user_id === "maria").map((n) => String(n.body));

function carrelloVeloce(o2: Riga = {}, chiave: string | null = "k-veloce") {
  db.profiles = [{ id: "forno", store_hours: null }, { id: "frutta", store_hours: null }];
  db.orders = [
    ordine({ carrello_contanti: chiave }),
    ordine({ id: "o2", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z", carrello_contanti: chiave, ...o2 }),
  ];
  // Nessuna riga del tentativo di cassa.
  db.cod_checkout_attempts = [];
}

describe("R02-002 · il freno della veloce ritrova il carrello in contanti dalla chiave sugli ordini", () => {
  it("senza la riga del tentativo sposta tutto il carrello, anche l ordine già confermato, e scrive al cliente una volta", async () => {
    carrelloVeloce({ delivery_status: "ACCEPTED" });
    await giro("2026-10-30T17:16:00.000Z");
    const fascia = String(o("o1").delivery_slot);
    expect(fascia).toMatch(/^Oggi · /);
    expect(o("o2").delivery_slot, "l ordine già confermato dello stesso carrello").toBe(fascia);
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain("alla porta paghi 31,00");
    expect(campanella()[0]).toContain("L’ordine che un negozio ha già confermato non si annulla più");
    expect(db.notifications.some((n) => n.user_id === "frutta" && String(n.title) === "Il carrello ha cambiato fascia")).toBe(true);
  });

  it("un altro ordine dello stesso cliente con un altra chiave non entra nel carrello", async () => {
    carrelloVeloce({ delivery_status: "ACCEPTED", carrello_contanti: "k-altro" });
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1").delivery_slot).toMatch(/^Oggi · /);
    expect(o("o2").delivery_slot).toBe(ETICHETTA_ADESSO);
  });

  it("prima della 640 (la colonna non c è) fa come prima, senza guasti", async () => {
    prima640.attivo = true;
    carrelloVeloce({ delivery_status: "ACCEPTED" }, null);
    const esito = await giro("2026-10-30T17:16:00.000Z");
    expect(esito.status).toBe(200);
    expect(o("o1").delivery_slot).toMatch(/^Oggi · /);
    expect(o("o2").delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(avvisi().some((a) => a.includes("fermo"))).toBe(false);
  });
});
