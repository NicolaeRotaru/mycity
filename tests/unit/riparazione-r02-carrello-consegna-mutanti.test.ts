/**
 * @vitest-environment jsdom
 */
/**
 * R02-018 — Buco nelle prove del carrello: due mutanti sul conto della consegna di
 * app/cart/page.tsx restavano verdi contro tutte le prove che montano il carrello (rifatte a mano):
 *  · `consegnaVeloce: false` → `true` nel conto del carrello: con TUTTI i negozi a 10 € o più la
 *    consegna a video saliva da 3 a 4 € (e compariva la voce «consegna veloce»); le prove esistenti
 *    mettevano sempre un negozio sotto i 10 €, dove la veloce è già compresa e il cambio non si vede;
 *  · `couponScontoCents: 0` → `100`: un negozio con la spesa fra 10,00 e 10,99 € cadeva sotto la
 *    soglia e pagava il supplemento della spesa piccola, senza nessun codice sconto.
 * La cura è la sola prova: nel carrello il conto resta quello della cassa sugli stessi ingressi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { avvisoSpesaPiccola, righeDellaConsegna, rigaDellaVeloceNelCarrello, VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';
import { formatPrice } from '@/lib/format';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { accendi } from './aiuti/schermo';

const stato = vi.hoisted(() => ({
  prezzi: {} as Record<string, number>,
  negozi: new Map<string, { id: string; store_lat: number | null; store_lng: number | null }>(),
  casa: null as null | { lat: number; lng: number },
  /** false = la spedizione vera del lancio (zero); true = una tariffa a distanza, per finta. */
  spedizioneADistanza: false,
  /** Gli indirizzi a cui la rete finta ha già risposto. */
  servite: [] as string[],
}));

// La spedizione a distanza, com'era prima del lancio: tariffa fissa senza coordinate, altrimenti
// 2,50 € più 1,20 € al chilometro. La usano carrello e cassa insieme (stesso modulo).
vi.mock('@/lib/shipping', async (originale) => {
  const vero = await originale<typeof import('@/lib/shipping')>();
  const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
    const r = (g: number) => (g * Math.PI) / 180;
    const dLat = r(bLat - aLat);
    const dLng = r(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  return {
    ...vero,
    shippingCentsFor: (o?: Parameters<typeof vero.shippingCentsFor>[0]) => {
      if (!stato.spedizioneADistanza) return vero.shippingCentsFor(o);
      if (!o || o.pickupInStore || o.freeShipping) return 0;
      if (o.storeLat == null || o.storeLng == null || o.deliveryLat == null || o.deliveryLng == null) return 490;
      return 250 + Math.round(120 * km(o.storeLat, o.storeLng, o.deliveryLat, o.deliveryLng));
    },
  };
});
vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => stato.negozi }));

// Come in riparazione-r10-carrello-conto-consegna: l'import pigro del database sfugge a vi.mock,
// nasce il client VERO su un indirizzo finto con una sessione nei cookie, e la rete finta risponde
// come PostgREST (prezzi, indirizzo di consegna).
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'chiave-finta';
const json = (dati: unknown) => new Response(JSON.stringify(dati), { status: 200, headers: { 'content-type': 'application/json' } });
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  stato.servite.push(url);
  if (url.includes('/api/consegna/veloce')) return json({ possibile: true });
  if (url.includes('/rest/v1/products')) return json(Object.entries(stato.prezzi).map(([id, price]) => ({ id, stock: 50, price })));
  if (url.includes('/rest/v1/user_addresses')) return json(stato.casa ? [stato.casa] : []);
  if (url.includes('/rest/v1/')) return json([]);
  return new Response('', { status: 503 });
}) as unknown as typeof fetch;

