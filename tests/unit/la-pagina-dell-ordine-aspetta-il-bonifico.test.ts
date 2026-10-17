/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { ComponentType } from 'react';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * LA PAGINA DELL'ORDINE DICE COME TORNANO DAVVERO I CONTANTI.
 *
 * Riesame del 16/10, quarto giro — la pagina diceva «Ordine rimborsato.» dal primo minuto, mentre i
 * soldi di chi aveva pagato in contanti arrivano dopo, con un bonifico fatto a mano.
 *
 * 17/10/2026 — Decisione di Nicola («Semplifica»): sul sito non c'è più una lista dei bonifici né un
 * «fatto». La pagina non chiede più niente al server oltre all'ordine: legge i segni
 * «bonifico:<cent>:<chiave>» che `refundOrder` scrive nell'elenco dei rimborsi dell'ordine
 * (`stripe_refund_id`, che solo il server scrive). Sui contanti ha due frasi sole:
 *  · con un segno: «Rimborso di X € con un bonifico…», con la cifra dei segni (solo i contanti, mai
 *    il lordo) — mai «Ordine rimborsato», mai «arrivato»;
 *  · «Paghi X € in contanti al rider» solo se l'ordine aspetta ancora l'incasso e non è né
 *    consegnato né annullato.
 * Ogni altra combinazione non dice niente. Così si chiudono anche due difetti gravi: l'ordine in
 * contanti annullato che diceva «Paghi 24,00 €» sotto «Ordine annullato», e l'ordine consegnato e
 * rimborsato in parte che diceva «Paghi 40,00 €».
 *
 * Girano le rotte VERE (decisione del reso, chiusura del reclamo) con la `refundOrder` vera sul
 * database finto; poi la pagina VERA viene montata con l'ordine come lo lascia il server, e si legge
 * quello che legge il cliente. La lettura dell'ordine passa dalla `select` vera della pagina: una
 * colonna che la pagina non chiede, la pagina non la vede.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia' }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_carta_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** Il maglione di Giulia: 40 € pagati in contanti al fattorino, consegnato e incassato ieri. */
function maglione(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0, discount_amount: 0, delivery_fee_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0, pickup_in_store: false,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
    // Le relazioni che la pagina legge insieme all'ordine.
    seller: { store_name: 'Maglieria Rossi', store_logo: null, store_phone: null, store_address: null, store_lat: null, store_lng: null },
    rider: null,
    order_items: [{ id: 'i1', quantity: 1, unit_price: 40, product_id: null, product_name: 'Maglione', product_image: null, products: null }],
    ...extra,
  };
}

/** 50 € lordi: 20 pagati col credito MyCity, 30 in contanti incassati. */
const misto = () => maglione({
  total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500,
  order_items: [{ id: 'i1', quantity: 1, unit_price: 50, product_id: null, product_name: 'Cappotto', product_image: null, products: null }],
});

function apri(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    returns: [],
    order_items: [],
    disputes: [{ id: 'd1', status: 'open', order_id: ORDINE, opener_id: 'giulia', against_id: 'negozio' }],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
    notifications: [],
  });
}

async function resoRimborsato(centesimi: number) {
  finto.utente = 'giulia';
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'CHANGED_MIND' })),
    undefined,
  );
  expect(aperto.status).toBe(201);
  const id = (await aperto.json()).id as string;
  finto.utente = 'negozio';
  const deciso = await (decidi as unknown as Rotta)(
    new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: centesimi })),
    { params: Promise.resolve({ id }) },
  );
  expect(deciso.status, JSON.stringify(await deciso.clone().json())).toBe(200);
  return id;
}

async function reclamoChiuso(centesimi: number) {
  const res = await (risolvi as unknown as Rotta)(
    new Request('http://localhost/x', json({ status: 'resolved_buyer', notes: 'Merce arrivata rovinata, rimborsiamo.', refundCents: centesimi })),
    { params: Promise.resolve({ id: 'd1' }) },
  );
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
}

// ── La pagina vera, montata ────────────────────────────────────────────────────────────────────

let Pagina: ComponentType<Record<string, unknown>>;

