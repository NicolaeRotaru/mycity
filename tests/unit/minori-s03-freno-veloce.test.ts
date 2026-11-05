import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * IL FRENO DELLA VELOCE DICE IL VERO, E CHI DEVE SAPERLO LO SA (ondata 20, controllo dei 13 file).
 *
 * ① La frase al cliente prometteva «puoi annullare l ordine dalla sua pagina senza costi», senza
 *   limite. Ma la rotta di annullo accetta solo un ordine NEW: alle 12:58 il forno accetta la fascia
 *   nuova, alle 13:10 Maria non ha più il tasto. La frase adesso dice il limite vero.
 * ② Se la fascia non si scrive (tre giri di fila) il freno rispondeva 200 «ok» e non avvisava nessuno,
 *   con l euro già tornato sulla carta. Adesso gli amministratori lo sanno, una volta, e la rotta no 200.
 * ③ «Zero righe scritte» non vuol dire «il negozio ha confermato»: se Maria annulla mentre il freno
 *   rende l euro, l avviso dice lo stato vero, riletto.
 * ④ Il lavoro nuovo ogni 5 minuti sta anche nell elenco del manuale (docs/crons.json).
 * ⑤ La riga «entro quando accettare» del negozio si ricalcola a ogni lettura periodica.
 * ⑥ La riga della veloce al negozio non promette una fascia che il freno può non trovare.
 *
 * La prova chiama le rotte vere su un database finto che applica i filtri delle scritture.
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
const conCarta = { payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" };

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


/*
 * S03 — scheda 2364. Impianto copiato da il-freno-della-veloce-dice-il-vero-a-chi-deve-saperlo.test.ts.
 * Sabato sera, negozio chiuso la domenica: la veloce non si può spostare. Il primo giro lo dice agli
 * amministratori (e risponde 500: è un problema nuovo); i giri dopo non rispondono 500 ogni cinque
 * minuti fino all'annullo per una cosa già detta.
 */
describe("il freno della veloce non grida a ogni giro", () => {
  it("2364 — carrello già segnalato: dal secondo giro il lavoro risponde 200", async () => {
    db.profiles = [{ id: "forno", store_hours: chiusoDomenica }];
    db.orders = [ordine({ created_at: "2026-10-31T19:20:00.000Z" })];
    const primo = await giro("2026-10-31T19:31:00.000Z");
    expect(primo.status).toBe(500);
    expect(avvisi().length).toBe(1);
    const secondo = await giro("2026-10-31T19:36:00.000Z");
    expect(secondo.status).toBe(200);
    expect(secondo.corpo).toMatchObject({ daSistemareAMano: 0, giaSegnalati: 1 });
  });
});
