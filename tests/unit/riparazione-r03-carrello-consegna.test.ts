/**
 * @vitest-environment jsdom
 */
/**
 * R03-018 — Buco nelle prove del carrello: alcune mutanti sul conto della consegna di
 * app/cart/page.tsx restavano verdi anche dopo R10-025. Rifatte a mano il 20/11 contro tutte le
 * prove che montano il carrello, sopravvivevano:
 *  · la spedizione tolta dalla consegna da pagare (o contata due volte);
 *  · latitudine e longitudine del negozio scambiate nel conto;
 *  · il conto che cerca le coordinate del negozio col nome invece che col venditore;
 *  · le voci «come è fatta la consegna» nascoste a spedizione zero, o mostrate quando non sommano;
 *  · l'avviso «spesa sotto i 10 €» sotto il negozio sbagliato;
 *  · la spesa ripetuta accanto al nome con un negozio solo;
 *  · la frase della consegna unica col numero di negozi sbagliato;
 *  · gli articoli vecchi senza venditore fusi in una consegna sola.
 * Le prime tre erano «equivalenti» solo perché al lancio la spedizione a distanza vale zero
 * (lib/shipping.ts): il carrello promette che, il giorno che torna, carrello e cassa dicono lo
 * stesso numero senza toccarlo. Qui la spedizione si accende per finta (una tariffa a distanza,
 * nello stesso modulo che usa la cassa) e il carrello montato deve scrivere il conto della cassa
 * (`riepilogoDaMostrare`) sugli stessi ingressi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import CartPage from '@/app/cart/page';
import { avvisoSpesaPiccola, fraseGiroUnico, righeDellaConsegna, VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';
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

/** L'ultima cifra della riga: «· spesa sotto i 10,00 € in 1 negozio: 1,00 €» → 100. */
function centesimi(testo: string): number {
  const m = [...testo.matchAll(/(\d{1,3}(?:\.\d{3})*),(\d{2})\s*€/g)].at(-1);
  if (!m) throw new Error(`nessuna cifra in «${testo}»`);
  return Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]);
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

const PIAZZA_CAVALLI = { lat: 45.0526, lng: 9.6929 };
const BARRIERA_GENOVA = { lat: 45.0437, lng: 9.6837 };
const VIA_EMILIA = { lat: 45.0441, lng: 9.7046 };

