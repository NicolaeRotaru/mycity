import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FASCE_DI_DOMANI } from '@/lib/quando-arriva';

/**
 * R27 — LA FUNZIONE CHE MUORE FRA L'ORDINE E GLI ARTICOLI NON LASCIA PIU' LA
 * MERCE RISERVATA SENZA NESSUNO CHE LA LIBERI.
 *
 * La cassa in contanti scala la merce e toglie il credito PRIMA di scrivere
 * l'ordine, e scrive gli articoli DOPO. Se la funzione moriva in mezzo, della
 * riserva restava traccia solo nella sua memoria: merce scalata e credito tolto
 * per sempre. Qui la cassa muore davvero (l'inserimento dell'ordine lancia,
 * come un tempo scaduto), passano tre ore, gira il lavoro degli ordini fermi, e
 * si guarda lo scaffale e il credito.
 *
 * Il database finto fa quello che fanno le funzioni della migrazione 961 (la
 * prova SQL tests/sql/rls/riparazione-r27-riserva-scritta.test.sql le prova sul
 * Postgres vero): `reserve_stock` con la riga della riserva scrive riga e merce
 * insieme; `restore_stock` con la riga la toglie e rimette una volta sola;
 * `chiudi_riserva_contanti` la toglie senza rimettere (gli articoli ci sono);
 * `libera_riserve_orfane` rimette la merce delle righe vecchie senza articoli,
 * e il credito se l'ordine non e' mai nato.
 */

const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PANE = '11111111-1111-4111-8111-111111111111';
const ORA_ZERO = new Date('2026-11-26T10:00:00.000Z');

type Riga = Record<string, unknown>;
type Merce = { product_id: string; variant_id: string | null; qty: number };

const stato = vi.hoisted(() => ({
  ordini: [] as Riga[],
  articoli: [] as Riga[],
  tentativi: [] as Riga[],
  riserve: [] as Riga[],
  diario: [] as Array<{ user_id: string; delta_cents: number; reason: string; ref: string }>,
  scorte: {} as Record<string, number>,
  saldo: 0,
  /** La funzione muore sull'inserimento dell'ordine: 'prima' del salvataggio o 'dopo'. */
  muore: null as null | 'prima' | 'dopo',
  articoliFalliscono: false,
  senza961: false,
  rpc: [] as Array<{ nome: string; args: Riga }>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: Riga; profile: unknown; req: unknown }) => unknown) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/store-hours', async (originale) => ({
  ...(await originale<typeof import('@/lib/store-hours')>()),
  negozioPuoServire: vi.fn(() => true),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessun codice' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => ({ lat: 45.0526, lng: 9.6929 })) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn() }));
// Il giro degli ordini fermi qui non annulla nessun ordine: si guarda solo cosa fa delle riserve.
vi.mock('@/lib/ordini/scadenza-accettazione', async (originale) => ({
  ...(await originale<typeof import('@/lib/ordini/scadenza-accettazione')>()),
  ancoraNeiTempi: vi.fn(() => true),
}));

