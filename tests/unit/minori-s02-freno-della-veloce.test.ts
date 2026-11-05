import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * Sessione S02 (5/11/2026) — il freno della veloce: schede 2329, 2373, 2354, 2366, 2367, 2369, 2371,
 * 2365, 2374. Banco copiato da la-veloce-non-confermata-in-10-minuti-passa-a-una-fascia, con tre
 * leve in più: guasti di lettura per tabella, campanella che cade, scritture che non toccano righe.
 *
 * Originale: IL SECONDO FRENO DELLA VELOCE (carta #220 del 29/10; variante B scelta da Nicola il 30/10 fra le
 * 14:49 e le 14:54 — le 16:13 sono del 29/10, il prezzo della veloce).
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
const leve = { letturaGiu: new Set<string>(), campanellaGiu: false, scritturaVuota: false };
/** Il database prima della migrazione 124: la colonna `gross_total_cents` non esiste ancora. */
const senza124 = { attivo: false };
const ERRORE_LETTURA_124 = { code: "42703", message: "column orders.gross_total_cents does not exist" };
const ERRORE_SCRITTURA_124 = { code: "PGRST204", message: "Could not find the gross_total_cents column of orders in the schema cache" };
const sendEmailMock = vi.fn(async (_m: unknown) => ({ ok: true }));
const notifyAdminsMock = vi.fn(async (..._a: unknown[]) => undefined);
const refundOrderMock = vi.fn(async (_a: unknown): Promise<unknown> => ({ refundId: "re_1", reversedCents: 0, pieno: false, importoCents: 100 }));

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let quante = Infinity;
  let colonne = "";
  const errore124 = () => {
    if (!senza124.attivo) return null;
    if (valori && "gross_total_cents" in valori) return ERRORE_SCRITTURA_124;
    return /\bgross_total_cents\b/.test(colonne) ? ERRORE_LETTURA_124 : null;
  };
  const esegui = () => {
    if (valori && prima.update) { const f = prima.update; prima.update = undefined; f(); }
    const trovate = (db[nome] ?? []).filter((r) => filtri.every((f) => f(r))).slice(0, quante);
    if (valori) for (const r of trovate) Object.assign(r, valori);
    return trovate.map((r) => ({ ...r }));
  };
  const b: Record<string, unknown> = {
    select: (c?: string) => { if (!valori) colonne = String(c ?? ""); return b; },
    update: (v: Riga) => { valori = v; return b; },
    insert: async (righe: Riga | Riga[]) => {
      if (nome === "notifications" && leve.campanellaGiu) return { error: { message: "campanella giù" } };
      (db[nome] ??= []).push(...(Array.isArray(righe) ? righe : [righe]));
      return { error: null };
    },
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
    maybeSingle: async () => (errore124() ? { data: null, error: errore124() } : { data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (!valori && leve.letturaGiu.has(nome)) return Promise.resolve({ data: null, error: { message: "timeout" } }).then(ok, ko);
      if (valori && nome === "orders" && leve.scritturaVuota) return Promise.resolve({ data: [], error: null }).then(ok, ko);
      return Promise.resolve(errore124() ? { data: null, error: errore124() } : { data: esegui(), error: null }).then(ok, ko);
    },
  };
  return b;
}

vi.mock("@/lib/api/middleware", () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock("@/lib/stripe/payout", () => ({ refundOrder: (a: unknown) => refundOrderMock(a) }));
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
  leve.letturaGiu.clear();
  leve.campanellaGiu = false;
  leve.scritturaVuota = false;
  senza124.attivo = false;
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
  refundOrderMock.mockClear();
});
afterEach(() => vi.useRealTimers());


const titoli = () => notifyAdminsMock.mock.calls.map((c) => String(c[0]));
const corpi = () => notifyAdminsMock.mock.calls.map((c) => String(c[1]));

