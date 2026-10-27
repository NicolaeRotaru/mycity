/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ComponentType } from 'react';
import { PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';
import { formatPrice } from '@/lib/format';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

/**
 * 27/10/2026 (quinto giro della fase 2) — LE PAGINE VERE DELL'ORDINE, MONTATE.
 *
 * Il riesame del 27/10 sera l'ha visto sul ramo d'integrazione (a4f4161c): ogni ordine a domicilio
 * mostrava «Subtotale 20,00 € · Spedizione GRATUITA · Consegna MyCity 3,00 € · Totale 23,00 €»,
 * sulla pagina del cliente e su quella del negozio. Le prove di prima rileggevano le righe
 * chiamando a mano la funzione del riepilogo, e cercavano le parole nel sorgente: una riga
 * «gratuita» scritta dentro la pagina, o la pagina che passa al riepilogo i dati sbagliati,
 * restavano verdi.
 *
 * Qui l'ordine nasce dal conto VERO della cassa (prezziDelCarrello), con le colonne che scrive la
 * rotta dei contanti; poi si montano le due pagine vere e si legge il riquadro del riepilogo, tutto
 * intero, come lo vede chi ha appena pagato. Deve dire il testo riletto, e non regalare niente.
 */

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
const NEGOZIO = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FORNO = { lat: 45.0526, lng: 9.6929 };
const CASA = { lat: 45.06, lng: 9.7 };
const euro = (centesimi: number) => formatPrice(centesimi / 100);
const TRE_EURO = euro(PLATFORM_DELIVERY_FEE_CENTS);
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

/** Il riquadro che contiene «Subtotale» e «Totale»: le voci, e qualunque cosa ci finisca in mezzo. */
function riquadroDelRiepilogo(radice: HTMLElement): HTMLElement {
  const subtotale = Array.from(radice.querySelectorAll('span')).find((s) => (s.textContent ?? '').trim() === 'Subtotale');
  expect(subtotale, 'la pagina non ha mostrato il riepilogo: la prova non guarda niente').toBeTruthy();
  let el: HTMLElement | null = subtotale!.parentElement;
  while (el && !/(^|\s)Totale(\s|$)/.test(testoVisibile(el))) el = el.parentElement;
  expect(el, 'il riepilogo non ha la riga del Totale').toBeTruthy();
  return el!;
}

/** Monta la pagina, esegue le letture che chiede (con la queryFn vera), rimonta: il riquadro letto. */
async function leggiIlRiepilogo(Pagina: unknown, ordine: Riga): Promise<string> {
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
  const testo = piano(testoVisibile(riquadroDelRiepilogo(s.radice)));
  s.smonta();
  return testo;
}

let Cliente: ComponentType<Record<string, unknown>>;
let Negozio: ComponentType<Record<string, unknown>>;
beforeAll(async () => {
  Cliente = (await monta('app/orders/[id]/page.tsx')).default as ComponentType<Record<string, unknown>>;
  Negozio = (await monta('app/seller/orders/[id]/page.tsx')).default as ComponentType<Record<string, unknown>>;
}, 120000);

const CASI: Array<[string, number, Pagamento]> = [
  ['20 € in contanti (sotto la vecchia soglia dei 30)', 2000, 'cod'],
  ['35 € in contanti (sopra la vecchia soglia dei 30)', 3500, 'cod'],
  ['20 € con la carta', 2000, 'card'],
];

describe('le pagine vere dell’ordine non regalano la consegna da 3 euro che il cliente ha pagato', () => {
  for (const [nome, cent, pagamento] of CASI) {
    it(`IL CASO DEL RIESAME — cliente · ${nome}: «${VOCE_CONSEGNA} ${TRE_EURO}», niente «Spedizione GRATUITA»`, async () => {
      const ordine = ordineDallaCassa(cent, pagamento);
      expect(ordine.delivery_fee_cents, 'la cassa non ha messo la consegna: la prova non misura niente').toBe(PLATFORM_DELIVERY_FEE_CENTS);
      const testo = await leggiIlRiepilogo(Cliente, ordine);
      expect(testo, `la pagina del cliente regala la consegna: ${testo}`).not.toMatch(REGALO);
      expect(testo, 'il riepilogo del cliente è cambiato: rileggilo contro la cassa').toBe(
        piano(`Subtotale ${euro(cent)} ${VOCE_CONSEGNA} ${TRE_EURO} Totale ${euro(cent + PLATFORM_DELIVERY_FEE_CENTS)}`),
      );
    }, 60000);

    it(`IL CASO DEL RIESAME — negozio · ${nome}: «${VOCE_CONSEGNA} ${TRE_EURO}», niente «Spedizione GRATUITA»`, async () => {
      const ordine = ordineDallaCassa(cent, pagamento);
      const testo = await leggiIlRiepilogo(Negozio, ordine);
      expect(testo, `la pagina del negozio regala la consegna: ${testo}`).not.toMatch(REGALO);
      const comeSiPaga = pagamento === 'cod' ? 'Contanti alla consegna' : 'Carta (online)';
      expect(testo, 'il riepilogo del negozio è cambiato: rileggilo contro la cassa').toBe(
        piano(
          `Subtotale ${euro(cent)} ${VOCE_CONSEGNA} ${TRE_EURO} Pagamento ${comeSiPaga} ` +
            `Totale ${euro(cent + PLATFORM_DELIVERY_FEE_CENTS)}`,
        ),
      );
    }, 60000);
  }
});
