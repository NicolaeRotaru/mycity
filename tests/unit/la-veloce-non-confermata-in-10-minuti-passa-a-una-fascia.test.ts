import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";
import { rigaScadenzaPerIlNegozio, scadenzaAccettazione } from "@/lib/ordini/scadenza-accettazione";

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
    maybeSingle: async () => (errore124() ? { data: null, error: errore124() } : { data: esegui()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(errore124() ? { data: null, error: errore124() } : { data: esegui(), error: null }).then(ok, ko),
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
  senza124.attivo = false;
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
  refundOrderMock.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("il secondo freno della veloce", () => {
  it("alle 18:16 la spesa di Maria passa a «Oggi · 18:00–19:30» e alla porta paga 18 € invece di 19", async () => {
    db.orders = [ordine()];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({
      delivery_slot: "Oggi · 18:00–19:30", delivery_status: "NEW",
      delivery_fee_cents: 300, rider_fee_cents: 300, gross_total_cents: 1800, total_price: 18,
    });
    expect(db.notifications).toHaveLength(1);
    expect(db.notifications[0]).toMatchObject({ user_id: "maria", link: "/orders/o1" });
    expect(String(db.notifications[0].body)).toContain("Oggi · 18:00–19:30");
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
    expect(o("o1")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_fee_cents: 400, total_price: 12, gross_total_cents: 1200 });
    expect(db.notifications).toHaveLength(1);
  });

  it("carrello di due negozi: il forno non conferma, anche la frutta già accettata cambia fascia e l euro si toglie una volta", async () => {
    db.orders = [
      ordine(),
      ordine({ id: "o2", seller_id: "frutta", delivery_status: "ACCEPTED", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 18 });
    expect(o("o2")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_status: "ACCEPTED", delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
    expect(db.notifications.filter((n) => n.user_id === "maria")).toHaveLength(1);
  });

  it("alle 20:30 le fasce di oggi sono finite: la prima di domani, e la scadenza si conta su quella", async () => {
    db.orders = [ordine({ created_at: "2026-10-30T19:15:00.000Z" })];
    await giro("2026-10-30T19:30:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: "Domani · 7:30–9:00", delivery_fee_cents: 300, total_price: 18 });
    const scade = scadenzaAccettazione({ created_at: String(o("o1").created_at), delivery_slot: String(o("o1").delivery_slot) });
    expect(scade?.toISOString()).toBe("2026-10-31T08:00:00.000Z");
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

/**
 * Tre difetti trovati dal collaudo sul primo giro del freno (30/10/2026). Ognuno era rosso sul codice
 * di prima: la fascia scelta guardava solo «non ancora finita», l euro si dava per tolto anche quando
 * stava su un ordine già partito, e senza fasce servibili si ripiegava su «Domani · 9:00–12:00».
 */
describe("il secondo freno della veloce: i tre difetti del collaudo", () => {
  it("V-fascia: veloce 17:38 non confermata, alle 17:50 non va a 15:00–18:00 (10 minuti) ma a 18:00–20:00", async () => {
    db.orders = [ordine({ created_at: "2026-10-30T16:38:00.000Z" })];
    await giro("2026-10-30T16:50:00.000Z");
    expect(o("o1").delivery_slot).toBe("Oggi · 18:00–19:30");
    expect(String(db.notifications[0]?.body)).not.toContain("15:00–18:00");
  });

  it("V-partito: un ordine del carrello è già partito col fattorino: il freno non sposta niente, non scrive al cliente e avvisa gli admin una volta", async () => {
    db.orders = [
      ordine({ delivery_status: "PICKED_UP" }),
      ordine({ id: "o2", seller_id: "frutta", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    const esito = await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_status: "PICKED_UP", delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400, total_price: 19 });
    expect(o("o2")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 100, total_price: 13 });
    expect(db.notifications).toHaveLength(0);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(String(notifyAdminsMock.mock.calls[0][1])).toContain("#O1");
    expect(String(notifyAdminsMock.mock.calls[0][1])).toContain("#O2");
    expect(notifyAdminsMock.mock.calls[0][3]).toMatchObject({ unaVoltaPer: expect.any(String) });
    expect(esito).toMatchObject({ daSistemareAMano: 1, spostati: 0 });
  });

  it("V-domenica: sabato 20:20 veloce, negozio chiuso la domenica: niente fascia finta, niente «ti contattiamo noi», il cliente sa che alle 21:00, quando il forno chiude, si annulla", async () => {
    const lunSab: [string, string][] = [["08:00", "21:00"]];
    db.profiles = [{ id: "forno", store_hours: { mon: lunSab, tue: lunSab, wed: lunSab, thu: lunSab, fri: lunSab, sat: lunSab, sun: [] } }];
    db.orders = [ordine({ created_at: "2026-10-31T19:20:00.000Z" })];
    await giro("2026-10-31T19:35:00.000Z");
    expect(o("o1")).toMatchObject({ delivery_slot: ETICHETTA_ADESSO, delivery_fee_cents: 400, total_price: 19 });
    expect(db.notifications).toHaveLength(1);
    const frase = String(db.notifications[0].body);
    expect(frase).toContain("Il negozio non ha ancora confermato. Se non conferma entro le 21:00 di oggi");
    expect(frase).toMatch(/ordine si annulla e non paghi niente/);
    expect(frase).not.toMatch(/contattiamo|Domani|non lo paghi/);
    const mail = sendEmailMock.mock.calls[0][0] as { subject: string; html: string };
    expect(`${mail.subject} ${mail.html}`).not.toMatch(/contattiamo/i);
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    await giro("2026-10-31T19:40:00.000Z");
    expect(db.notifications).toHaveLength(1);
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});

describe("il secondo freno della veloce: il giro dell ondata 17", () => {
  it("V-margine: la fascia nuova finisce almeno 60 minuti dopo: alle 20:00 «Oggi · 19:30–21:00» va, alle 20:01 no", async () => {
    db.orders = [ordine({ created_at: "2026-10-30T18:45:00.000Z" })];
    await giro("2026-10-30T19:00:00.000Z");
    expect(o("o1").delivery_slot).toBe("Oggi · 19:30–21:00");
    db.orders = [ordine({ id: "o3", created_at: "2026-10-30T18:46:00.000Z" })];
    await giro("2026-10-30T19:01:00.000Z");
    expect(o("o3").delivery_slot).toBe("Domani · 7:30–9:00");
  });

  it("V-euro-altrove: l euro sta sull ordine già accettato, non su quello non confermato: si toglie lì e alla porta si paga 31 € invece di 32", async () => {
    db.orders = [
      ordine({ id: "o2", seller_id: "frutta", delivery_status: "ACCEPTED", created_at: "2026-10-30T17:04:59.000Z" }),
      ordine({ total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100 }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o2")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_status: "ACCEPTED", delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 18, gross_total_cents: 1800 });
    expect(o("o1")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_fee_cents: 100, total_price: 13 });
    const alCliente = db.notifications.filter((n) => n.user_id === "maria");
    expect(String(alCliente[0]?.body)).toContain("alla porta paghi 31,00");
  });

  it("V-avvisi: quando il carrello cambia fascia lo sanno il negozio che aveva accettato e il fattorino assegnato", async () => {
    db.orders = [
      ordine(),
      ordine({ id: "o2", seller_id: "frutta", delivery_status: "ASSIGNED", rider_id: "nicola", total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" }),
    ];
    db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
    await giro("2026-10-30T17:16:00.000Z");
    const a = (u: string) => db.notifications.filter((n) => n.user_id === u);
    expect(a("maria")).toHaveLength(1);
    expect(String(a("frutta")[0]?.body)).toContain("Oggi · 18:00–19:30");
    expect(String(a("nicola")[0]?.body)).toContain("Oggi · 18:00–19:30");
  });

  it("V-carta: con la carta l euro torna da solo con un rimborso parziale di 1 €", async () => {
    db.orders = [ordine({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" })];
    await giro("2026-10-30T17:16:00.000Z");
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    // L euro della veloce è di MyCity (lib/constants.ts, SUPPLEMENTO_CONSEGNA_CENTS): il negozio non ne paga niente.
    expect(refundOrderMock.mock.calls[0][0]).toMatchObject({ orderId: "o1", amountCents: 100, quotaNegozioCents: 0 });
    expect(o("o1")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30" });
    expect(String(db.notifications[0].body)).toContain("ti torna sulla carta");
    expect(notifyAdminsMock).not.toHaveBeenCalled();
  });

  it("V-senza-124: prima della migrazione 124 il carrello si sposta lo stesso e alla porta paga 18 €", async () => {
    senza124.attivo = true;
    const { gross_total_cents: _nonCe, ...vecchio } = ordine();
    db.orders = [vecchio];
    const esito = await giro("2026-10-30T17:16:00.000Z");
    expect(esito).toMatchObject({ ok: true, spostati: 1 });
    expect(o("o1")).toMatchObject({ delivery_slot: "Oggi · 18:00–19:30", delivery_fee_cents: 300, total_price: 18 });
    expect(o("o1")).not.toHaveProperty("gross_total_cents");
    expect(String(db.notifications[0].body)).toContain("non lo paghi");
  });

  it("V-carta-guasto: se il rimborso non parte, il cliente legge «te lo rendiamo a mano entro un giorno» e gli admin lo sanno", async () => {
    refundOrderMock.mockRejectedValueOnce(new Error("stripe giù"));
    db.orders = [ordine({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" })];
    await giro("2026-10-30T17:16:00.000Z");
    const frase = String(db.notifications[0].body);
    expect(frase).toContain("te lo rendiamo a mano entro un giorno");
    expect(frase).not.toContain("non lo paghi");
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(String(notifyAdminsMock.mock.calls[0][1])).toContain("#O1");
  });

  it("V-pagina: il negozio non legge «accettala entro le 18:15» dopo le 18:15, e sulla fascia nuova legge la fine della fascia", () => {
    const veloce = { created_at: NATO, delivery_slot: ETICHETTA_ADESSO };
    expect(rigaScadenzaPerIlNegozio(veloce, new Date("2026-10-30T17:10:00.000Z"))).toContain("entro le 18:15");
    const dopo = String(rigaScadenzaPerIlNegozio(veloce, new Date("2026-10-30T17:20:00.000Z")));
    expect(dopo).not.toContain("entro le 18:15");
    expect(dopo).toContain("21:05");
    const spostata = { created_at: NATO, delivery_slot: "Stasera · 18:00–20:00" };
    expect(rigaScadenzaPerIlNegozio(spostata, new Date("2026-10-30T17:16:00.000Z"))).toContain("entro le 20:00 di oggi");
    const finita = String(rigaScadenzaPerIlNegozio(spostata, new Date("2026-10-30T19:30:00.000Z")));
    expect(finita).not.toContain("entro le 20:00");
    expect(finita).toContain("21:05");
  });

  it("V-carta-meno: se il rimborso rende meno di 1 €, il cliente non legge «ti torna sulla carta» e gli admin lo sanno", async () => {
    refundOrderMock.mockResolvedValueOnce({ refundId: "re_1", reversedCents: 0, pieno: false, importoCents: 60 });
    db.orders = [ordine({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" })];
    await giro("2026-10-30T17:16:00.000Z");
    const frase = String(db.notifications[0].body);
    expect(frase).not.toContain("ti torna sulla carta");
    expect(frase).toContain("a mano");
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
  });

  for (const modo of ["cod", "card"] as const) {
    it(`V-senza-124-due-negozi (${modo}): senza la 124 il carrello di due negozi si sposta tutto e l euro si toglie una volta`, async () => {
      senza124.attivo = true;
      const senzaLordo = (r: Riga) => { const { gross_total_cents: _x, ...v } = r; return v; };
      const pago = modo === "card" ? { payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" } : {};
      db.orders = [
        senzaLordo(ordine(pago)),
        senzaLordo(ordine({ ...pago, id: "o2", seller_id: "frutta", total_price: 13, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: "2026-10-30T17:05:00.001Z" })),
      ];
      if (modo === "cod") db.cod_checkout_attempts = [{ user_id: "maria", order_ids: [{ id: "o1" }, { id: "o2" }] }];
      const esito = await giro("2026-10-30T17:16:00.000Z");
      expect(esito).toMatchObject({ ok: true, spostati: 1 });
      expect(o("o1").delivery_slot).toBe("Oggi · 18:00–19:30");
      expect(o("o2").delivery_slot).toBe("Oggi · 18:00–19:30");
      if (modo === "cod") {
        expect(o("o1")).toMatchObject({ delivery_fee_cents: 300, total_price: 18 });
        expect(o("o2")).toMatchObject({ delivery_fee_cents: 100, total_price: 13 });
        expect(String(db.notifications.find((n) => n.user_id === "maria")?.body)).toContain("alla porta paghi 31,00");
      } else {
        expect(refundOrderMock).toHaveBeenCalledTimes(1);
        expect(refundOrderMock.mock.calls[0][0]).toMatchObject({ orderId: "o1", amountCents: 100 });
      }
    });
  }

  it("V-carta-morte: se il giro muore fra la fascia e il rimborso, il giro dopo rende lo stesso l euro", async () => {
    db.orders = [ordine({ payment_method: "card", payment_status: "PAID", stripe_session_id: "cs_1" })];
    // Il primo giro si ferma dentro la chiamata a Stripe (la funzione scade e muore lì).
    refundOrderMock.mockImplementationOnce(() => new Promise(() => {}));
    void giro("2026-10-30T17:16:00.000Z");
    await vi.waitFor(() => expect(refundOrderMock).toHaveBeenCalledTimes(1));
    await giro("2026-10-30T17:21:00.000Z");
    expect(refundOrderMock).toHaveBeenCalledTimes(2);
    expect(refundOrderMock.mock.calls[1][0]).toMatchObject({ orderId: "o1", amountCents: 100, idempotencyKey: "veloce_non_confermata_o1" });
    expect(o("o1").delivery_slot).toBe("Oggi · 18:00–19:30");
    expect(String(db.notifications.find((n) => n.user_id === "maria")?.body)).toContain("ti torna sulla carta");
  });
});
