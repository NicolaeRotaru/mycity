import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
const guasto: Record<string, boolean> = {};
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
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => guasto[nome] ? Promise.resolve({ data: null, error: { message: "guasto" } }).then(ok, ko) :
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
  guasto.profiles = false;
  sendEmailMock.mockClear();
  notifyAdminsMock.mockClear();
});
afterEach(() => vi.useRealTimers());

const lunSab: [string, string][] = [['08:00', '21:00']];
const chiusoDomenica = { mon: lunSab, tue: lunSab, wed: lunSab, thu: lunSab, fri: lunSab, sat: lunSab, sun: [] };

describe('il freno della veloce regge guasti, margini e concorrenza', () => {
  it('W-guasto: sabato 20:35, negozio chiuso la domenica, lettura orari in errore: niente «Domani · 9:00–12:00»', async () => {
    db.profiles = [{ id: 'forno', store_hours: chiusoDomenica }];
    guasto.profiles = true;
    db.orders = [ordine({ created_at: '2026-10-31T19:20:00.000Z' })];
    await giro('2026-10-31T19:35:00.000Z');
    expect(o('o1').delivery_slot).not.toBe('Domani · 9:00–12:00');
    expect(String(db.notifications[0]?.body ?? '')).not.toContain('Domani · 9:00–12:00');
  });

  it('W-guasto-poi: durante il guasto l ordine resta «Adesso», gli admin lo sanno e il cliente legge l ora vera dell annullo; finito il guasto niente fascia finta né secondo avviso', async () => {
    db.profiles = [{ id: 'forno', store_hours: chiusoDomenica }];
    guasto.profiles = true;
    db.orders = [ordine({ created_at: '2026-10-31T19:20:00.000Z' })];
    await giro('2026-10-31T19:35:00.000Z');
    expect(o('o1').delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(db.notifications).toHaveLength(1);
    expect(String(db.notifications[0].body)).toContain('Se non conferma entro le 23:20');
    expect(String(db.notifications[0].body)).not.toMatch(/contattiamo/);
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);

    guasto.profiles = false;
    await giro('2026-10-31T19:40:00.000Z');
    expect(o('o1').delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(db.notifications).toHaveLength(1);
  });

  it('W-margine: alle 19:05 la fascia 18:00–20:00 ha 55 minuti: si va a domani', async () => {
    db.orders = [ordine({ created_at: '2026-10-30T17:50:00.000Z' })];
    await giro('2026-10-30T18:05:00.000Z');
    expect(o('o1').delivery_slot).toBe('Domani · 9:00–12:00');
  });

  it('W-concorrenza: l ordine che porta l euro cambia stato mentre il freno lavora: niente «alla porta paghi», admin avvisati', async () => {
    db.orders = [
      ordine({ delivery_status: 'ACCEPTED' }),
      ordine({ id: 'o2', seller_id: 'frutta', total_price: 13, gross_total_cents: 1300, delivery_fee_cents: 100, rider_fee_cents: 100, created_at: '2026-10-30T17:05:00.001Z' }),
    ];
    db.cod_checkout_attempts = [{ user_id: 'maria', order_ids: [{ id: 'o1' }, { id: 'o2' }] }];
    prima.update = () => { db.orders[0].delivery_status = 'READY'; };
    await giro('2026-10-30T17:16:00.000Z');
    expect(o('o1')).toMatchObject({ delivery_status: 'READY', delivery_fee_cents: 400, total_price: 19 });
    expect(o('o2').delivery_slot).toBe('Stasera · 18:00–20:00');
    expect(String(db.notifications[0]?.body)).not.toContain('alla porta paghi');
    expect(String(notifyAdminsMock.mock.calls[0]?.[1] ?? '')).toContain('#O1');
  });

  it('W-scadenza: veloce 17:38 spostata alle 17:50 su 18:00–20:00: entro quando può accettare il negozio', async () => {
    db.orders = [ordine({ created_at: '2026-10-30T16:38:00.000Z' })];
    await giro('2026-10-30T16:50:00.000Z');
    const scade = scadenzaAccettazione({ created_at: String(o('o1').created_at), delivery_slot: String(o('o1').delivery_slot) });
    expect(o('o1').delivery_slot).toBe('Stasera · 18:00–20:00');
    expect(scade?.toISOString()).toBe('2026-10-30T19:38:00.000Z');
    const riga = rigaScadenzaPerIlNegozio({ created_at: String(o('o1').created_at), delivery_slot: String(o('o1').delivery_slot) }, new Date('2026-10-30T16:50:00.000Z'));
    expect(riga).toContain('entro le 20:00 di oggi');
  });
});
