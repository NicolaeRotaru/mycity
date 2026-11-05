/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * Sessione S02 (5/11/2026) — la pagina vera dell'ordine del cliente, montata (banco copiato da
 * la-pagina-vera-dell-ordine-non-regala-la-consegna-da-3-euro).
 *  · 355:  con l'ordine NEW il titolo non dice «Ordine confermato!»;
 *  · 2279: con una fascia programmata la riga piccola non promette «pronto entro ~30 min»;
 *  · 1731: il riepilogo dice la variante comprata;
 *  · 661:  c'è una regione live con lo stato dell'ordine;
 *  · 2069: la pagina INTERA (non solo il riquadro del riepilogo) non regala la consegna;
 *  · 1724, 431: lettura del sorgente (il banco non sa simulare un errore di React Query).
 */
const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const NEGOZIO = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FORNO = { lat: 45.0526, lng: 9.6929 };
const CASA = { lat: 45.06, lng: 9.7 };
/** Le parole con cui un riepilogo può regalare una consegna che invece si paga. */
const REGALO = /gratis|gratuit|omaggi|offert|regal|in dono|a costo zero|inclus/i;
/** Gli spazi come li legge una persona: quelli dentro le cifre (non separabili) contano uno. */
const piano = (t: string) => t.replace(/\s+/g, ' ').trim();

type Riga = Record<string, unknown>;
type Pagamento = 'cod' | 'card';

/** La riga d'ordine come la scrive la rotta dei contanti, coi numeri del conto vero della cassa. */
function ordineDallaCassa(subtotalCents: number, pagamento: Pagamento): Riga {
  const p = prezziDelCarrello({
    gruppi: [{ sellerId: NEGOZIO, subtotalCents }],
    coordinateNegozio: () => FORNO,
    consegnaLat: CASA.lat,
    consegnaLng: CASA.lng,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    consegnaVeloce: false,
  });
  const g = p.gruppi[0];
  return {
    id: ORDINE, user_id: 'maria', seller_id: NEGOZIO,
    total_price: g.totalCents / 100,
    shipping_cost: g.shippingCents / 100,
    delivery_fee_cents: g.deliveryFeeCents,
    discount_amount: (g.couponPortionCents + g.pickupPortionCents) / 100,
    wallet_applied_cents: 0,
    pickup_in_store: false,
    payment_method: pagamento,
    payment_status: pagamento === 'card' ? 'PAID' : 'PENDING',
    delivery_status: 'NEW', stripe_refund_id: null,
    created_at: new Date().toISOString(), accepted_at: null, ready_at: null, picked_up_at: null,
    delivered_at: null, canceled_at: null,
    delivery_full_name: 'Maria Rossi', delivery_phone: '3331234567', delivery_address: 'Via Verdi 10',
    delivery_city: 'Piacenza', delivery_zip: '29121', delivery_notes: null,
    delivery_lat: CASA.lat, delivery_lng: CASA.lng, rider_lat: null, rider_lng: null, rider_position_updated_at: null,
    rider_id: null,
    seller: { store_name: 'Pane Quotidiano', store_logo: null, store_phone: null, store_address: null, store_lat: FORNO.lat, store_lng: FORNO.lng },
    rider: null,
    order_items: [{ id: 'i1', quantity: 1, unit_price: subtotalCents / 100, product_id: null, product_name: 'Spesa', product_image: null, products: null }],
  };
}

/** Le colonne che la pagina chiede davvero (via le tavole collegate fra parentesi). */
function colonneChieste(select: string): string[] {
  let piatta = select;
  while (/\([^()]*\)/.test(piatta)) piatta = piatta.replace(/\([^()]*\)/g, '');
  return piatta.split(',').map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c));
}

const risposte = new Map<string, unknown>();
beforeEach(() => {
  risposte.clear();
  vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
});
afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.__DATI_QUERY__;
  delete g.__RISPOSTA_SUPABASE__;
  vi.unstubAllGlobals();
});

/** Monta la pagina, esegue le letture che chiede (con la queryFn vera), rimonta: il riquadro letto. */
async function testoDellaPagina(Pagina: unknown, ordine: Riga): Promise<{ tutto: string; radice: HTMLElement; smonta: () => void }> {
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
    for (const d of daLeggere) if (!risposte.has(d.chiave)) risposte.set(d.chiave, await d.leggi().catch(() => null));
  }
  const s = accendi(Pagina, { params: { id: ORDINE } });
  await attendi();
  return { tutto: piano(s.radice.textContent ?? ''), radice: s.radice, smonta: s.smonta };
}

