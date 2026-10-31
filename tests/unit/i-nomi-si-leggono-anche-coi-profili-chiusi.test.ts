/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import { DOPO_LA_161, type Mondo } from './aiuti/database-coi-permessi';
import { databaseDegliOrdini, type DatiOrdini } from './aiuti/database-degli-ordini-coi-permessi';

/**
 * 31/10/2026 (ondata 1, migrazione 164) — I NOMI CHE ALTRI DEVONO LEGGERE SI VEDONO ANCHE QUANDO
 * LA TABELLA DEI PROFILI SI CHIUDE.
 *
 * Le migrazioni 110, 112 e 161 chiudono `profiles`: dopo, ognuno legge solo la propria riga. Tre
 * punti del sito leggevano li' il nome di un altro, e la lettura tornava vuota senza errore:
 *  ① il nome del fattorino, al cliente (ordine e recensione) e al negozio (pagina dell'ordine);
 *  ② chi ha scritto una domanda sotto un prodotto;
 *  ③ chi ha scritto una recensione nella vetrina del negozio.
 *
 * Qui le pagine e i componenti si MONTANO, e la lettura scritta dentro gira contro un database finto
 * che applica i permessi di chi guarda. La vista `nomi_pubblici` del finto rifa' i tre filtri della
 * migrazione 164. Nel mondo «oggi» la vista non c'e' ancora (PGRST205) e `profiles` e' aperta a chi
 * ha il profilo pubblico: li' si prova che il sito non perde i nomi se esce prima della migrazione.
 */

const PANE = 'n-pane';
const MARIA = 'u-maria';
const LUCA = 'u-luca';
const ANNA = 'u-anna';
const BEPPE = 'u-beppe';
const O_IN_CORSO = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const O_CONSEGNATO = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PRODOTTO = 'p-focaccia';

