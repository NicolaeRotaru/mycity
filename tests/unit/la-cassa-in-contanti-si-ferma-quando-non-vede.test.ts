import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger } from '@/lib/logger';
import { laChiaveVaButtata } from '@/lib/ordini/chiave-dopo-l-errore';

/**
 * 28/10/2026 — LA CASSA IN CONTANTI SI FERMA QUANDO NON VEDE. Due difetti, la stessa malattia: un
 * dato che manca veniva letto come «va tutto bene».
 *
 * ① LA LETTURA DEI NEGOZI TORNAVA CORTA, E I CONTROLLI SALTAVANO. La rotta prendeva i negozi del
 *    carrello e non guardava né l'errore né quanti ne erano tornati. Un negozio uscito dalla vetrina
 *    fra il carrello e la cassa, una regola dei permessi cambiata, una rete che cade: la lista
 *    tornava vuota e «negozio chiuso» e «fuori zona» non scattavano, perché non c'era nessuno da
 *    controllare. È già successo una volta (la migrazione 110: zero righe, nessun errore).
 *    Qui il negozio è CHIUSO: se la rotta lo vedesse, rifiuterebbe. La lettura torna vuota, oppure
 *    con un errore: l'ordine non deve nascere.
 *
 * ② LA PROVA DELL'ORDINE SI SCRIVEVA «SE CI RIESCO». Gli ordini nascono, poi la riga della chiave si
 *    riempie con i loro numeri: è l'unica cosa che fa riconoscere un secondo invio. Se quella
 *    scrittura falliva, la rotta annotava un avviso e rispondeva «fatto». Passato un minuto, lo
 *    stesso invio — la risposta persa sulla rete del telefono, il cliente che ritocca «Ordina» —
 *    veniva preso per un tentativo abbandonato: la chiave si cancellava e nasceva un SECONDO ordine
 *    sullo stesso carrello. Merce scalata due volte, il negozio che prepara due spese.
 *
 * Autenticazione e database sono finti; la rotta è vera.
 */

const NEGOZIO_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODOTTO = '11111111-1111-1111-1111-111111111111';
const NEGOZIO = { lat: 45.0526, lng: 9.6929, nome: 'Pane Quotidiano' };