describe("il freno della veloce dice il vero a negozio, cliente e amministratori", () => {
  it("2329 · anche il negozio che non ha confermato riceve l avviso del cambio di fascia", async () => {
    db.orders = [ordine()];
    await giro("2026-10-30T17:16:00.000Z");
    const alForno = db.notifications.filter((n) => n.user_id === "forno");
    expect(alForno).toHaveLength(1);
    expect(String(alForno[0].body)).toContain("Oggi · 18:00–19:30");
  });

  it("2373 · se né campanella né email arrivano al cliente, gli amministratori lo sanno e il giro non è pulito", async () => {
    db.orders = [ordine()];
    leve.campanellaGiu = true;
    sendEmailMock.mockImplementationOnce(async () => ({ ok: false }));
    const esito = await giro("2026-10-30T17:16:00.000Z");
    expect(titoli()).toContain("⚠️ Veloce spostata ma il cliente non è stato avvisato");
    expect(esito).toMatchObject({ ok: true, spostati: 0, daSistemareAMano: 1 });
  });

  it("2354 · se la lettura del carrello cade non si sposta un ordine solo: si riprova, e niente «tutta la spesa in fascia»", async () => {
    db.orders = [ordine()];
    leve.letturaGiu.add("cod_checkout_attempts");
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1").delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(db.notifications.filter((n) => n.user_id === "maria")).toHaveLength(0);
    expect(titoli()).toContain("⚠️ Freno della veloce fermo prima di cominciare");
  });

  it("2366 · un guasto passeggero su due ordini manda UN avviso, non uno per ordine", async () => {
    db.orders = [ordine(), ordine({ id: "o2", user_id: "luca", created_at: "2026-10-30T17:05:30.000Z" })];
    leve.letturaGiu.add("cod_checkout_attempts");
    await giro("2026-10-30T17:16:00.000Z");
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(corpi()[0]).toContain("#O1");
    expect(corpi()[0]).toContain("#O2");
  });

  it("2369 · annullato in gara senza euro reso: si conta come annullato, non come «accettato nel frattempo»", async () => {
    db.orders = [ordine()];
    prima.update = () => { o("o1").delivery_status = "CANCELED"; };
    const esito = await giro("2026-10-30T17:16:00.000Z");
    expect(esito).toMatchObject({ accettatiNelFrattempo: 0, annullatiNelFrattempo: 1 });
  });

  it("2371 · zero righe scritte con l ordine ancora nuovo e «Adesso»: avviso (una volta) e conteggio a parte", async () => {
    db.orders = [ordine()];
    leve.scritturaVuota = true;
    const esito = await giro("2026-10-30T17:16:00.000Z");
    expect(esito).toMatchObject({ accettatiNelFrattempo: 0, daRiprovare: 1 });
    expect(titoli()).toContain("⚠️ Veloce: la fascia non si scrive");
    await giro("2026-10-30T17:21:00.000Z");
    expect(notifyAdminsMock.mock.calls.filter((c) => c[0] === "⚠️ Veloce: la fascia non si scrive")).toHaveLength(2);
    expect(notifyAdminsMock.mock.calls.every((c) => (c[3] as { unaVoltaPer?: string } | undefined)?.unaVoltaPer === "veloce-non-scritta-o1")).toBe(true);
  });

  it("2374 · il freno conta solo CANCELED: lo stato REJECTED nel database non esiste", () => {
    const src = readFileSync("lib/ordini/veloce-non-confermata.ts", "utf8");
    expect(src).toContain("const FUORI_DAL_GIRO = ['CANCELED'];");
    expect(src).not.toMatch(/'REJECTED'/);
    expect(readFileSync("migrations/011_orders_delivery.sql", "utf8")).not.toMatch(/'REJECTED'/);
  });

  it("2365 · un rimborso di un altra causa non si legge come «già reso sulla carta» dal freno", () => {
    const src = readFileSync("lib/ordini/veloce-non-confermata.ts", "utf8");
    expect(src).toContain("c’era già un rimborso di ${formatPriceFromCents(giaResi)} che non è l’euro della veloce");
  });

  it("2367 · se il guasto arriva dopo aver spostato un ordine, l avviso dice che cliente e negozi non sono stati avvisati", () => {
    const src = readFileSync("lib/ordini/veloce-non-confermata.ts", "utf8");
    expect(src).toContain("Cliente, negozi e fattorino NON sono stati avvisati del cambio di fascia");
  });
});

