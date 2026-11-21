/**
 * @vitest-environment jsdom
 */
/**
 * R01-010 — Buco nelle prove del carrello: togliere `Math.round(...)` dal subtotale di ogni negozio
 * (app/cart/page.tsx, `subtotalCents: Math.round(somma * 100)`) lasciava verdi tutte le prove che
 * montano il carrello. Non è equivalente: 0,10 € ×1 + 3,30 € ×3 vale 10,00 €, ma in virgola mobile
 * la somma fa 9,999999999999998 e per 100 dà 999,9999999999998 centesimi: UN CENTESIMO SOTTO la soglia
 * dei 10 € (`SPESA_SENZA_SUPPLEMENTO_CENTS`), e `prezziDelCarrello` aggiunge il supplemento della
 * spesa piccola (consegna a 4 € invece di 3 €). La cura è la sola prova.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { righeDellaConsegna, VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';
import { formatPrice } from '@/lib/format';
import { riepilogoDaMostrare } from '@/lib/ordini/riepilogo-cassa';
import { prezziDelCarrello } from '@/lib/ordini/prezzi';
import { SPESA_SENZA_SUPPLEMENTO_CENTS } from '@/lib/constants';
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


const PREZZO_A = 0.1;
const PREZZO_B = 3.3;
const righe: Riga[] = [
  { id: 'p-a', prezzo: PREZZO_A, pezzi: 1, negozio: 'neg-a' },
  { id: 'p-b', prezzo: PREZZO_B, pezzi: 3, negozio: 'neg-a' },
];

describe('R01-010 — il subtotale del negozio nel carrello è arrotondato al centesimo', () => {
  it('controprova: in virgola mobile la somma NON fa 1000 esatti (senza arrotondamento scatterebbe il supplemento)', () => {
    const grezzo = righe.reduce((s, r) => s + r.prezzo * (r.pezzi ?? 1), 0) * 100;
    expect(grezzo).not.toBe(1000);
    expect(grezzo).toBeLessThan(SPESA_SENZA_SUPPLEMENTO_CENTS);
    expect(SPESA_SENZA_SUPPLEMENTO_CENTS).toBe(1000);
    expect(Math.round(grezzo)).toBe(1000);
  });

  it('0,10 € + 3 × 3,30 € dallo stesso negozio = 10,00 €: consegna e totale sono quelli della libreria a 1000 centesimi', async () => {
    const ingressi = {
      gruppi: [{ sellerId: 'neg-a', subtotalCents: 1000 }],
      coordinateNegozio: () => ({ lat: null, lng: null }),
      consegnaLat: null,
      consegnaLng: null,
      pickupInStore: false,
      couponSpedizioneGratis: false,
      couponScontoCents: 0,
      consegnaVeloce: false,
    };
    const voci = prezziDelCarrello(ingressi).consegna;
    const riepilogo = riepilogoDaMostrare({ ...ingressi, usaCredito: false, creditoDisponibileCents: 0 });
    // A numeri fissi: a 10,00 € esatti non c'è supplemento, la consegna è la base di 3 €.
    expect(voci.spesaPiccolaCents, 'controprova: a 1000 centesimi la cassa non aggiunge la spesa piccola').toBe(0);
    expect(riepilogo.subtotale).toBe(10);
    expect(riepilogo.totale).toBe(13);
    const consegna = formatPrice(riepilogo.totale - riepilogo.subtotale);
    expect(consegna, 'a numeri fissi: 3,00 € di consegna').toBe(formatPrice(3));
    const attese = righeDellaConsegna(voci);

    const c = await carrello(righe, (v) => v.cifreAccantoA(VOCE_CONSEGNA)[0] === consegna && JSON.stringify(v.vociDellaConsegna()) === JSON.stringify(attese));
    expect(c.cifreAccantoA(VOCE_CONSEGNA), 'la consegna a video non è quella della libreria (subtotale non arrotondato?)').toEqual([consegna]);
    expect(c.vociDellaConsegna()).toEqual(attese);
    expect(c.cifreAccantoA('Totale'), 'il totale a video non è quello della cassa').toEqual([formatPrice(riepilogo.totale), formatPrice(riepilogo.totale)]);
    expect(c.testo).not.toContain('Spesa sotto i');
  });
});