const stato: {
  aperto: boolean;
  venditori: { data: unknown[] | null; error: { message: string } | null };
  riga: { order_ids: unknown[]; created_at: string } | null;
  provaFallisce: boolean;
  scrittureProva: number;
} = {
  aperto: true,
  venditori: { data: [], error: null },
  riga: null,
  provaFallisce: false,
  scrittureProva: 0,
};
const ordiniCreati: Array<Record<string, unknown>> = [];
const profili: unknown[] = [];

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _o: unknown,
      h: (ctx: { user: { id: string; email: string; email_confirmed_at: string }; profile: unknown; req: unknown }) => unknown,
    ) =>
    (req: unknown) =>
      h({
        user: { id: 'cliente-1', email: 'cliente@test.it', email_confirmed_at: '2026-01-01T00:00:00Z' },
        profile: { role: 'buyer', is_approved: true },
        req,
      }),
  assertCanPurchase: vi.fn(() => null),
}));
vi.mock('@/lib/store-hours', () => ({
  negozioPuoServire: vi.fn(() => stato.aperto),
  motivoNegozioChiuso: vi.fn((n: string) => `${n} è chiuso.`),
}));
vi.mock('@/lib/promotions', () => ({
  fetchActiveDiscounts: vi.fn(async () => new Map()),
  discountedUnitCents: vi.fn((prezzo: number) => Math.round(prezzo * 100)),
}));
vi.mock('@/lib/coupons', () => ({ validateCoupon: vi.fn(async () => ({ ok: false, reason: 'nessun codice' })) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/dopo-la-risposta', () => ({ dopoLaRisposta: vi.fn() }));
vi.mock('@/lib/shipping-coordinate', () => ({ coordinateDaIndirizziSalvati: vi.fn(async () => NEGOZIO) }));
vi.mock('@/lib/geocodifica', () => ({ coordinateDiUnIndirizzo: vi.fn(async () => null) }));

vi.mock('@/lib/supabase/server', () => {
  const prodotti = [
    { id: PRODOTTO, seller_id: NEGOZIO_ID, name: 'Pane', price: 12, stock: 10, has_variants: false, images: [], status: 'available' },
  ];
  const catena = (lista: () => unknown, singolo: unknown = { data: null, error: null }) => {
    const b: Record<string, unknown> = {};
    for (const passo of ['select', 'eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'filter', 'order', 'limit', 'not', 'or', 'update', 'upsert', 'delete', 'insert']) {
      b[passo] = () => b;
    }
    b.single = () => Promise.resolve(singolo);
    b.maybeSingle = () => Promise.resolve(singolo);
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(lista()).then(ok, ko);
    return b;
  };
  /** La riga della chiave: una sola per cliente, con chiave primaria vera (il secondo inserimento è un 23505). */
  const tentativi = (): Record<string, unknown> => {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let valori: { order_ids?: unknown[] } = {};
    const b: Record<string, unknown> = {};
    for (const passo of ['select', 'eq', 'order', 'limit']) b[passo] = () => b;
    b.insert = () => ((op = 'insert'), b);
    b.update = (v: { order_ids?: unknown[] }) => ((op = 'update'), (valori = v), b);
    b.delete = () => ((op = 'delete'), b);
    b.maybeSingle = () => Promise.resolve({ data: stato.riga, error: null });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let esito: unknown = { data: [], error: null };
      if (op === 'insert') {
        if (stato.riga) esito = { error: { code: '23505', message: 'duplicate key' } };
        else {
          stato.riga = { order_ids: [], created_at: new Date().toISOString() };
          esito = { error: null };
        }
      } else if (op === 'update') {
        stato.scrittureProva++;
        if (stato.provaFallisce) esito = { error: { message: 'rete caduta' } };
        else {
          if (stato.riga) stato.riga.order_ids = valori.order_ids ?? [];
          esito = { error: null };
        }
      } else if (op === 'delete') {
        stato.riga = null;
        esito = { error: null };
      }
      return Promise.resolve(esito).then(ok, ko);
    };
    return b;
  };
  const from = (tavola: string): Record<string, unknown> => {
    if (tavola === 'products') return catena(() => ({ data: prodotti, error: null }));
    if (tavola === 'seller_public_profiles') return catena(() => stato.venditori);
    if (tavola === 'cod_checkout_attempts') return tentativi();
    if (tavola === 'profiles') return catena(() => ({ data: profili, error: null }));
    if (tavola === 'orders') {
      // Una lettura degli ordini restituisce quelli nati finora, come farebbe il database.
      const c = catena(() => ({
        data: ordiniCreati.map((o, i) => ({ id: `ord-${i + 1}`, seller_id: o.seller_id, total_price: o.total_price })),
        error: null,
      }));
      c.insert = (riga: unknown) => {
        ordiniCreati.push((Array.isArray(riga) ? riga[0] : riga) as Record<string, unknown>);
        const id = `ord-${ordiniCreati.length}`;
        return catena(() => ({ data: [{ id }], error: null }), { data: { id }, error: null });
      };
      return c;
    }
    return catena(() => ({ data: [], error: null }));
  };
  return {
    getAdminSupabase: () => ({
      from,
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
    getServerSupabase: async () => ({ from }),
  };
});

const NEGOZIO_IN_VETRINA = { id: NEGOZIO_ID, store_name: NEGOZIO.nome, store_lat: NEGOZIO.lat, store_lng: NEGOZIO.lng, store_hours: null };

async function ordina(chiave?: string) {
  const { POST } = await import('@/app/api/orders/cod/route');
  const req = new Request('http://localhost/api/orders/cod', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chiave ? { 'idempotency-key': chiave } : {}) },
    body: JSON.stringify({
      groups: [{ sellerId: NEGOZIO_ID, items: [{ productId: PRODOTTO, quantity: 1 }] }],
      delivery: { fullName: 'Maria Rossi', address: 'Via Emilia 1', city: 'Piacenza', zip: '29121', phone: '3331234567' },
      pickupInStore: false,
      useCredit: false,
    }),
  });
  const res = await (POST as unknown as (r: never) => Promise<Response>)(req as never);
  const corpo = (await res.json()) as { ok?: boolean; error?: { message?: string } };
  return { res, corpo };
}

/** Il minuto che passa: la riga della chiave diventa vecchia, come quella di un invio morto per strada. */
function passaUnMinutoEMezzo() {
  if (stato.riga) stato.riga.created_at = new Date(Date.now() - 90_000).toISOString();
}

beforeEach(() => {
  ordiniCreati.length = 0;
  profili.length = 0;
  stato.aperto = true;
  stato.venditori = { data: [NEGOZIO_IN_VETRINA], error: null };
  stato.riga = null;
  stato.provaFallisce = false;
  stato.scrittureProva = 0;
  vi.mocked(logger.error).mockClear();
});

describe('① la lettura dei negozi che torna corta ferma l’ordine', () => {
  it('controllo: il negozio aperto, letto per intero, riceve l’ordine (il finto database funziona)', async () => {
    const { res, corpo } = await ordina();
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(ordiniCreati).toHaveLength(1);
  });

  it('controllo: il negozio chiuso, letto per intero, viene rifiutato', async () => {
    stato.aperto = false;
    const { res } = await ordina();
    expect(res.status).toBe(409);
    expect(ordiniCreati).toHaveLength(0);
  });

  it('IL CASO — il negozio è chiuso ma la lettura torna VUOTA, senza errore: l’ordine non nasce', async () => {
    stato.aperto = false;
    stato.venditori = { data: [], error: null };
    const { res, corpo } = await ordina();
    expect(ordiniCreati, `è nato un ordine verso un negozio che nessuno ha controllato (${res.status} ${JSON.stringify(corpo)})`).toHaveLength(0);
    expect(res.status).toBe(409);
    expect(logger.error).toHaveBeenCalled();
  });

  it('la lettura torna con un ERRORE: l’ordine non nasce e la persona sa che può riprovare', async () => {
    stato.venditori = { data: null, error: { message: 'connessione chiusa' } };
    const { res, corpo } = await ordina();
    expect(ordiniCreati, `è nato un ordine con la lettura dei negozi fallita (${res.status} ${JSON.stringify(corpo)})`).toHaveLength(0);
    expect(res.status).toBe(503);
    expect(logger.error).toHaveBeenCalled();
  });

  it('la vetrina non restituisce un negozio approvato senza insegna: i controlli girano coi dati del profilo', async () => {
    stato.venditori = { data: [], error: null };
    profili.push({ ...NEGOZIO_IN_VETRINA, store_name: null, role: 'seller', is_approved: true });
    const aperto = await ordina();
    expect(aperto.res.status, `il negozio approvato senza insegna ha perso la vendita: ${JSON.stringify(aperto.corpo)}`).toBe(200);
    expect(ordiniCreati).toHaveLength(1);

    ordiniCreati.length = 0;
    stato.aperto = false;
    const chiuso = await ordina();
    expect(ordiniCreati, 'il negozio chiuso senza insegna ha ricevuto l’ordine: il controllo è saltato').toHaveLength(0);
    expect(chiuso.res.status).toBe(409);
  });

  it('un profilo che non è più un negozio approvato non passa', async () => {
    stato.venditori = { data: [], error: null };
    profili.push({ ...NEGOZIO_IN_VETRINA, role: 'seller', is_approved: false });
    const { res } = await ordina();
    expect(ordiniCreati).toHaveLength(0);
    expect(res.status).toBe(409);
  });

  it('il negozio fermato non lascia la chiave occupata: il tentativo dopo non legge «già in corso»', async () => {
    stato.venditori = { data: [], error: null };
    await ordina('chiave-corta');
    expect(stato.riga, 'la chiave è rimasta occupata da un ordine mai nato').toBeNull();
  });
});

describe('② la prova dell’ordine in contanti non è più «se ci riesco»', () => {
  it('controllo: con la prova scritta, il secondo invio riprende gli ordini di prima', async () => {
    await ordina('chiave-buona');
    passaUnMinutoEMezzo();
    const { res } = await ordina('chiave-buona');
    expect(res.status).toBe(200);
    expect(ordiniCreati).toHaveLength(1);
  });

  it('IL CASO — la prova non si scrive, la risposta si perde, dopo un minuto si ritocca «Ordina»: niente secondo ordine', async () => {
    stato.provaFallisce = true;
    const primo = await ordina('chiave-persa');
    expect(primo.res.status).toBe(200);
    expect(ordiniCreati).toHaveLength(1);

    passaUnMinutoEMezzo();
    const secondo = await ordina('chiave-persa');
    expect(ordiniCreati, `è nato un SECONDO ordine sullo stesso carrello (${secondo.res.status} ${JSON.stringify(secondo.corpo)})`).toHaveLength(1);

    // Il 3° invio, come lo fa il browser vero (app/checkout/page.tsx): su un errore senza
    // `inCorso` butta la chiave e il carrello resta pieno, quindi il tocco dopo parte con una
    // chiave nuova. La risposta al 2° invio non deve lasciarlo succedere.
    if (!secondo.res.ok && laChiaveVaButtata(secondo.corpo)) {
      stato.riga = null; // la chiave nuova non ha riga (il finto database ne tiene una sola)
      const terzo = await ordina('chiave-nuova');
      expect(ordiniCreati, `3° invio: SECONDO ordine dopo la risposta al 2° (${terzo.res.status} ${JSON.stringify(terzo.corpo)})`).toHaveLength(1);
    }
    expect(secondo.res.status, JSON.stringify(secondo.corpo)).toBe(200);
    expect(secondo.corpo).toMatchObject({ ripetuto: true, orderIds: ['ord-1'] });
  });

  it('la prova che non si scrive si riprova, e se non passa scatta l’allarme con la cifra', async () => {
    stato.provaFallisce = true;
    await ordina('chiave-allarme');
    expect(stato.scrittureProva, 'la prova si è tentata una volta sola').toBeGreaterThan(1);
    const allarme = vi.mocked(logger.error).mock.calls.find(([m]) => String(m).includes('prova'));
    expect(allarme, 'nessun allarme: gli ordini sono nati senza protezione e nessuno lo sa').toBeDefined();
    expect(allarme?.[1]).toMatchObject({ totaleCents: expect.any(Number), ordini: expect.any(Array) });
  });

  it('una chiave davvero abbandonata, senza ordini nati, si libera ancora (il rimedio di agosto resta)', async () => {
    stato.riga = { order_ids: [], created_at: new Date(Date.now() - 90_000).toISOString() };
    const { res, corpo } = await ordina('chiave-morta');
    expect(res.status, JSON.stringify(corpo)).toBe(200);
    expect(ordiniCreati).toHaveLength(1);
  });
});