vi.mock('@/lib/supabase/server', () => {
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id', 'payment_method', 'delivery_status'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    order_items: ['order_id'],
    products: ['id'],
    wallet_ledger: ['user_id', 'reason', 'ref'],
  };
  const prodotti = () => [
    { id: PANE, seller_id: FORNO, name: 'Pane', price: 4, stock: stato.scorte[PANE], has_variants: false, images: [], status: 'available', express_enabled: false },
  ];
  const righeDi = (nome: string): Riga[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'order_items') return stato.articoli;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'products') return prodotti();
    if (nome === 'wallet_ledger') return stato.diario as unknown as Riga[];
    if (nome === 'seller_public_profiles') return [{ id: FORNO, store_name: 'Forno', store_lat: 45.0526, store_lng: 9.6929, is_approved: true }];
    return [];
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Riga) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: Riga = {};
    let righeNuove: Riga[] = [];
    const tieni = (c: string, f: (r: Riga) => boolean) => {
      if ((colonne[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'is', 'gt', 'lt', 'lte', 'gte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.insert = (v: Riga | Riga[]) => ((op = 'insert'), (righeNuove = Array.isArray(v) ? v : [v]), (valori = righeNuove[0]), b);
    b.update = (v: Riga) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    const scelte = () => righeDi(nome).filter((r) => filtri.every((f) => f(r)));
    const esegui = (): { data: unknown; error: unknown } => {
      if (op === 'insert') {
        if (nome === 'orders') {
          if (stato.muore === 'prima') throw new Error('FUNCTION_INVOCATION_TIMEOUT');
          const id = valori.id as string;
          if (stato.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          stato.ordini.push({ ...valori, id, created_at: new Date().toISOString() });
          if (stato.muore === 'dopo') throw new Error('FUNCTION_INVOCATION_TIMEOUT');
          return { data: { id, created_at: new Date().toISOString() }, error: null };
        }
        if (nome === 'order_items') {
          if (stato.articoliFalliscono) return { data: null, error: { message: 'rete caduta sugli articoli' } };
          stato.articoli.push(...righeNuove.map((r) => ({ ...r })));
          return { data: null, error: null };
        }
        if (nome === 'cod_checkout_attempts') {
          if (stato.tentativi.some((t) => t.chiave === valori.chiave)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          stato.tentativi.push({ ...valori, created_at: new Date().toISOString() });
        }
        return { data: null, error: null };
      }
      if (op === 'update') {
        for (const r of scelte()) Object.assign(r, valori);
        return { data: null, error: null };
      }
      if (op === 'delete') {
        const via = new Set(scelte());
        const tutte = righeDi(nome);
        for (let i = tutte.length - 1; i >= 0; i--) if (via.has(tutte[i])) tutte.splice(i, 1);
        return { data: null, error: null };
      }
      return { data: scelte(), error: null };
    };
    const uno = () => {
      const e = esegui();
      return Array.isArray(e.data) ? { data: e.data[0] ?? null, error: e.error } : e;
    };
    b.single = () => Promise.resolve(uno());
    b.maybeSingle = () => Promise.resolve(uno());
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve().then(esegui).then(ok, ko);
    return b;
  };

  const scala = (items: Merce[]) => {
    for (const it of items) if ((stato.scorte[it.product_id] ?? 0) < it.qty) return { code: '23514', message: `OUT_OF_STOCK:${it.product_id}` };
    for (const it of items) stato.scorte[it.product_id] -= it.qty;
    return null;
  };
  const rimetti = (items: Merce[]) => {
    for (const it of items) stato.scorte[it.product_id] += it.qty;
  };
  const scriviNelDiario = (user: string, delta: number, reason: string, ref: string) => {
    if (stato.diario.some((d) => d.reason === reason && d.ref === ref)) return false;
    stato.diario.push({ user_id: user, delta_cents: delta, reason, ref });
    stato.saldo += delta;
    return true;
  };
  const rpc = async (nome: string, args: Riga) => {
    stato.rpc.push({ nome, args });
    const nessunaFunzione = { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${nome}` } };
    if (nome === 'reserve_stock') {
      const items = args.p_items as Merce[];
      if (args.p_riserva) {
        if (stato.senza961) return nessunaFunzione;
        const errore = scala(items);
        if (errore) return { data: null, error: errore };
        const r = args.p_riserva as Riga;
        stato.riserve.push({ id: r.id, order_id: r.order_id, user_id: r.user_id, wallet_ref: r.wallet_ref ?? null, items, created_at: Date.now() });
        return { data: null, error: null };
      }
      return { data: null, error: scala(items) };
    }
    if (nome === 'restore_stock') {
      if (args.p_riserva) {
        if (stato.senza961) return nessunaFunzione;
        const i = stato.riserve.findIndex((r) => r.id === args.p_riserva);
        if (i < 0) return { data: null, error: null };
        const [r] = stato.riserve.splice(i, 1);
        rimetti(r.items as Merce[]);
        return { data: null, error: null };
      }
      rimetti(args.p_items as Merce[]);
      return { data: null, error: null };
    }
    if (nome === 'chiudi_riserva_contanti') {
      if (stato.senza961) return nessunaFunzione;
      const i = stato.riserve.findIndex((r) => r.id === args.p_riserva);
      if (i >= 0) stato.riserve.splice(i, 1);
      return { data: null, error: null };
    }
    if (nome === 'libera_riserve_orfane') {
      if (stato.senza961) return nessunaFunzione;
      const soglia = Date.now() - Number(args.p_minuti) * 60_000;
      let liberate = 0;
      for (const r of [...stato.riserve].filter((x) => (x.created_at as number) < soglia)) {
        stato.riserve.splice(stato.riserve.indexOf(r), 1);
        if (stato.articoli.some((a) => a.order_id === r.order_id)) continue;
        rimetti(r.items as Merce[]);
        if (r.wallet_ref && !stato.ordini.some((o) => o.id === r.order_id)) {
          const spesa = stato.diario.find((d) => d.user_id === r.user_id && d.reason === 'order_cod' && d.ref === r.wallet_ref);
          if (spesa && spesa.delta_cents < 0) scriviNelDiario(r.user_id as string, -spesa.delta_cents, 'order_cod_refund', r.wallet_ref as string);
        }
        liberate++;
      }
      return { data: liberate, error: null };
    }
    if (nome === 'wallet_debit') {
      const tolto = Math.min(stato.saldo, Number(args.p_max_cents));
      if (tolto <= 0) return { data: 0, error: null };
      return { data: scriviNelDiario(args.p_user as string, -tolto, String(args.p_reason), String(args.p_ref)) ? tolto : 0, error: null };
    }
    if (nome === 'wallet_credit') {
      scriviNelDiario(args.p_user as string, Number(args.p_cents), String(args.p_reason), String(args.p_ref));
      return { data: stato.saldo, error: null };
    }
    return { data: null, error: null };
  };
  return {
    getAdminSupabase: () => ({
      from: tavola,
      rpc,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from: tavola }),
  };
});

async function ordina(chiave: string, quanti = 3, useCredit = false) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': chiave },
    body: JSON.stringify({
      groups: [{ sellerId: FORNO, items: [{ productId: PANE, quantity: quanti }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      deliverySlot: FASCE_DI_DOMANI[0],
      useCredit,
    }),
  });
  try {
    const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
    return { morta: false, status: res.status };
  } catch {
    // La funzione e' morta: nessuna riga di codice dopo l'inserimento dell'ordine e' girata.
    return { morta: true, status: 504 };
  }
}

async function giroDegliOrdiniFermi() {
  const { GET } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://localhost/api/cron/expire-stale-orders?a_mano=1'));
  expect(res.status, 'il giro degli ordini fermi si e fermato').toBe(200);
}

function passanoOre(ore: number) {
  vi.setSystemTime(new Date(Date.now() + ore * 3_600_000));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ORA_ZERO);
  stato.ordini.length = 0;
  stato.articoli.length = 0;
  stato.tentativi.length = 0;
  stato.riserve.length = 0;
  stato.diario.length = 0;
  stato.rpc.length = 0;
  stato.scorte = { [PANE]: 10 };
  stato.saldo = 0;
  stato.muore = null;
  stato.articoliFalliscono = false;
  stato.senza961 = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('R27 · la merce di una cassa in contanti morta in mezzo torna a scaffale', () => {
  it('morta fra l\'ordine e gli articoli: dopo il giro degli ordini fermi la merce torna a scaffale', async () => {
    stato.muore = 'dopo';
    const esito = await ordina('chiave-r27-dopo', 3);
    expect(esito.morta).toBe(true);
    expect(stato.ordini, 'l ordine e nato').toHaveLength(1);
    expect(stato.articoli, 'gli articoli non sono mai arrivati').toHaveLength(0);
    expect(stato.scorte[PANE]).toBe(7);

    // Il giro di adesso non tocca una cassa che potrebbe essere ancora al lavoro.
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE], 'il giro ha liberato la merce di una cassa forse ancora viva').toBe(7);

    passanoOre(3);
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE], 'la merce riservata per l ordine senza articoli e rimasta scalata').toBe(10);

    // Un altro giro non la rimette una seconda volta.
    passanoOre(1);
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE], 'la merce e tornata due volte').toBe(10);
  });

  it('morta prima dell\'ordine, col credito gia tolto: tornano la merce e il credito', async () => {
    stato.saldo = 500;
    stato.muore = 'prima';
    const esito = await ordina('chiave-r27-prima', 2, true);
    expect(esito.morta).toBe(true);
    expect(stato.ordini, 'l ordine non e nato').toHaveLength(0);
    expect(stato.scorte[PANE]).toBe(8);
    expect(stato.saldo, 'il credito e stato speso').toBe(0);

    passanoOre(3);
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE], 'la merce di un ordine mai nato e rimasta scalata').toBe(10);
    expect(stato.saldo, 'il credito tolto per un ordine mai nato non e tornato').toBe(500);
  });

  it('l\'ordine nato intero non lascia una riserva da liberare: niente pezzi fantasma', async () => {
    const esito = await ordina('chiave-r27-intero', 3);
    expect(esito.morta).toBe(false);
    expect(esito.status).toBe(200);
    expect(stato.articoli).toHaveLength(1);
    expect(stato.riserve, 'la riga della riserva resta aperta dopo gli articoli').toHaveLength(0);

    passanoOre(3);
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE], 'il giro ha rimesso in vendita la merce di un ordine vero').toBe(7);
  });

  it('gli articoli che non si salvano: la merce torna una volta sola, anche dopo il giro', async () => {
    stato.articoliFalliscono = true;
    const esito = await ordina('chiave-r27-articoli', 4);
    expect(esito.morta).toBe(false);
    expect(esito.status).toBe(500);
    expect(stato.scorte[PANE], 'la cassa non ha rimesso la merce del suo ordine annullato').toBe(10);
    expect(stato.riserve).toHaveLength(0);

    passanoOre(3);
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE], 'la merce e tornata due volte').toBe(10);
  });

  it('senza la migrazione 961 sul database la cassa riserva come prima e l\'ordine nasce', async () => {
    stato.senza961 = true;
    const esito = await ordina('chiave-r27-senza961', 3);
    expect(esito.status).toBe(200);
    expect(stato.ordini).toHaveLength(1);
    expect(stato.articoli).toHaveLength(1);
    expect(stato.scorte[PANE]).toBe(7);
    expect(stato.rpc.filter((c) => c.nome === 'reserve_stock').map((c) => Object.keys(c.args).sort().join(','))).toEqual([
      'p_items,p_riserva',
      'p_items',
    ]);

    passanoOre(3);
    await giroDegliOrdiniFermi();
    expect(stato.scorte[PANE]).toBe(7);
  });
});
