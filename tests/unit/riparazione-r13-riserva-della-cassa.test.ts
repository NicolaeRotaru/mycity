import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { idOrdiniDelTentativo } from '@/lib/ordini/chiave-dopo-l-errore';

/**
 * R13-002 — LA FUNZIONE CHE MUORE FRA LA RISERVA E GLI ARTICOLI NON LASCIA PIU' LA MERCE SENZA NESSUNO.
 *
 * La rotta dei contanti scala merce (`reserve_stock`) e credito (`wallet_debit`) prima di scrivere
 * l'ordine, e gli articoli dopo. Cosa aveva preso lo sapeva solo la memoria della funzione: se moriva
 * in mezzo, la merce restava scalata e il credito tolto, e nessuno li rimetteva.
 *
 * Qui la rotta vera, con un database finto che fa quello che fa il database vero dopo la migrazione
 * 371: `reserve_stock` con la riga scrive la riserva nella stessa transazione, `restore_stock` con la
 * riga la chiude mentre rimette la merce, `chiudi_riserve_della_cassa` la chiude a ordine finito. Cosa
 * fa la pulizia con le righe rimaste aperte lo prova tests/sql/rls/riparazione-r13-riserva-della-cassa.test.sql;
 * qui si guarda che la rotta lasci scritto tutto quello che serve, e che chi torna a ordinare la chiami
 * prima di leggere la merce.
 */

const FORNO = 'aaaaaaaa-0000-4000-8000-000000000001';
const FIORAIO = 'bbbbbbbb-0000-4000-8000-000000000002';
const PANE = '11111111-1111-4111-8111-111111111111';
const FIORI = '22222222-2222-4222-8222-222222222222';
const CLIENTE = 'cliente-1';
const PIACENZA = { lat: 45.0526, lng: 9.6929 };