const PROFILI = [
  { id: PANE, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Pane Quotidiano', store_address: 'Via Roma 1, Piacenza', store_phone: '0523 000000', store_lat: 45.05, store_lng: 9.69, full_name: 'Giovanni Forno' },
  { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi', public_profile_enabled: false },
  { id: LUCA, role: 'rider', is_approved: true, store_name: null, full_name: 'Luca Verdi', public_profile_enabled: false },
  { id: ANNA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Anna Bianchi', public_profile_enabled: true },
  { id: BEPPE, role: 'buyer', is_approved: false, store_name: null, full_name: 'Beppe Neri', public_profile_enabled: false },
];

function ordine(sopra: Record<string, unknown>) {
  return {
    user_id: MARIA, seller_id: PANE, rider_id: LUCA, total_price: 24, shipping_cost: 0, delivery_fee_cents: 0,
    discount_amount: 0, wallet_applied_cents: 0, gross_total_cents: 2400, refunded_amount_cents: 0, rider_fee_cents: 300,
    pickup_in_store: false, payment_status: 'PAID', payment_method: 'card', stripe_refund_id: null,
    accepted_at: '2026-10-30T10:05:00Z', ready_at: null, picked_up_at: null, delivered_at: null, canceled_at: null,
    cash_confirmed_at: null, delivery_full_name: 'Maria Rossi', delivery_phone: '333 1234567', delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza', delivery_zip: '29121', delivery_notes: null, delivery_lat: 45.04, delivery_lng: 9.7,
    rider_lat: null, rider_lng: null, rider_position_updated_at: null, created_at: '2026-10-30T10:00:00Z',
    ...sopra,
  };
}

function datiOrdini(): DatiOrdini {
  return {
    profiles: PROFILI.map((p) => ({ ...p })),
    orders: [
      ordine({ id: O_IN_CORSO, delivery_status: 'ASSIGNED' }),
      ordine({ id: O_CONSEGNATO, delivery_status: 'DELIVERED', delivered_at: '2026-10-30T11:00:00Z' }),
    ],
    order_items: [
      { id: 'r1', order_id: O_IN_CORSO, quantity: 2, unit_price: 12, product_id: PRODOTTO, product_name: 'Focaccia', product_image: null },
      { id: 'r2', order_id: O_CONSEGNATO, quantity: 2, unit_price: 12, product_id: PRODOTTO, product_name: 'Focaccia', product_image: null },
    ],
    products: [{ id: PRODOTTO, name: 'Focaccia', images: null }],
  };
}

const DOMANDE = [
  { id: 'q1', product_id: PRODOTTO, author_id: BEPPE, question: 'E senza glutine?', answer: null, answered_at: null, created_at: '2026-10-29T09:00:00Z', is_public: true },
  { id: 'q2', product_id: PRODOTTO, author_id: ANNA, question: 'Quanto dura fresca?', answer: 'Due giorni', answered_at: '2026-10-29T12:00:00Z', created_at: '2026-10-29T10:00:00Z', is_public: true },
];
const RECENSIONI = [
  { id: 's1', store_id: PANE, user_id: BEPPE, order_id: null, rating: 5, comment: 'Ottimo pane', created_at: '2026-10-28T09:00:00Z', seller_reply: null, photo_urls: null, helpful_count: 0 },
  { id: 's2', store_id: PANE, user_id: ANNA, order_id: null, rating: 4, comment: 'Buona focaccia', created_at: '2026-10-27T09:00:00Z', seller_reply: null, photo_urls: null, helpful_count: 0 },
];

type MondoNomi = 'oggi' | 'dopo';
const primaParola = (n: unknown) => (typeof n === 'string' && n.trim() ? n.trim().split(/\s+/)[0] : null);
const VISTA_ASSENTE = { code: 'PGRST205', message: "Could not find the table 'public.nomi_pubblici' in the schema cache" };

/** La vista `nomi_pubblici` come la scrive la migrazione 164: tre filtri, solo il nome di battesimo. */
function righeDellaVista(chi: string | null, ordini: Array<Record<string, unknown>>) {
  const negozioApprovato = (id: unknown) => PROFILI.some((p) => p.id === id && p.role === 'seller' && p.is_approved === true);
  return PROFILI.filter(
    (p) =>
      RECENSIONI.some((r) => r.user_id === p.id && negozioApprovato(r.store_id)) ||
      DOMANDE.some((q) => q.author_id === p.id && q.is_public) ||
      ordini.some((o) => o.rider_id === p.id && chi !== null && (o.user_id === chi || o.seller_id === chi)),
  ).map((p) => ({ id: p.id, nome: primaParola(p.full_name) }));
}

/** Una lettura del finto: select, eq, in; order e limit non cambiano niente qui. */
function lettura(risolvi: (filtri: Array<[string, string, unknown]>, colonne: string) => { data: unknown; error: unknown }) {
  const filtri: Array<[string, string, unknown]> = [];
  let colonne = '';
  const c: Record<string, unknown> = {};
  c.select = (col: string) => { colonne = col ?? ''; return c; };
  c.eq = (k: string, v: unknown) => { filtri.push(['eq', k, v]); return c; };
  c.in = (k: string, v: unknown) => { filtri.push(['in', k, v]); return c; };
  c.order = () => c;
  c.limit = () => c;
  c.then = (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risolvi(filtri, colonne)).then(ok, ko);
  return c;
}
const passa = (riga: Record<string, unknown>, filtri: Array<[string, string, unknown]>) =>
  filtri.every(([t, k, v]) => (t === 'eq' ? riga[k] === v : (v as unknown[]).includes(riga[k])));

/** `from('nomi_pubblici')` aggiunto a un client: assente oggi, coi tre filtri dopo la 164. */
function conVistaDeiNomi(mondo: MondoNomi, chi: string | null, ordini: Array<Record<string, unknown>>) {
  return (filtri: Array<[string, string, unknown]>) =>
    mondo === 'oggi'
      ? { data: null, error: VISTA_ASSENTE }
      : { data: righeDellaVista(chi, ordini).filter((r) => passa(r, filtri)), error: null };
}

/** Il database della vetrina (domande e recensioni) coi permessi di chi guarda. */
function databaseDellaVetrina(mondo: MondoNomi, chi: string | null) {
  const profiliVisibili = () =>
    PROFILI.filter((p) => (chi !== null && p.id === chi) || (mondo === 'oggi' && p.public_profile_enabled === true));
  const vista = conVistaDeiNomi(mondo, chi, []);
  return {
    from: (tabella: string) =>
      lettura((filtri, colonne) => {
        if (tabella === 'nomi_pubblici') return vista(filtri);
        if (tabella === 'profiles') {
          const campi = colonne.split(',').map((x) => x.trim());
          return { data: profiliVisibili().filter((p) => passa(p, filtri)).map((p) => Object.fromEntries(campi.map((k) => [k, (p as Record<string, unknown>)[k] ?? null]))), error: null };
        }
        if (tabella === 'product_questions') {
          return {
            data: DOMANDE.filter((q) => q.is_public && passa(q, filtri)).map((q) => {
              const riga: Record<string, unknown> = { ...q };
              if (/author\s*:\s*profiles/.test(colonne)) {
                const p = profiliVisibili().find((x) => x.id === q.author_id);
                riga.author = p ? { full_name: p.full_name } : null;
              }
              return riga;
            }),
            error: null,
          };
        }
        if (tabella === 'store_reviews') return { data: RECENSIONI.filter((r) => passa(r, filtri)), error: null };
        return { data: [], error: null };
      }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => undefined,
    auth: { getUser: async () => ({ data: { user: chi ? { id: chi } : null }, error: null }) },
  };
}

const globale = globalThis as Record<string, unknown>;
type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };

/** Monta, esegue le letture che il file stesso chiede, rimonta con le risposte. */
async function aSchermo(file: string, props: Record<string, unknown>, client: unknown, chi: string | null) {
  const pagina = (await monta(file)).default;
  globale.__CLIENT_SUPABASE__ = client;
  globale.__UTENTE__ = chi ? { id: chi } : null;
  globale.__PROFILO__ = { isAuthenticated: !!chi, isRider: false, isSeller: chi === PANE, profile: { full_name: 'Chi guarda' } };
  const risposte = new Map<string, unknown>();
  const errori = new Map<string, string>();
  const chieste = new Map<string, Opzioni>();
  globale.__DATI_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    if (o.enabled !== false && o.queryFn && !risposte.has(k) && !errori.has(k)) chieste.set(k, o);
    return risposte.get(k);
  };
  globale.__ESITO_QUERY__ = (o: Opzioni) => {
    const k = JSON.stringify(o.queryKey);
    return errori.has(k) ? { isError: true, isSuccess: false, data: undefined, error: new Error(errori.get(k)) } : undefined;
  };
  for (let giro = 0; giro < 5; giro += 1) {
    const s = accendi(pagina, props);
    await attendi();
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k) && !errori.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      try {
        risposte.set(k, await o.queryFn!({ queryKey: o.queryKey, meta: undefined }));
      } catch (e) {
        errori.set(k, e instanceof Error ? e.message : JSON.stringify(e));
      }
    }
  }
  const s = accendi(pagina, props);
  await attendi();
  await attendi();
  return { testo: testoVisibile(s.radice), errori };
}