describe("2372 · dopo mezzanotte «Domani» si conta dal giorno di nascita dell ordine", () => {
  it("l etichetta scelta col giorno del giro si riporta al giorno di nascita", async () => {
    const { fasciaDalGiornoDellOrdine } = await import("@/lib/ordini/veloce-non-confermata");
    const nato = "2026-10-31T19:45:00.000Z"; // sabato 20:45 a Piacenza
    const giro = new Date("2026-10-31T23:05:00.000Z"); // domenica 00:05 a Piacenza
    expect(fasciaDalGiornoDellOrdine("Oggi · 7:30–9:00", giro, nato)).toBe("Domani · 7:30–9:00");
    expect(fasciaDalGiornoDellOrdine("Domani · 9:00–12:00", giro, nato)).toBeNull();
    const stessoGiorno = new Date("2026-10-31T20:00:00.000Z");
    expect(fasciaDalGiornoDellOrdine("Domani · 9:00–12:00", stessoGiorno, nato)).toBe("Domani · 9:00–12:00");
    expect(fasciaDalGiornoDellOrdine(ETICHETTA_ADESSO, giro, nato)).toBe(ETICHETTA_ADESSO);
  });
});

describe("2332 · 2333 · le prove dei soldi che mancavano", () => {
  it("2332 · se il credito MyCity non torna, l euro della veloce resta nel conto e il cliente non legge «non lo paghi»", async () => {
    // Quasi tutto pagato col credito: dei 19 € alla porta ne restano 0,50, l'euro va reso sul credito.
    // Il banco non ha `rpc`: il wallet_credit cade, quindi il credito NON torna.
    db.orders = [ordine({ total_price: 0.5, wallet_applied_cents: 1850 })];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_fee_cents: 400, wallet_applied_cents: 1850 });
    const alCliente = db.notifications.find((n) => n.user_id === "maria");
    expect(String(alCliente?.body)).not.toContain("non lo paghi");
    expect(titoli()).toContain("⚠️ Veloce non confermata da sistemare");
  });

  it("2333 · un rimborso prenotato che non è mai arrivato a Stripe (niente stripe_refund_id) non vale «ti torna sulla carta»", async () => {
    db.orders = [ordine({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1", refunded_amount_cents: 100, stripe_refund_id: null })];
    await giro("2026-10-30T17:16:00.000Z");
    expect(refundOrderMock).not.toHaveBeenCalled();
    const alCliente = db.notifications.find((n) => n.user_id === "maria");
    expect(String(alCliente?.body)).not.toContain("ti torna sulla carta");
    expect(String(alCliente?.body)).toContain("a mano");
  });

  it("2333 · con lo stripe_refund_id dello stesso euro, invece, è già reso", async () => {
    db.orders = [ordine({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1", refunded_amount_cents: 100, stripe_refund_id: "re_1" })];
    await giro("2026-10-30T17:16:00.000Z");
    expect(refundOrderMock).not.toHaveBeenCalled();
    expect(String(db.notifications.find((n) => n.user_id === "maria")?.body)).toContain("ti torna sulla carta");
  });
});

describe("2372 · il giro vero dopo mezzanotte scrive la fascia col giorno di nascita", () => {
  it("ordine di sabato 20:45, giro di domenica 00:05: la fascia scritta è «Domani · …», non «Oggi · …»", async () => {
    db.orders = [ordine({ created_at: "2026-10-31T19:45:00.000Z" })];
    await giro("2026-10-31T23:05:00.000Z");
    expect(String(o("o1").delivery_slot)).toMatch(/^Domani · /);
  });
});