type Riga = Record<string, unknown>;
type Merce = Array<{ product_id: string; variant_id: string | null; qty: number }>;
const stato = vi.hoisted(() => ({
  ordini: [] as Record<string, unknown>[],
  tentativi: [] as Record<string, unknown>[],
  negozi: [] as Record<string, unknown>[],
  articoli: [] as Record<string, unknown>[],
  scorte: {} as Record<string, number>,
  riserve: [] as Record<string, unknown>[],
  diario: [] as Array<{ reason: string; ref: string; delta: number }>,
  saldo: 0,
  muoreDopoLOrdine: false,
  muorePrimaDellOrdine: false,
  ordineRifiutato: false,
  senzaMigrazione: false,
  eventi: [] as string[],
  chiamate: [] as Array<{ nome: string; args: Record<string, unknown> }>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, h: (ctx: { user: Record<string, unknown>; profile: unknown; req: unknown }) => unknown) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn((orari: unknown) => orari !== 'chiuso'),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
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

vi.mock('@/lib/supabase/server', () => {
  const prodotti: Record<string, unknown>[] = [
    { id: '11111111-1111-4111-8111-111111111111', seller_id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Pane', price: 4, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
    { id: '22222222-2222-4222-8222-222222222222', seller_id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Fiori', price: 9, stock: 50, has_variants: false, images: [], status: 'available', express_enabled: false },
  ];
  const colonne: Record<string, string[]> = {
    orders: ['id', 'user_id'],
    cod_checkout_attempts: ['chiave', 'user_id'],
    seller_public_profiles: ['id'],
    products: ['id'],
    order_items: ['order_id'],
  };
  const righeDi = (nome: string): Record<string, unknown>[] => {
    if (nome === 'orders') return stato.ordini;
    if (nome === 'cod_checkout_attempts') return stato.tentativi;
    if (nome === 'seller_public_profiles') return stato.negozi;
    if (nome === 'products') return prodotti;
    if (nome === 'order_items') return stato.articoli;
    return [];
  };
  const tavola = (nome: string) => {
    const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: Record<string, unknown> = {};
    const tieni = (c: string, f: (r: Record<string, unknown>) => boolean) => {
      if ((colonne[nome] ?? []).includes(c)) filtri.push(f);
    };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'is', 'gt', 'lt', 'lte', 'gte', 'filter', 'not', 'or', 'upsert', 'neq']) b[m] = () => b;
    b.eq = (c: string, v: unknown) => (tieni(c, (r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => (tieni(c, (r) => v.includes(r[c])), b);
    b.insert = (v: Record<string, unknown> | Record<string, unknown>[]) => ((op = 'insert'), (valori = Array.isArray(v) ? v[0] : v), b);
    b.update = (v: Record<string, unknown>) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    const scelte = () => righeDi(nome).filter((r) => filtri.every((f) => f(r)));
    const esegui = (): { data: unknown; error: unknown; count?: number } => {
      if (op === 'insert') {
        if (nome === 'orders') {
          if (stato.muorePrimaDellOrdine) {
            stato.muorePrimaDellOrdine = false;
            throw new Error('FUNCTION_INVOCATION_TIMEOUT');
          }
          if (stato.ordineRifiutato) {
            stato.ordineRifiutato = false;
            return { data: null, error: { code: '23502', message: 'null value in column violates not-null constraint' } };
          }
          const id = (valori.id as string | undefined) ?? `ord-${stato.ordini.length + 1}`;
          if (stato.ordini.some((o) => o.id === id)) return { data: null, error: { code: '23505', message: 'duplicate key orders_pkey' } };
          stato.ordini.push({ ...valori, id, created_at: new Date().toISOString() });
          if (stato.muoreDopoLOrdine) {
            stato.muoreDopoLOrdine = false;
            throw new Error('FUNCTION_INVOCATION_TIMEOUT');
          }
          return { data: { id, created_at: new Date().toISOString() }, error: null };
        }
        if (nome === 'order_items') { stato.articoli.push({ ...valori }); return { data: null, error: null }; }
        if (nome === 'cod_checkout_attempts') {
          if (stato.tentativi.some((t) => t.chiave === valori.chiave)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          stato.tentativi.push({ ...valori, created_at: new Date().toISOString() });
        }
        return { data: null, error: null };
      }
      if (op === 'update') {
        const via = scelte();
        for (const r of via) Object.assign(r, valori);
        return { data: null, error: null, count: via.length };
      }
      if (op === 'delete') {
        const via = new Set(scelte());
        const tutte = righeDi(nome);
        for (let i = tutte.length - 1; i >= 0; i--) if (via.has(tutte[i])) tutte.splice(i, 1);
        return { data: null, error: null };
      }
      if (nome === 'products') stato.eventi.push('legge i prodotti');
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

  /** Il database dopo la 371, ridotto a cio' che la rotta ci chiede. */
  const firmaSconosciuta = (f: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${f} in the schema cache` } });
  const rpc = async (nome: string, args: Record<string, unknown> = {}) => {
    stato.chiamate.push({ nome, args });
    stato.eventi.push(`rpc ${nome}`);
    if (nome === 'reserve_stock') {
      if (args.p_riserva && stato.senzaMigrazione) return firmaSconosciuta('reserve_stock(p_items, p_riserva)');
      const merce = args.p_items as Merce;
      if (merce.some((m) => (stato.scorte[m.product_id] ?? 0) < m.qty)) return { data: null, error: { code: '23514', message: 'OUT_OF_STOCK' } };
      for (const m of merce) stato.scorte[m.product_id] -= m.qty;
      if (args.p_riserva) stato.riserve.push({ ...(args.p_riserva as Riga), merce, stato: 'aperta', created_at: new Date().toISOString() });
      return { data: null, error: null };
    }
    if (nome === 'restore_stock') {
      let merce = args.p_items as Merce;
      if (args.p_riserva) {
        if (stato.senzaMigrazione) return firmaSconosciuta('restore_stock(p_items, p_riserva)');
        const r = stato.riserve.find((x) => x.id === args.p_riserva && x.stato === 'aperta');
        if (!r) return { data: null, error: null };
        r.stato = 'rimessa';
        merce = r.merce as Merce;
      }
      for (const m of merce) stato.scorte[m.product_id] += m.qty;
      return { data: null, error: null };
    }
    if (nome === 'chiudi_riserve_della_cassa') {
      if (stato.senzaMigrazione) return firmaSconosciuta('chiudi_riserve_della_cassa');
      let n = 0;
      for (const r of stato.riserve) {
        if ((args.p_riserve as string[]).includes(r.id as string) && r.stato === 'aperta'
            && stato.articoli.some((a) => a.order_id === r.ordine_id)) { r.stato = 'ordine'; n++; }
      }
      return { data: n, error: null };
    }
    if (nome === 'libera_riserve_della_cassa') {
      if (stato.senzaMigrazione) return firmaSconosciuta('libera_riserve_della_cassa');
      return { data: { liberate: 0, a_meta: 0, chiuse: 0, incerte: 0, errori: 0 }, error: null };
    }
    if (nome === 'wallet_debit') {
      const tolto = Math.min(stato.saldo, Number(args.p_max_cents));
      if (stato.diario.some((d) => d.reason === args.p_reason && d.ref === args.p_ref)) return { data: 0, error: null };
      stato.saldo -= tolto;
      stato.diario.push({ reason: String(args.p_reason), ref: String(args.p_ref), delta: -tolto });
      return { data: tolto, error: null };
    }
    if (nome === 'wallet_credit') {
      if (!stato.diario.some((d) => d.reason === args.p_reason && d.ref === args.p_ref)) {
        stato.saldo += Number(args.p_cents);
        stato.diario.push({ reason: String(args.p_reason), ref: String(args.p_ref), delta: Number(args.p_cents) });
      }
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

const AL_FORNO = { sellerId: FORNO, items: [{ productId: PANE, quantity: 2 }] };
const AL_FIORAIO = { sellerId: FIORAIO, items: [{ productId: FIORI, quantity: 1 }] };

async function ordina(chiave: string | null, gruppi = [AL_FORNO], useCredit = false) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (chiave) headers['idempotency-key'] = chiave;
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      groups: gruppi,
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit,
    }),
  });
  try {
    const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
    return { status: res.status, corpo: (await res.json()) as Riga };
  } catch {
    // La funzione e' morta: nessuna risposta, nessuno storno.
    return { status: 504, corpo: {} as Riga };
  }
}

const aperte = () => stato.riserve.filter((r) => r.stato === 'aperta');
const rpcDi = (nome: string) => stato.chiamate.filter((c) => c.nome === nome);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00+01:00'));
  stato.ordini.length = 0;
  stato.tentativi.length = 0;
  stato.articoli.length = 0;
  stato.riserve.length = 0;
  stato.diario.length = 0;
  stato.eventi.length = 0;
  stato.chiamate.length = 0;
  stato.negozi.length = 0;
  stato.negozi.push(
    { id: FORNO, store_name: 'Pane Quotidiano', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
    { id: FIORAIO, store_name: 'Fiori di Via Roma', store_lat: PIACENZA.lat, store_lng: PIACENZA.lng, store_hours: null },
  );
  stato.scorte = { [PANE]: 50, [FIORI]: 50 };
  stato.saldo = 0;
  stato.muoreDopoLOrdine = false;
  stato.muorePrimaDellOrdine = false;
  stato.ordineRifiutato = false;
  stato.senzaMigrazione = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('la funzione muore in mezzo: la riserva resta scritta', () => {
  it('morta fra l ordine e gli articoli: resta la riga aperta con l ordine, la merce e la spesa di credito', async () => {
    stato.saldo = 500;
    stato.muoreDopoLOrdine = true;
    const esito = await ordina('cod-r13-morta', [AL_FORNO], true);
    expect(esito.status).toBe(504);
    expect(stato.ordini, 'l ordine e nato, senza articoli').toHaveLength(1);
    expect(stato.articoli).toHaveLength(0);
    expect(stato.scorte[PANE], 'la merce e stata scalata').toBe(48);
    expect(stato.saldo, 'il credito e stato tolto').toBe(0);

    const riga = stato.riserve.find((r) => r.ordine_id === stato.ordini[0].id);
    expect(riga, 'nessuna riserva scritta: la merce scalata la conosceva solo la funzione morta').toBeDefined();
    expect(riga?.stato).toBe('aperta');
    expect(riga?.merce).toEqual([{ product_id: PANE, variant_id: null, qty: 2 }]);
    const spesa = stato.diario.find((d) => d.reason === 'order_cod');
    expect(spesa?.delta).toBe(-500);
    expect(riga?.rif_credito, 'la riga non sa quale spesa di credito restituire').toBe(spesa?.ref);
  });

  it('morta prima dell ordine: la riga aperta dice l ordine previsto, che non c e', async () => {
    stato.muorePrimaDellOrdine = true;
    await ordina('cod-r13-prima');
    expect(stato.ordini).toHaveLength(0);
    expect(stato.scorte[PANE]).toBe(48);
    const [previsto] = await idOrdiniDelTentativo('cod-r13-prima', CLIENTE, 1);
    expect(aperte().map((r) => r.ordine_id), 'la merce scalata senza ordine non e scritta da nessuna parte').toEqual([previsto]);
  });

  it('senza la chiave del browser l ordine ha lo stesso un identificativo deciso prima, e la riga lo porta', async () => {
    stato.muoreDopoLOrdine = true;
    await ordina(null);
    expect(stato.ordini).toHaveLength(1);
    expect(aperte().map((r) => r.ordine_id)).toEqual([stato.ordini[0].id]);
  });

  it('la cassa dopo, con gli stessi prodotti, fa sistemare le riserve rimaste aperte prima di leggere la merce', async () => {
    stato.muorePrimaDellOrdine = true;
    await ordina('cod-r13-torna');
    vi.setSystemTime(new Date('2026-11-13T10:20:00+01:00'));
    stato.eventi.length = 0;
    stato.chiamate.length = 0;
    const esito = await ordina('cod-r13-torna-di-nuovo');
    expect(esito.status, JSON.stringify(esito.corpo)).toBe(200);
    expect(rpcDi('libera_riserve_della_cassa').map((c) => c.args), 'nessuno chiede di sistemare la merce rimasta presa')
      .toEqual([{ p_prodotti: [PANE] }]);
    expect(stato.eventi.indexOf('rpc libera_riserve_della_cassa')).toBeLessThan(stato.eventi.indexOf('legge i prodotti'));
  });
});

describe('le strade che non muoiono chiudono la loro riga', () => {
  it('ordine riuscito su due negozi: le due righe portano i due ordini e si chiudono come «ordine»', async () => {
    const esito = await ordina('cod-r13-due', [AL_FORNO, AL_FIORAIO]);
    expect(esito.status, JSON.stringify(esito.corpo)).toBe(200);
    expect(stato.riserve.map((r) => r.ordine_id).sort()).toEqual(stato.ordini.map((o) => o.id).sort());
    expect(stato.riserve.map((r) => r.stato), 'righe rimaste aperte su ordini interi').toEqual(['ordine', 'ordine']);
  });

  it('il secondo negozio non ha piu la merce: il primo ordine si annulla e la sua riga si chiude rimettendo la merce', async () => {
    stato.scorte[FIORI] = 0;
    const esito = await ordina('cod-r13-finita', [AL_FORNO, AL_FIORAIO]);
    expect(esito.status).toBe(409);
    expect(stato.ordini).toHaveLength(0);
    expect(stato.scorte[PANE], 'la merce del primo negozio non e tornata').toBe(50);
    expect(stato.riserve.map((r) => r.stato), 'la riga del primo negozio non e stata chiusa dallo storno').toEqual(['rimessa']);
    const storno = rpcDi('restore_stock').map((c) => c.args.p_riserva);
    expect(storno, 'lo storno non chiude la riga: la pulizia rimetterebbe la merce una seconda volta')
      .toEqual([stato.riserve[0]?.id]);
    expect(aperte()).toHaveLength(0);
  });

  it('l ordine non nasce (il database lo rifiuta): la merce torna chiudendo la sua riga', async () => {
    stato.ordineRifiutato = true;
    const esito = await ordina('cod-r13-rifiutato');
    expect(esito.status).toBe(500);
    expect(stato.scorte[PANE]).toBe(50);
    expect(stato.riserve.map((r) => r.stato), 'la riga resta aperta: la pulizia rimetterebbe la merce una seconda volta').toEqual(['rimessa']);
  });

  it('l ordine l ha gia scritto un invio gemello della stessa chiave: la nostra merce torna chiudendo la nostra riga', async () => {
    const [previsto] = await idOrdiniDelTentativo('cod-r13-gemello', CLIENTE, 1);
    stato.ordini.push({ id: previsto, user_id: CLIENTE, seller_id: FORNO, created_at: new Date().toISOString() });
    const esito = await ordina('cod-r13-gemello');
    expect(esito.status).toBe(409);
    expect(stato.scorte[PANE]).toBe(50);
    expect(stato.riserve.map((r) => r.stato), 'la riga del doppione resta aperta sull ordine del gemello').toEqual(['rimessa']);
  });
});

describe('prima della migrazione 371', () => {
  it('il database non conosce la riga: la merce si riserva come prima e l ordine nasce', async () => {
    stato.senzaMigrazione = true;
    const esito = await ordina('cod-r13-prima-della-371');
    expect(esito.status, JSON.stringify(esito.corpo)).toBe(200);
    expect(stato.scorte[PANE]).toBe(48);
    expect(stato.articoli).toHaveLength(1);
    expect(stato.riserve).toHaveLength(0);
  });
});