/** Il client degli ordini (permessi di chi guarda) con in piu' la vista dei nomi. */
function clientDegliOrdini(mondo: Mondo, nomi: MondoNomi, chi: string) {
  const d = datiOrdini();
  const base = databaseDegliOrdini(d, mondo, chi).client as { from: (t: string) => unknown };
  const vista = conVistaDeiNomi(nomi, chi, d.orders);
  return new Proxy(base, {
    get(bersaglio, chiave, ricevente) {
      if (chiave === 'from') return (t: string) => (t === 'nomi_pubblici' ? lettura((f) => vista(f)) : bersaglio.from(t));
      return Reflect.get(bersaglio, chiave, ricevente);
    },
  });
}

describe('il nome del fattorino si vede anche coi profili chiusi (dopo 161 e 164)', () => {
  it('Maria, nella pagina del suo ordine in corso, legge «Luca», non «Il tuo rider»', async () => {
    const { testo, errori } = await aSchermo('app/orders/[id]/page.tsx', { params: { id: O_IN_CORSO } }, clientDegliOrdini(DOPO_LA_161, 'dopo', MARIA), MARIA);
    expect([...errori.values()]).toEqual([]);
    expect(testo).toContain('Luca');
    expect(testo).not.toContain('Il tuo rider');
    expect(testo).not.toContain('Luca Verdi');
  });

  it('Maria, nella recensione dell\'ordine consegnato, valuta «Luca»', async () => {
    const { testo, errori } = await aSchermo('app/orders/[id]/review/page.tsx', { params: { id: O_CONSEGNATO } }, clientDegliOrdini(DOPO_LA_161, 'dopo', MARIA), MARIA);
    expect([...errori.values()]).toEqual([]);
    expect(testo).toContain('Luca');
    expect(testo).not.toContain('Il tuo rider');
  });

  it('il negozio, nella pagina dell\'ordine, legge «Rider Luca», non «Rider assegnato»', async () => {
    const { testo, errori } = await aSchermo('app/seller/orders/[id]/page.tsx', { params: { id: O_IN_CORSO } }, clientDegliOrdini(DOPO_LA_161, 'dopo', PANE), PANE);
    expect([...errori.values()]).toEqual([]);
    expect(testo).toMatch(/Rider\s*Luca/);
    expect(testo).not.toMatch(/Rider\s*assegnato/);
  });
});