function sessioneNeiCookie() {
  const ora = Math.floor(Date.now() / 1000);
  const sessione = {
    access_token: 'gettone-finto', refresh_token: 'rinnovo-finto', token_type: 'bearer',
    expires_in: 3600 * 24 * 365, expires_at: ora + 3600 * 24 * 365,
    user: { id: 'cliente-1', aud: 'authenticated', role: 'authenticated', email: 'cliente@example.it', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  };
  document.cookie = `sb-supabase-auth-token=${encodeURIComponent(JSON.stringify(sessione))}; path=/`;
}

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  vi.useRealTimers();
  stato.prezzi = {};
  stato.negozi = new Map();
  stato.casa = null;
  stato.spedizioneADistanza = false;
  stato.servite = [];
});

/** `negozio` = venditore (null = articolo del formato vecchio, senza venditore). */
type Riga = { id: string; prezzo: number; pezzi?: number; negozio: string | null; nome?: string };

/**
 * La lettura del carrello è finita: la rete finta ha risposto all'ultima che fa (i prodotti con
 * `*`, per il recesso), e subito dopo il carrello mette a posto coordinate, indirizzo e scorte.
 */
const letturaFinita = () => stato.servite.some((u) => u.includes('/rest/v1/products') && /select=\*(&|$)/.test(u));

/**
 * Gira finché la lettura del carrello non è finita E `pronto` non dice di sì per tre giri di fila
 * (lo stato che si guarda è quello fermo, non uno di passaggio). Non conta i giri: sotto carico
 * le risposte arrivano tardi, e un numero fisso di giri le perdeva. Se in 8 secondi veri non ci
 * arriva, smette e le asserzioni dicono cosa manca.
 */
async function finoA(pronto: () => boolean) {
  const fine = performance.now() + 8_000;
  let fermi = 0;
  while (fermi < 3 && performance.now() < fine) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    fermi = letturaFinita() && pronto() ? fermi + 1 : 0;
  }
}

async function carrello(righe: Riga[], pronto: (c: Vista) => boolean) {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 30, 14, 0));
  for (const r of righe) stato.prezzi[r.id] = r.prezzo;
  sessioneNeiCookie();
  localStorage.setItem('cart', JSON.stringify(righe.map((r) => ({
    id: r.id, name: `Prodotto ${r.id}`, price: r.prezzo, quantity: r.pezzi ?? 1,
    ...(r.negozio ? { sellerId: r.negozio } : {}),
    storeName: r.nome ?? `Negozio ${r.negozio}`,
  }))));
  schermo = accendi(CartPage);
  const c = vista(schermo);
  await finoA(() => pronto(c));
  return c;
}

type Vista = ReturnType<typeof vista>;

function vista(s: NonNullable<typeof schermo>) {
  return {
    radice: s.radice,
    get testo() { return s.radice.textContent ?? ''; },
    /** Le cifre che si VEDONO accanto a un'etichetta (riepilogo e barra in fondo). */
    cifreAccantoA: (etichetta: string) =>
      [...s.radice.querySelectorAll('span, div')]
        .filter((el) => (el.textContent ?? '').trim() === etichetta)
        .map((el) => {
          const accanto = el.nextElementSibling;
          return ((accanto?.firstElementChild ?? accanto)?.textContent ?? '').trim();
        }),
    /** Le voci sotto la riga della consegna («Come è fatta la consegna»), se ci sono. */
    vociDellaConsegna: () =>
      [...(s.radice.querySelector('ul[aria-label="Come è fatta la consegna"]')?.querySelectorAll('li') ?? [])].map(
        (li) => (li.textContent ?? '').trim(),
      ),
  };
}

/** La cassa, sugli stessi ingressi che ha il carrello: stessi negozi, stesse coordinate, nessun codice. */
function laCassa(righe: Riga[]) {
  const negozi: string[] = [];
  const spesa = new Map<string, number>();
  for (const r of righe) {
    const k = r.negozio ?? `nome:${r.nome}`;
    if (!spesa.has(k)) negozi.push(k);
    spesa.set(k, (spesa.get(k) ?? 0) + Math.round(r.prezzo * 100) * (r.pezzi ?? 1));
  }
  const ingressi = {
    gruppi: negozi.map((k) => ({ sellerId: k, subtotalCents: spesa.get(k)! })),
    coordinateNegozio: (k: string) => ({ lat: stato.negozi.get(k)?.store_lat ?? null, lng: stato.negozi.get(k)?.store_lng ?? null }),
    consegnaLat: stato.casa?.lat ?? null,
    consegnaLng: stato.casa?.lng ?? null,
    pickupInStore: false,
    couponSpedizioneGratis: false,
    couponScontoCents: 0,
    consegnaVeloce: false,
  };
  return {
    riepilogo: riepilogoDaMostrare({ ...ingressi, usaCredito: false, creditoDisponibileCents: 0 }),
    voci: prezziDelCarrello(ingressi).consegna,
  };
}