let Cliente: ComponentType<Record<string, unknown>>;
beforeAll(async () => {
  Cliente = (await monta('app/orders/[id]/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 120000);

describe('la pagina dell ordine del cliente', () => {
  it('355 · ordine NEW: «Ordine inviato al negozio», non «Ordine confermato!»', async () => {
    const p = await testoDellaPagina(Cliente, ordineDallaCassa(2000, 'cod'));
    expect(p.radice.querySelector('h1')?.textContent).toContain('Ordine inviato al negozio');
    expect(p.tutto).not.toContain('Ordine confermato');
    p.smonta();
  });

  it('2279 · accettato per «Domani · 9:00–12:00»: niente «pronto entro ~30 min»', async () => {
    const o = { ...ordineDallaCassa(2000, 'cod'), delivery_status: 'ACCEPTED', accepted_at: new Date().toISOString(), delivery_slot: 'Domani · 9:00–12:00' };
    const p = await testoDellaPagina(Cliente, o);
    expect(p.tutto).not.toContain('pronto entro ~30 min');
    expect(p.tutto).toContain('per la tua fascia');
    // 2178 · in cima, con una fascia per domani, non «30-60 min dalla conferma» ma la fascia.
    expect(p.tutto).not.toContain('30-60 min');
    expect(p.tutto).toMatch(/9:00–12:00/);
    p.smonta();
  });

  it('2279 · pronto per una fascia programmata: niente «in consegna a breve»', async () => {
    const o = { ...ordineDallaCassa(2000, 'cod'), delivery_status: 'READY', accepted_at: new Date().toISOString(), ready_at: new Date().toISOString(), delivery_slot: 'Domani · 9:00–12:00' };
    const p = await testoDellaPagina(Cliente, o);
    expect(p.tutto).not.toContain('in consegna a breve');
    p.smonta();
  });

  it('1731 · il riepilogo dice la variante comprata', async () => {
    const o = ordineDallaCassa(2000, 'cod');
    o.order_items = [{ id: 'i1', quantity: 1, unit_price: 20, product_id: 'p1', product_name: 'Torta della nonna', product_image: null, variant_id: 'v1', variant_label: 'grande', products: null }];
    const p = await testoDellaPagina(Cliente, o);
    expect(p.tutto).toContain('grande');
    p.smonta();
  });

  it('661 · una regione live dice lo stato dell ordine', async () => {
    const p = await testoDellaPagina(Cliente, ordineDallaCassa(2000, 'cod'));
    const live = p.radice.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toContain("Stato dell'ordine");
    p.smonta();
  });

  it('2069 · la pagina intera, anche fuori dal riepilogo, non regala la consegna', async () => {
    for (const pagamento of ['cod', 'card'] as const) {
      for (const sub of [2000, 3500, 6000]) {
        const p = await testoDellaPagina(Cliente, ordineDallaCassa(sub, pagamento));
        expect(p.tutto, `${pagamento} ${sub}`).not.toMatch(REGALO);
        p.smonta();
      }
    }
  });
});

describe('1724 · 431 · gli errori di lettura non svuotano la pagina', () => {
  it('l errore di rilettura con l ordine a schermo non sostituisce la pagina; il codice che non si legge si dice', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('app/orders/[id]/page.tsx', 'utf8');
    expect(src).toContain('if (isError && !order) {');
    expect(src).not.toMatch(/if \(isError\) \{\s*return \(/);
    expect(src).toMatch(/order_delivery_codes[\s\S]{0,200}if \(error\) throw error;/);
    expect(src).toContain('Non riesco a mostrarti il codice di consegna');
  });
});

describe('848 · nel territorio degli ordini e del fattorino niente ombre nere della scala Tailwind', () => {
  it('solo i token del sistema (shadow-warm*, shadow-card, shadow-sm-neutral)', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const file: string[] = [];
    const giro = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) giro(p);
        else if (p.endsWith('.tsx')) file.push(p);
      }
    };
    for (const d of ['app/orders', 'app/rider', 'components/rider', 'components/orders']) giro(d);
    const neri = file.flatMap((f) =>
      (readFileSync(f, 'utf8').match(/(?<![\w-])shadow(?:-sm|-md|-lg|-xl|-2xl)?(?=[\s"'`])/g) ?? []).map((m) => `${f}: ${m}`),
    );
    expect(neri).toEqual([]);
  });
});
