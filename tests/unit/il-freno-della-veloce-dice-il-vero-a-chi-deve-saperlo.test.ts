import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { ETICHETTA_ADESSO } from "@/lib/quando-arriva";
import { rigaScadenzaPerIlNegozio } from "@/lib/ordini/scadenza-accettazione";
import { CRON_MAX_STALENESS_MIN } from "@/lib/cron-health";
import { romeNow } from "@/lib/store-hours";

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

describe("il freno della veloce dice il vero a chi deve saperlo", () => {
  it("① la frase del freno non promette un annullo senza limite, e la rotta dice la stessa cosa", async () => {
    const { fraseDelFreno } = await import("@/lib/ordini/veloce-non-confermata");
    for (const euro of ["compresa", "tolto-contanti", "tolto-carta", "a-mano"] as const) {
      const f = fraseDelFreno({ fascia: "Domani · 9:00–12:00", euro, totaleCents: 1800, sulCreditoCents: euro === "tolto-contanti" ? 0 : undefined });
      expect(f).toContain("finché il negozio non lo conferma");
    }

    // Maria: veloce in contanti alle 18:05, il forno non conferma, il freno la sposta alle 18:16.
    db.orders = [ordine()];
    await giro("2026-10-30T17:16:00.000Z");
    expect(o("o1").delivery_slot).toBe("Oggi · 18:00–19:30");
    const campanella = String(db.notifications.find((n) => n.user_id === "maria")?.body ?? "");
    const email = String((sendEmailMock.mock.calls[0]?.[0] as { text?: string } | undefined)?.text ?? "");
    for (const t of [campanella, email]) {
      expect(t).toContain("finché il negozio non lo conferma");
      expect(t).not.toMatch(/annullare l’ordine dalla sua pagina senza costi\./);
    }

    // Alle 18:20 il forno accetta la fascia nuova: da lì l annullo non si può più, come dice la frase.
    o("o1").delivery_status = "ACCEPTED";
    const { POST } = await import("@/app/api/orders/[id]/cancel/route");
    const res = await (POST as unknown as (r: Request, c: unknown) => Promise<Response>)(
      new Request("http://x/api/orders/o1/cancel", { method: "POST" }), { params: { id: "o1" } });
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("non puoi più annullarlo");
    expect(o("o1").delivery_status).toBe("ACCEPTED");
  });

  it("② la fascia non si scrive per tre giri, con la carta: gli amministratori lo sanno una volta, e la rotta non dice 200", async () => {
    db.orders = [ordine(conCarta)];
    guasto.fascia = true;
    for (const ora of ["2026-10-30T17:16:00.000Z", "2026-10-30T17:21:00.000Z", "2026-10-30T17:26:00.000Z"]) {
      const { status, corpo } = await giro(ora);
      expect(corpo).toMatchObject({ daSistemareAMano: 1, spostati: 0 });
      expect(status).not.toBe(200);
    }
    // L euro è tornato sulla carta una volta sola, e l ordine è ancora «Adesso».
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    expect(o("o1").delivery_slot).toBe(ETICHETTA_ADESSO);
    const fermi = avvisi().filter((a) => a.corpo.includes("#O1") && a.corpo.includes("già reso sulla carta"));
    expect(fermi.length).toBeGreaterThanOrEqual(1);
    expect(fermi[0].corpo).toContain("timeout del database");
    // Tre giri, un avviso solo che arriva davvero: la stessa chiave non si ripete ogni 5 minuti.
    expect(new Set(fermi.map((a) => a.chiave)).size).toBe(1);
  });

  it("③ Maria annulla mentre il freno rende l euro: l avviso dice «annullato», non «il negozio ha confermato»", async () => {
    db.orders = [ordine(conCarta)];
    prima.update = () => { o("o1").delivery_status = "CANCELED"; };
    await giro("2026-10-30T17:16:00.000Z");
    expect(refundOrderMock).toHaveBeenCalledTimes(1);
    const tutti = avvisi();
    expect(tutti.length).toBeGreaterThanOrEqual(1);
    // «Il negozio non l ha confermato» è vero; falso è dire che l ha confermato.
    for (const a of tutti) expect(`${a.titolo} ${a.corpo}`).not.toMatch(/Il negozio ha confermato|Veloce confermata/);
    expect(tutti.some((a) => a.corpo.includes("#O1") && /annullato/.test(a.corpo))).toBe(true);
  });

  it("③bis il negozio conferma davvero mentre il freno rende l euro: l avviso resta quello giusto", async () => {
    db.orders = [ordine(conCarta)];
    prima.update = () => { o("o1").delivery_status = "ACCEPTED"; };
    await giro("2026-10-30T17:16:00.000Z");
    expect(avvisi().some((a) => /Veloce confermata/.test(a.titolo))).toBe(true);
  });

  it("④ ogni lavoro di vercel.json sta nell elenco del manuale, e il freno porta la soglia del sorvegliante", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    const doc = JSON.parse(readFileSync("docs/crons.json", "utf8")) as { jobs: Array<Record<string, unknown>> };
    const ids = doc.jobs.map((j) => j.id);
    expect(vercel.crons.map((c) => c.path.split("/").pop()).filter((x) => !ids.includes(x))).toEqual([]);
    const freno = doc.jobs.find((j) => j.id === "veloce-non-confermata")!;
    expect(freno.schedule).toBe(vercel.crons.find((c) => c.path.endsWith("/veloce-non-confermata"))!.schedule);
    expect(freno.soglia_sorveglianza_min).toBe(CRON_MAX_STALENESS_MIN["veloce-non-confermata"]);
    expect(readFileSync("docs/runbook.md", "utf8")).toContain("veloce-non-confermata");
  });

  it("⑤ la riga «entro quando accettare» del negozio si ricalcola a ogni lettura periodica", () => {
    // Venerdì 21:15 per «Domani · 9:00–12:00»; sabato alle 8:30 la riga giusta dice «di oggi».
    const ord = { created_at: "2026-10-30T20:15:00.000Z", delivery_slot: "Domani · 9:00–12:00" };
    expect(rigaScadenzaPerIlNegozio(ord, new Date("2026-10-31T07:30:00.000Z"))).toContain("entro le 12:00 di oggi");
    for (const f of ["app/seller/orders/page.tsx", "app/seller/orders/[id]/page.tsx"]) {
      const src = readFileSync(f, "utf8");
      // Mai la riga con l ora presa una volta sola quando la pagina si disegna.
      expect(src).not.toMatch(/rigaScadenzaPerIlNegozio\(\s*\w+\s*\)/);
      expect(src).toMatch(/rigaScadenzaPerIlNegozio\(\s*\w+\s*,\s*\w+/);
      expect(src).toContain("dataUpdatedAt");
    }
  });

  it("⑥ sabato 20:20, negozio chiuso la domenica: la riga della veloce al negozio non promette una fascia che non c è", async () => {
    const { fasciaDopoLaVeloce } = await import("@/lib/ordini/veloce-non-confermata");
    const nato = "2026-10-31T19:20:00.000Z";
    expect(fasciaDopoLaVeloce(romeNow(new Date("2026-10-31T19:30:00.000Z")), [chiusoDomenica])).toBeNull();
    const riga = String(rigaScadenzaPerIlNegozio({ created_at: nato, delivery_slot: ETICHETTA_ADESSO }, new Date(nato)));
    expect(riga).toContain("10 minuti");
    expect(riga).not.toMatch(/passa alla prima fascia/);
    expect(riga).toMatch(/se c’è una fascia/);
    const { newOrderSellerTemplate } = await import("@/lib/email/templates");
    vi.setSystemTime(new Date(nato));
    const t = newOrderSellerTemplate({ orderId: "o1", total: 15, itemsCount: 1, createdAt: nato, deliverySlot: ETICHETTA_ADESSO });
    expect(t.text).not.toMatch(/passa alla prima fascia/);
  });
});