describe('R02-018 — il conto della consegna nel carrello, coi negozi tutti da 10 € in su', () => {
  it('un negozio solo da 12 €: la consegna è quella della cassa (3 €), senza la voce «consegna veloce»', async () => {
    const righe: Riga[] = [{ id: 'p-pane', prezzo: 12, negozio: 'neg-a' }];
    const { riepilogo, voci } = laCassa(righe);
    const attese = righeDellaConsegna(voci);
    expect(voci.veloceCents, 'controprova: la cassa senza veloce non la conta').toBe(0);
    const consegna = formatPrice(riepilogo.totale - riepilogo.subtotale);
    const c = await carrello(righe, (v) => v.cifreAccantoA(VOCE_CONSEGNA)[0] === consegna && JSON.stringify(v.vociDellaConsegna()) === JSON.stringify(attese));
    expect(c.cifreAccantoA(VOCE_CONSEGNA), 'la consegna a video non è quella della cassa (veloce contata nel carrello)').toEqual([consegna]);
    expect(c.vociDellaConsegna()).toEqual(attese);
    expect(c.testo).not.toContain('consegna veloce:');
    // La riga della veloce (la rete finta dice «possibile») dice il supplemento della cassa, non «già compresa».
    const rigaVeloce = rigaDellaVeloceNelCarrello(true, voci.supplementoVeloceCents, voci.totaleCents)!;
    expect(voci.supplementoVeloceCents, 'controprova: con negozi da 10 € in su la veloce costa di più').toBeGreaterThan(0);
    expect(c.testo, 'la riga della veloce non dice il supplemento della cassa').toContain(rigaVeloce);
  });

  it('due negozi da 12 € e 15 €: due consegne come la cassa, la veloce non si somma', async () => {
    const righe: Riga[] = [
      { id: 'p-1', prezzo: 12, negozio: 'neg-a' },
      { id: 'p-2', prezzo: 15, negozio: 'neg-b' },
    ];
    const { riepilogo } = laCassa(righe);
    const consegna = formatPrice(riepilogo.totale - riepilogo.subtotale);
    const c = await carrello(righe, (v) => v.cifreAccantoA(VOCE_CONSEGNA)[0] === consegna);
    expect(c.cifreAccantoA(VOCE_CONSEGNA)).toEqual([consegna]);
    expect(c.cifreAccantoA('Totale'), 'il totale a video non è quello della cassa').toEqual([formatPrice(riepilogo.totale), formatPrice(riepilogo.totale)]);
  });

  it('un negozio da 10,50 € senza codice sconto: nessun supplemento da spesa piccola, né il riquadro «sotto i 10 €»', async () => {
    const righe: Riga[] = [{ id: 'p-pane', prezzo: 10.5, negozio: 'neg-a' }];
    const { riepilogo, voci } = laCassa(righe);
    expect(voci.spesaPiccolaCents, 'controprova: a 10,50 € la cassa non aggiunge niente').toBe(0);
    const consegna = formatPrice(riepilogo.totale - riepilogo.subtotale);
    const c = await carrello(righe, (v) => v.testo.includes('Prodotto p-pane') && v.cifreAccantoA(VOCE_CONSEGNA)[0] === consegna);
    expect(c.cifreAccantoA(VOCE_CONSEGNA), 'il carrello conta uno sconto che nessuno ha chiesto').toEqual([consegna]);
    expect(c.testo).not.toContain(avvisoSpesaPiccola(1050) ?? 'xx-nessun-avviso');
    expect(c.testo).not.toContain('Spesa sotto i');
  });
});
