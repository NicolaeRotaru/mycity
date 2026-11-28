import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";

/**
 * 28/11/2026 (N-004, onda 3) — IL FRENO DELLA VELOCE NON METTE IL SESTO GIRO IN UNA FASCIA PIENA.
 *
 * In una fascia si accettano al massimo 5 giri (`ORDINI_PER_FASCIA`): la cassa e le rotte contano
 * prima di vendere (`rifiutoPerFasciaPiena`), il database ferma l'ultimo posto preso in due
 * (onda2_F1_1). Il freno della veloce sposta con un UPDATE l'ordine «Adesso» che il negozio non ha
 * confermato in 10 minuti nella prima fascia possibile, senza contare: in una fascia piena entrava
 * il sesto giro (il database guardava solo la nascita dell'ordine), e adesso che il database guarda
 * anche lo spostamento il freno si sarebbe fermato su un errore crudo.
 *
 *  ① la prima fascia è piena: il freno sceglie la prima con un giro libero, e il cliente la legge;
 *  ② coi contanti tutte le fasce di oggi e di domani sono piene: la spesa resta «Adesso» e il
 *    cliente legge perché, in italiano, invece di niente (o di un errore del database);
 *  ③ il conto diceva «c'è posto», ma l'ultimo posto l'ha preso un altro nello stesso istante e il
 *    database dice `fascia_piena`: non è un guasto, il giro dopo riprova (nessun errore crudo);
 *  ④ con la carta il tetto non ferma l'ordine, come alla sua nascita: con tutto pieno resta la prima;
 *  ⑤ la porta del cliente già nella fascia non è un giro nuovo: entra.
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const guasto: { fasciaPienaAllaScrittura: boolean } = { fasciaPienaAllaScrittura: false };
const sendEmailMock = vi.fn(async (_m: unknown) => ({ ok: true }));
const notifyAdminsMock = vi.fn(async (..._a: unknown[]) => "scritto");
const refundOrderMock = vi.fn(async (a: { amountCents: number }) => ({ refundId: "re_1", reversedCents: 0, pieno: false, importoCents: a.amountCents }));

/** Il rifiuto del grilletto onda2_F1_1, come lo passa PostgREST. */
const FASCIA_PIENA_DEL_DATABASE = {
  code: "23514",
  hint: "fascia_piena",
  message: "Questa fascia è piena: in quell’orario abbiamo già tutte le consegne che riusciamo a fare. Scegline un’altra.",
};

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let valori: Riga | null = null;
  let quante = Infinity;
  let conta = false;
  const esegui = () => {
    const trovate = (db[nome] ?? []).filter((r) => filtri.every((f) => f(r))).slice(0, quante);
    if (valori) for (const r of trovate) Object.assign(r, valori);
    return trovate.map((r) => ({ ...r }));
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, op?: { count?: string }) => { if (op?.count) conta = true; return b; },
    update: (v: Riga) => { valori = v; return b; },
    insert: async (righe: Riga | Riga[]) => { (db[nome] ??= []).push(...(Array.isArray(righe) ? righe : [righe])); return { error: null }; },
    eq: (k: string, v: unknown) => { filtri.push((r) => r[k] === v); return b; },
    neq: (k: string, v: unknown) => { filtri.push((r) => r[k] !== v); return b; },
    in: (k: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[k])); return b; },
    lt: (k: string, v: string) => { filtri.push((r) => String(r[k]) < v); return b; },
    gte: (k: string, v: string) => { filtri.push((r) => Date.parse(String(r[k])) >= Date.parse(v)); return b; },
    contains: (k: string, v: string) => {
      const ids = (JSON.parse(v) as Array<{ id: string }>).map((x) => x.id);
      filtri.push((r) => ids.every((id) => ((r[k] as Array<{ id: string }>) ?? []).some((x) => x.id === id)));
      return b;
    },
    limit: (n: number) => { quante = n; return b; },
    order: () => b,
    maybeSingle: async () => ({ data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (nome === "orders" && valori && "delivery_slot" in valori && guasto.fasciaPienaAllaScrittura) {
        return Promise.resolve({ data: null, error: FASCIA_PIENA_DEL_DATABASE }).then(ok, ko);
      }
      const data = esegui();
      return Promise.resolve({ data, error: null, ...(conta ? { count: data.length } : {}) }).then(ok, ko);
    },
  };
  return b;
}