describe('le domande sotto un prodotto sono firmate col nome di chi le ha scritte', () => {
  for (const chi of [null, MARIA]) {
    it(`dopo la 161 e la 164, chi guarda (${chi ?? 'senza account'}) legge «Beppe» e «Anna», non «Cliente»`, async () => {
      const { testo, errori } = await aSchermo('components/ProductQA.tsx', { productId: PRODOTTO, sellerId: PANE }, databaseDellaVetrina('dopo', chi), chi);
      expect([...errori.values()]).toEqual([]);
      expect(testo).toContain('E senza glutine?');
      expect(testo).toContain('Beppe');
      expect(testo).toContain('Anna');
      expect(testo).not.toContain('Cliente');
      expect(testo).not.toContain('Neri');
    });
  }

  it('oggi, prima della 164, il ripiego su profiles tiene il nome di chi ha il profilo pubblico', async () => {
    const { testo, errori } = await aSchermo('components/ProductQA.tsx', { productId: PRODOTTO, sellerId: PANE }, databaseDellaVetrina('oggi', null), null);
    expect([...errori.values()]).toEqual([]);
    expect(testo).toContain('Anna');
    expect(testo).toContain('Cliente');
  });
});

describe('le recensioni nella vetrina del negozio sono firmate col nome di chi le ha scritte', () => {
  async function autori(mondo: MondoNomi, chi: string | null) {
    const { useStorePageData } = (await monta('components/store-sections/useStorePageData.ts')) as {
      useStorePageData: (id: string) => unknown;
    };
    globale.__CLIENT_SUPABASE__ = databaseDellaVetrina(mondo, chi);
    const chieste: Opzioni[] = [];
    globale.__DATI_QUERY__ = (o: Opzioni) => { chieste.push(o); return undefined; };
    globale.__ESITO_QUERY__ = undefined;
    useStorePageData(PANE);
    const recensioni = chieste.find((o) => JSON.stringify(o.queryKey).includes(PANE) && /review/i.test(JSON.stringify(o.queryKey)));
    expect(recensioni, 'la lettura delle recensioni del negozio').toBeTruthy();
    const righe = (await recensioni!.queryFn!({ queryKey: recensioni!.queryKey })) as Array<{ author: string | null }>;
    return righe.map((r) => r.author);
  }

  it('dopo la 161 e la 164, chi guarda senza account legge «Beppe» e «Anna»', async () => {
    expect(await autori('dopo', null)).toEqual(['Beppe', 'Anna']);
  });

  it('oggi, prima della 164, il ripiego tiene il nome di chi ha il profilo pubblico (e solo il nome)', async () => {
    expect(await autori('oggi', null)).toEqual([null, 'Anna']);
  });
});