describe('R03-018 — il conto della consegna nel carrello, coi casi che le prove non guardavano ancora', () => {
  it('con la spedizione a distanza, consegna e totale a video sono quelli della cassa, e le voci sommano', async () => {
    stato.spedizioneADistanza = true;
    stato.negozi = new Map([
      ['neg-a', { id: 'neg-a', store_lat: PIAZZA_CAVALLI.lat, store_lng: PIAZZA_CAVALLI.lng }],
      ['neg-b', { id: 'neg-b', store_lat: BARRIERA_GENOVA.lat, store_lng: BARRIERA_GENOVA.lng }],
    ]);
    stato.casa = VIA_EMILIA;
    const righe: Riga[] = [
      { id: 'p-pane', prezzo: 12, negozio: 'neg-a' },
      { id: 'p-frutta', prezzo: 2.5, pezzi: 3, negozio: 'neg-b' },
    ];
    const { riepilogo } = laCassa(righe);
    const consegna = riepilogo.totale - riepilogo.subtotale;
    // Si aspetta l'arrivo delle coordinate (negozi e casa): finché mancano, la consegna è quella senza distanza.
    const c = await carrello(righe, (v) => v.cifreAccantoA(VOCE_CONSEGNA)[0] === formatPrice(consegna));
    expect(riepilogo.spedizione, 'controprova: la spedizione finta deve valere qualcosa').toBeGreaterThan(0);
    expect(c.testo, 'controprova: il carrello si deve disegnare').toContain('Prodotto p-frutta');
    expect(c.cifreAccantoA(VOCE_CONSEGNA), 'la consegna a video non è quella della cassa (spedizione tolta, doppia, o calcolata su altre coordinate)')
      .toEqual([formatPrice(consegna)]);
    expect(c.cifreAccantoA('Totale'), 'il totale a video non è quello della cassa').toEqual([formatPrice(riepilogo.totale), formatPrice(riepilogo.totale)]);
    // Le voci sotto la riga della consegna, se ci sono, devono tornare con la riga: chi le somma
    // trova la cifra scritta sopra.
    const voci = c.vociDellaConsegna();
    if (voci.length > 0) {
      expect(voci.reduce((s, v) => s + centesimi(v), 0), 'le voci della consegna non sommano alla riga').toBe(Math.round(consegna * 100));
    }
  });

  it('al lancio (spedizione zero) la consegna si spiega voce per voce sotto la riga, e le voci sommano', async () => {
    const righe: Riga[] = [
      { id: 'p-pane', prezzo: 12, negozio: 'neg-a' },
      { id: 'p-frutta', prezzo: 2.5, pezzi: 3, negozio: 'neg-b' },
    ];
    const { riepilogo, voci } = laCassa(righe);
    const attese = righeDellaConsegna(voci);
    const c = await carrello(righe, (v) => JSON.stringify(v.vociDellaConsegna()) === JSON.stringify(attese));
    expect(riepilogo.spedizione).toBe(0);
    expect(attese.length, 'controprova: base, negozio in più e spesa piccola').toBe(3);
    expect(c.vociDellaConsegna(), 'le voci della consegna non si vedono').toEqual(attese);
    expect(c.vociDellaConsegna().reduce((s, v) => s + centesimi(v), 0)).toBe(centesimi(c.cifreAccantoA(VOCE_CONSEGNA)[0]));
  });

  it('l’avviso «spesa sotto i 10 €» sta nel riquadro del negozio piccolo, non in quello dell’altro', async () => {
    const giusto = avvisoSpesaPiccola(115)!;
    const c = await carrello(
      [
        { id: 'p-grande', prezzo: 12, negozio: 'neg-a' },
        { id: 'p-piccolo', prezzo: 1.15, negozio: 'neg-b' },
      ],
      (v) => [...v.radice.querySelectorAll('p')].some((p) => (p.textContent ?? '').trim() === giusto),
    );
    const avvisi = [...c.radice.querySelectorAll('p')].filter((p) => (p.textContent ?? '').trim() === giusto);
    expect(avvisi.length, 'l’avviso del negozio piccolo manca').toBe(1);
    const riquadro = avvisi[0].parentElement?.textContent ?? '';
    expect(riquadro, 'l’avviso non sta sotto il negozio piccolo').toContain('Negozio neg-b');
    expect(riquadro, 'l’avviso sta sotto il negozio grande').not.toContain('Negozio neg-a');
    expect(riquadro).toContain('Prodotto p-piccolo');
  });

  it('con un negozio solo, accanto al nome non si ripete la spesa', async () => {
    const c = await carrello(
      [{ id: 'p-pane', prezzo: 12, negozio: 'neg-a' }],
      (v) => v.testo.includes('Prodotto p-pane') && v.cifreAccantoA(VOCE_CONSEGNA).length > 0,
    );
    expect(c.testo).toContain('Negozio neg-a');
    expect(c.testo, 'con un negozio solo la spesa compare accanto al nome').not.toContain('Negozio neg-a · ');
  });

  it('con tre negozi, la frase della consegna unica dice tre negozi', async () => {
    const c = await carrello(
      [
        { id: 'p-1', prezzo: 12, negozio: 'neg-a' },
        { id: 'p-2', prezzo: 13, negozio: 'neg-b' },
        { id: 'p-3', prezzo: 14, negozio: 'neg-c' },
      ],
      (v) => v.testo.includes(fraseGiroUnico(3)),
    );
    expect(c.testo).toContain(fraseGiroUnico(3));
  });

  it('articoli del formato vecchio, senza venditore, di due negozi diversi: due consegne, non una', async () => {
    const righe: Riga[] = [
      { id: 'p-1', prezzo: 2, negozio: null, nome: 'Forno Rossi' },
      { id: 'p-2', prezzo: 3, negozio: null, nome: 'Frutta Bianchi' },
    ];
    const { riepilogo } = laCassa(righe);
    const consegna = formatPrice(riepilogo.totale - riepilogo.subtotale);
    const c = await carrello(
      righe,
      (v) => v.testo.includes(avvisoSpesaPiccola(200)!) && v.testo.includes(avvisoSpesaPiccola(300)!) && v.cifreAccantoA(VOCE_CONSEGNA)[0] === consegna,
    );
    expect(c.testo, 'i due negozi senza venditore sono stati fusi in uno').toContain(avvisoSpesaPiccola(200)!);
    expect(c.testo).toContain(avvisoSpesaPiccola(300)!);
    expect(c.cifreAccantoA(VOCE_CONSEGNA)).toEqual([consegna]);
  });
});