const admin = {
  from: (t: string) => tabella(t),
  rpc: async () => ({ data: null, error: null }),
  auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@esempio.it` } }, error: null }) } },
};

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock("@/lib/email/client", () => ({ sendEmail: (m: unknown) => sendEmailMock(m) }));
vi.mock("@/lib/stripe/payout", () => ({ refundOrder: (a: { amountCents: number }) => refundOrderMock(a) }));
vi.mock("@/lib/stripe/webhook/comune", async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: (...a: unknown[]) => notifyAdminsMock(...a),
}));

/** 18:05 a Piacenza (il 30/10 l'ora legale è già finita: UTC+1). Il giro è alle 18:16. */
const NATO = "2026-10-30T17:05:00.000Z";
const GIRO = new Date("2026-10-30T17:16:00.000Z");
/** Gli altri ordini sono nati stamattina: «Oggi» e «Domani» si contano dallo stesso giorno. */
const STAMATTINA = "2026-10-30T08:00:00.000Z";

const FASCE_DI_STASERA = ["Oggi · 18:00–19:30", "Oggi · 19:30–21:00"];
const FASCE_DI_DOMANI = [
  "Domani · 7:30–9:00", "Domani · 9:00–11:00", "Domani · 11:00–13:00", "Domani · 13:00–16:30",
  "Domani · 16:30–18:00", "Domani · 18:00–19:30", "Domani · 19:30–21:00",
];

function veloce(p: Riga = {}): Riga {
  return {
    id: "o1", user_id: "maria", seller_id: "forno", delivery_status: "NEW", delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: "cod", payment_status: "PENDING", total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: null, created_at: NATO, refunded_amount_cents: 0, stripe_refund_id: null,
    delivery_address: "Via Verdi 1", delivery_zip: "29121", ...p,
  };
}

/** Cinque porte di altri clienti nella fascia: la fascia è piena. */
function riempi(fascia: string, quante = 5): Riga[] {
  return Array.from({ length: quante }, (_, i) => ({
    id: `${fascia}-${i}`, user_id: `cliente-${i}`, seller_id: "forno", delivery_status: "ACCEPTED", delivery_slot: fascia,
    pickup_in_store: false, payment_method: "cod", created_at: STAMATTINA,
    delivery_address: `Via Lontana ${i}`, delivery_zip: "29121",
  }));
}

const o = (id: string) => db.orders.find((r) => r.id === id)!;
const porteNella = (fascia: string) =>
  new Set(db.orders.filter((r) => r.delivery_slot === fascia && r.delivery_status !== "CANCELED").map((r) => `${r.user_id}|${String(r.delivery_address).trim().toLowerCase()}`)).size;
const alCliente = () => db.notifications.filter((n) => n.user_id === "maria");

async function giro() {
  const { frenoDellaVeloce } = await import("@/lib/ordini/veloce-non-confermata");
  return frenoDellaVeloce(admin as never, GIRO);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(GIRO);
  db.orders = [];
  db.profiles = [{ id: "forno", store_hours: null }];
  db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }] }];
  db.notifications = [];
  guasto.fasciaPienaAllaScrittura = false;
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
  refundOrderMock.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("N-004 · il freno della veloce conta i giri della fascia prima di spostare", () => {
  it("① la 18:00–19:30 è piena: Maria passa alla 19:30–21:00, e il sesto giro non entra", async () => {
    db.orders = [veloce(), ...riempi("Oggi · 18:00–19:30")];

    const esito = await giro();

    expect(esito).toMatchObject({ ok: true, spostati: 1, guasti: 0 });
    expect(o("o1").delivery_slot, "il freno mette il sesto giro nella fascia piena").toBe("Oggi · 19:30–21:00");
    expect(porteNella("Oggi · 18:00–19:30")).toBe(5);
    // Il resto del freno lavora come sempre: l'euro della veloce non si paga.
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
    expect(alCliente()).toHaveLength(1);
    expect(String(alCliente()[0].body)).toContain("Oggi · 19:30–21:00");
  });

  it("② contanti, tutte le fasce di oggi e di domani piene: resta «Adesso» e il cliente legge perché", async () => {
    db.orders = [veloce(), ...[...FASCE_DI_STASERA, ...FASCE_DI_DOMANI].flatMap((f) => riempi(f))];

    const esito = await giro();

    expect(esito).toMatchObject({ ok: true, spostati: 0, guasti: 0, daSistemareAMano: 1 });
    expect(o("o1").delivery_slot, "il freno mette il sesto giro in una fascia piena").toBe(ETICHETTA_ADESSO);
    expect(o("o1")).toMatchObject({ delivery_fee_cents: 400, total_price: 19 });
    for (const f of [...FASCE_DI_STASERA, ...FASCE_DI_DOMANI]) expect(porteNella(f), f).toBe(5);
    expect(alCliente()).toHaveLength(1);
    const frase = String(alCliente()[0].body);
    expect(frase).toContain("le fasce di consegna di oggi e di domani sono tutte piene");
    expect(frase).toContain("non paghi niente");
    expect(frase).not.toMatch(/23514|fascia_piena|violates|ERROR/i);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const testo = JSON.stringify(sendEmailMock.mock.calls[0][0]);
    expect(testo).toContain("tutte piene");
    // Gli amministratori sanno perché la veloce non si è spostata.
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(String(notifyAdminsMock.mock.calls[0][1])).toContain("sono piene");
  });

  it("③ l'ultimo posto preso da un altro nello stesso istante: si riprova al giro dopo, senza errori crudi", async () => {
    db.orders = [veloce()];
    guasto.fasciaPienaAllaScrittura = true;

    const esito = await giro();

    expect(esito, "il rifiuto del database è trattato come un guasto").toMatchObject({ ok: true, guasti: 0, daRiprovare: 1 });
    expect(o("o1").delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(alCliente()).toHaveLength(0);
    for (const chiamata of notifyAdminsMock.mock.calls) {
      expect(String(chiamata[1])).not.toContain("Questa fascia è piena");
    }
    expect(notifyAdminsMock).not.toHaveBeenCalled();

    // Al giro dopo l'altro c'è davvero, la fascia è piena: il conto la salta.
    guasto.fasciaPienaAllaScrittura = false;
    db.orders.push(...riempi("Oggi · 18:00–19:30"));
    const dopo = await giro();
    expect(dopo).toMatchObject({ ok: true, spostati: 1 });
    expect(o("o1").delivery_slot).toBe("Oggi · 19:30–21:00");
  });

  it("④ con la carta il tetto non ferma l'ordine, come alla nascita: con tutto pieno resta la prima fascia", async () => {
    db.orders = [
      veloce({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" }),
      ...[...FASCE_DI_STASERA, ...FASCE_DI_DOMANI].flatMap((f) => riempi(f)),
    ];

    const esito = await giro();

    expect(esito).toMatchObject({ ok: true, guasti: 0 });
    expect(o("o1").delivery_slot).toBe("Oggi · 18:00–19:30");
  });

  it("⑤ la porta di Maria è già nella fascia (un altro suo ordine allo stesso indirizzo): entra", async () => {
    db.orders = [
      veloce(),
      ...riempi("Oggi · 18:00–19:30", 4),
      { id: "suo", user_id: "maria", seller_id: "frutta", delivery_status: "ACCEPTED", delivery_slot: "Oggi · 18:00–19:30",
        pickup_in_store: false, payment_method: "cod", created_at: STAMATTINA, delivery_address: " via verdi 1", delivery_zip: "29121" },
    ];

    await giro();

    expect(o("o1").delivery_slot).toBe("Oggi · 18:00–19:30");
    expect(porteNella("Oggi · 18:00–19:30")).toBe(5);
  });
});