beforeAll(async () => {
  Pagina = (await monta('app/orders/[id]/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 60000);

/** Le chiamate di rete che la pagina fa da sola. */
const chiamate: string[] = [];
/** Le letture che la pagina ha chiesto (chiave della domanda), e le risposte già arrivate. */
const risposte = new Map<string, unknown>();

beforeEach(() => {
  chiamate.length = 0;
  risposte.clear();
  vi.stubGlobal('fetch', async (url: string) => {
    chiamate.push(String(url));
    return new Response('{}', { status: 200 });
  });
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__DATI_QUERY__;
  delete g.__RISPOSTA_SUPABASE__;
  vi.unstubAllGlobals();
});

/** Le colonne semplici di una `select` di PostgREST (le relazioni fra parentesi si tengono a parte). */
function colonneChieste(select: string): string[] {
  let piatta = select;
  while (/\([^()]*\)/.test(piatta)) piatta = piatta.replace(/\([^()]*\)/g, '');
  return piatta.split(',').map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c));
}

/**
 * Quello che il cliente legge sulla pagina dell'ordine.
 *
 * Il react-query finto risponde col dato che c'è; qui si fa il suo mestiere: si monta la pagina, si
 * eseguono le letture ABILITATE che ha chiesto (con la loro funzione vera), e si rimonta finché non
 * ne chiede di nuove. Il database risponde come PostgREST: solo le colonne nominate nella `select`.
 */
async function cosaLeggeIlCliente(ordine: Riga): Promise<string> {
  const g = globalThis as Record<string, unknown>;
  g.__RISPOSTA_SUPABASE__ = ({ tavola, colonne }: { tavola: string; colonne: string }) => {
    if (tavola !== 'orders') return { data: null, error: null };
    const solo = Object.fromEntries(colonneChieste(colonne).map((c) => [c, ordine[c] ?? null]));
    return { data: { ...solo, seller: ordine.seller, rider: ordine.rider, order_items: ordine.order_items }, error: null };
  };
  for (let giro = 0; giro < 4; giro++) {
    const daLeggere: Array<{ chiave: string; leggi: () => Promise<unknown> }> = [];
    g.__DATI_QUERY__ = (o: { queryKey: unknown[]; queryFn?: () => Promise<unknown>; enabled?: boolean }) => {
      const chiave = JSON.stringify(o.queryKey);
      if (o.enabled !== false && o.queryFn && !risposte.has(chiave)) daLeggere.push({ chiave, leggi: o.queryFn });
      return risposte.get(chiave);
    };
    const s = accendi(Pagina, { params: { id: ORDINE } });
    await attendi();
    s.smonta();
    if (daLeggere.length === 0) break;
    for (const d of daLeggere) if (!risposte.has(d.chiave)) risposte.set(d.chiave, await d.leggi());
  }
  const s = accendi(Pagina, { params: { id: ORDINE } });
  await attendi();
  const testo = testoVisibile(s.radice);
  s.smonta();
  expect(testo, 'la pagina non ha mostrato il riepilogo: la prova non sta guardando niente').toContain('Totale');
  return testo;
}

const ordine = () => finto.db.tabelle.orders[0];

describe('dopo le rotte vere: la pagina dice il bonifico, con la cifra dei contanti', () => {
  beforeEach(() => apri(maglione()));

  it('IL CASO CHE ROMPEVA — reso approvato: «bonifico», mai «Ordine rimborsato» né «arrivato»', async () => {
    await resoRimborsato(4000);
    expect(ordine().payment_status).toBe('REFUNDED');

    const testo = await cosaLeggeIlCliente(ordine());

    expect(testo).toContain('Rimborso di 40,00 € con un bonifico, che facciamo a mano.');
    expect(testo).toContain("L'IBAN e il nome dell'intestatario del conto te li chiediamo per email");
    expect(testo, 'la pagina dice «rimborsato» prima che parta il bonifico').not.toMatch(/Ordine rimborsato/u);
    expect(testo).not.toMatch(/arrivat/u);
    expect(testo).not.toMatch(/Paghi/u);
  }, 60000);

  it('reclamo chiuso per 24 € su 40: il bonifico dice 24,00 €, e la pagina non chiede di pagare 40,00 €', async () => {
    await reclamoChiuso(2400);
    expect(ordine().payment_status).toBe('PARTIALLY_REFUNDED');

    const testo = await cosaLeggeIlCliente(ordine());

    expect(testo).toContain('Rimborso di 24,00 € con un bonifico');
    expect(testo, 'su un ordine consegnato e pagato la pagina chiede di pagare di nuovo').not.toMatch(/Paghi/u);
  }, 60000);

  it('ordine misto (20 € di credito, 30 in contanti) rimborsato per intero: il bonifico è di 30,00 €, non 50,00 €', async () => {
    apri(misto());
    await resoRimborsato(5000);

    const testo = await cosaLeggeIlCliente(ordine());

    expect(testo).toContain('Rimborso di 30,00 € con un bonifico');
    expect(testo).not.toContain('Rimborso di 50,00 €');
  }, 60000);

  it('la carta non passa di qui: rimborso sulla carta, «Ordine rimborsato», nessun bonifico', async () => {
    apri(maglione({ payment_method: 'card', stripe_payment_intent: 'pi_1', cash_confirmed_at: null }));
    await resoRimborsato(4000);

    const testo = await cosaLeggeIlCliente(ordine());

    expect(testo).toContain('Ordine rimborsato.');
    expect(testo).not.toMatch(/bonifico/u);
  }, 60000);

  it('la pagina non chiede niente al server oltre all ordine: nessuna rotta del bonifico', async () => {
    await resoRimborsato(4000);
    await cosaLeggeIlCliente(ordine());
    expect(chiamate.filter((u) => u.includes('/api/')), 'la pagina chiama il server per sapere del bonifico').toEqual([]);
  }, 60000);
});

describe('sui contanti, «Paghi al rider» solo se l ordine aspetta ancora i soldi', () => {
  it('IL CASO CHE ROMPEVA — ordine annullato: niente «Paghi 40,00 € in contanti»', async () => {
    // Annullando, lib/ordini/annulla.ts scrive CANCELED e porta un pagamento PENDING a FAILED.
    for (const payment_status of ['PENDING', 'FAILED']) {
      const testo = await cosaLeggeIlCliente(maglione({ delivery_status: 'CANCELED', payment_status, cash_confirmed_at: null }));
      expect(testo, `annullato con pagamento ${payment_status}`).not.toMatch(/Paghi/u);
      expect(testo).not.toMatch(/bonifico/u);
    }
  }, 60000);

  it('IL CASO CHE ROMPEVA — consegnato e rimborsato in parte senza bonifico: niente «Paghi 40,00 €»', async () => {
    const testo = await cosaLeggeIlCliente(maglione({ payment_status: 'PARTIALLY_REFUNDED' }));
    expect(testo).not.toMatch(/Paghi/u);
  }, 60000);

  it('consegnato con l incasso non ancora registrato: niente «Paghi», la merce è già arrivata', async () => {
    const testo = await cosaLeggeIlCliente(maglione({ payment_status: 'PENDING', cash_confirmed_at: null }));
    expect(testo).not.toMatch(/Paghi/u);
  }, 60000);

  it('rimborsato senza nessun segno di bonifico: la pagina non dice niente sul rimborso', async () => {
    const testo = await cosaLeggeIlCliente(maglione({ payment_status: 'REFUNDED', stripe_refund_id: 'wallet:return_x' }));
    expect(testo).not.toMatch(/Ordine rimborsato|bonifico|Paghi/u);
  }, 60000);

  it('in consegna e non ancora pagato: «Paghi 40,00 € in contanti al rider» c è', async () => {
    const testo = await cosaLeggeIlCliente(maglione({
      delivery_status: 'OUT_FOR_DELIVERY', delivered_at: null, payment_status: 'PENDING', cash_confirmed_at: null,
    }));
    expect(testo).toContain('Paghi 40,00 € in contanti al rider alla consegna.');
  }, 60000);

  it('due resi in contanti sullo stesso ordine: la cifra è la somma dei due bonifici', async () => {
    const testo = await cosaLeggeIlCliente(maglione({
      payment_status: 'PARTIALLY_REFUNDED',
      stripe_refund_id: 'bonifico:1000:return_aaaa,re_vecchio,bonifico:1500:return_bbbb',
    }));
    expect(testo).toContain('Rimborso di 25,00 € con un bonifico');
  }, 60000);
});
