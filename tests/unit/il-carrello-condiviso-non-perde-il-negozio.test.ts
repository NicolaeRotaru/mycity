/**
 * @vitest-environment jsdom
 */

/**
 * 27/8/2026 (R088) — IL LINK CONDIVISO SU WHATSAPP FACEVA VEDERE UN TOTALE E PAGARE L'ALTRO.
 *
 * `/shared-cart` è la pagina dove atterra chi riceve una lista su WhatsApp: il canale del
 * passaparola. Leggeva i prodotti chiedendo `id, name, price, images, status, stock` e il nome del
 * negozio — ma NON `seller_id` e NON `has_variants` — e poi li metteva nel carrello senza attaccarci
 * il negozio. Da lì in poi tre cose andavano storte, e tutte e tre le pagava il cliente:
 *
 * ① Il carrello raggruppa per negozio con `it.sellerId ?? it.storeName ?? '__nostore__'`: senza
 *    negozio, prodotti di due negozi diversi finivano in UN gruppo solo. La consegna MyCity si
 *    conta per gruppo e la spedizione si calcola per gruppo, quindi il carrello prometteva un
 *    totale, e la cassa — che rilegge `seller_id` dal database per ogni articolo — ne chiedeva uno
 *    più alto. La differenza compariva all'ultimo passo, dove l'abbandono costa di più.
 * ② Un capo con le taglie entrava nel carrello senza taglia e sbatteva contro il muro «Scegli le
 *    opzioni» in cassa, senza che nulla spiegasse perché.
 * ③ `const { data } = await supabase…` non guardava mai l'errore: con la rete caduta la lista
 *    restava vuota e la pagina dichiarava che TUTTI i prodotti regalati non erano disponibili.
 *
 * Qui la pagina viene montata per davvero, il pulsante viene premuto per davvero, e i due totali —
 * quello del carrello e quello della cassa — vengono ricalcolati con le stesse funzioni che usano
 * le due pagine vere.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, clicca, attendi } from './aiuti/schermo';
import { getCart, type CartItem } from '@/lib/cart';
import { shippingForEuro } from '@/lib/shipping';
import { PLATFORM_DELIVERY_FEE_CENTS } from '@/lib/constants';

const globali = globalThis as Record<string, unknown>;

const PANE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const FIORI = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const MAGLIA = 'cccccccc-3333-4333-8333-cccccccccccc';

/** Due negozi diversi, come in una lista messa insieme per un regalo. */
const PRODOTTI = [
  {
    id: PANE, name: 'Focaccia', price: 10, images: null, status: 'available', stock: null,
    seller_id: 'venditore-pane', has_variants: false, profiles: { store_name: 'Pane Quotidiano' },
  },
  {
    id: FIORI, name: 'Mazzo di tulipani', price: 15, images: null, status: 'available', stock: null,
    seller_id: 'venditore-fiori', has_variants: false, profiles: { store_name: 'Fiori Belli' },
  },
];

/** Chi possiede davvero ogni prodotto: è quello che la cassa rilegge dal database. */
const NEGOZIO_VERO = new Map<string, string>([
  [PANE, 'venditore-pane'],
  [FIORI, 'venditore-fiori'],
  [MAGLIA, 'venditore-vestiti'],
]);

const sottoTotale = (righe: CartItem[]) => righe.reduce((s, r) => s + r.price * r.quantity, 0);

/**
 * Il conto di una pagina che raggruppa il carrello per negozio.
 *
 * È la matematica di `app/cart/page.tsx` e di `app/checkout/page.tsx`, ricopiata qui perché quei
 * due file appartengono a un altro lotto: la consegna MyCity si paga UNA VOLTA PER NEGOZIO e la
 * spedizione si calcola PER NEGOZIO, con la stessa `shippingForEuro` che usano le due pagine e le
 * due rotte che creano l'ordine. Cambia solo da dove viene il nome del negozio: il carrello lo
 * legge dalla riga (`sellerId`), la cassa lo rilegge dal database.
 */
function totale(righe: CartItem[], negozioDi: (r: CartItem) => string): number {
  const gruppi = new Map<string, CartItem[]>();
  for (const r of righe) {
    const chiave = negozioDi(r);
    if (!gruppi.has(chiave)) gruppi.set(chiave, []);
    gruppi.get(chiave)!.push(r);
  }
  const spedizione = Array.from(gruppi.values()).reduce(
    (s, g) => s + shippingForEuro({
      subtotal: sottoTotale(g), storeLat: null, storeLng: null,
      deliveryLat: null, deliveryLng: null, pickupInStore: false,
    }),
    0,
  );
  const consegna = gruppi.size * (PLATFORM_DELIVERY_FEE_CENTS / 100);
  return sottoTotale(righe) + spedizione + consegna;
}

/** Come lo raggruppa il carrello: col negozio scritto sulla riga, se c'è. */
const comeIlCarrello = (r: CartItem) => r.sellerId ?? r.storeName ?? '__nostore__';
/** Come lo raggruppa la cassa: col proprietario riletto dal database. */
const comeLaCassa = (r: CartItem) => NEGOZIO_VERO.get(r.id) ?? '__nostore__';

async function apriLaListaCondivisa(cart: string) {
  globali.__QUERY_FINTA__ = `cart=${cart}`;
  const mod = await monta('app/shared-cart/page.tsx');
  const s = accendi(mod.default, {});
  await attendi();
  await attendi();
  return s;
}

function pulsanteAggiungi(radice: HTMLElement) {
  return Array.from(radice.querySelectorAll('button')).find((b) =>
    /aggiungi tutto/i.test(b.textContent ?? ''),
  );
}

describe('la lista condivisa su WhatsApp', () => {
  beforeEach(() => {
    localStorage.clear();
    globali.__RISPOSTA_SUPABASE__ = () => ({ data: PRODOTTI, error: null });
  });

  afterEach(() => {
    globali.__RISPOSTA_SUPABASE__ = undefined;
    globali.__QUERY_FINTA__ = undefined;
    localStorage.clear();
  });

  it('IL CASO CHE HA GENERATO TUTTO: due negozi, e il carrello fa lo stesso conto della cassa', async () => {
    const s = await apriLaListaCondivisa(`${PANE}:2,${FIORI}:1`);
    const aggiungi = pulsanteAggiungi(s.radice);
    expect(aggiungi, 'Il pulsante che aggiunge la lista al carrello non c\'è più').toBeTruthy();
    s.agisci(() => clicca(aggiungi!));

    const carrello = getCart();
    expect(carrello.length, 'La lista condivisa non è finita nel carrello').toBe(2);

    const nelCarrello = totale(carrello, comeIlCarrello);
    const allaCassa = totale(carrello, comeLaCassa);
    expect(
      nelCarrello.toFixed(2),
      `Chi arriva dal link vede ${nelCarrello.toFixed(2)} € nel carrello e ne paga ${allaCassa.toFixed(2)} in cassa: `
      + 'il rincaro compare all\'ultimo passo, dove si abbandona di più',
    ).toBe(allaCassa.toFixed(2));
  }, 60000);

  it('ogni riga si porta dietro il suo negozio, con nome e tutto', async () => {
    const s = await apriLaListaCondivisa(`${PANE}:2,${FIORI}:1`);
    s.agisci(() => clicca(pulsanteAggiungi(s.radice)!));

    const carrello = getCart();
    const orfane = carrello.filter((r) => !r.sellerId);
    expect(
      orfane.map((r) => r.name),
      'Queste righe entrano nel carrello senza negozio: il carrello le mette tutte in un mucchio solo',
    ).toEqual([]);
    expect(
      carrello.map((r) => r.storeName).sort(),
      'Senza il nome del negozio il carrello scrive «Negozio» al posto di Pane Quotidiano',
    ).toEqual(['Fiori Belli', 'Pane Quotidiano']);
  }, 60000);

  it('un capo con le taglie non entra nel carrello senza taglia: manda alla sua scheda', async () => {
    globali.__RISPOSTA_SUPABASE__ = () => ({
      data: [
        PRODOTTI[0],
        {
          id: MAGLIA, name: 'Maglia di lana', price: 40, images: null, status: 'available',
          stock: null, seller_id: 'venditore-vestiti', has_variants: true,
          profiles: { store_name: 'Filo e Trama' },
        },
      ],
      error: null,
    });

    const s = await apriLaListaCondivisa(`${PANE}:1,${MAGLIA}:1`);
    s.agisci(() => clicca(pulsanteAggiungi(s.radice)!));

    const carrello = getCart();
    expect(
      carrello.map((r) => r.id),
      'La maglia entra nel carrello senza taglia e in cassa si trova il muro «Scegli le opzioni», senza capire perché',
    ).toEqual([PANE]);

    const rimando = Array.from(s.radice.querySelectorAll('a')).some((a) =>
      (a.getAttribute('href') ?? '').includes(`/product/${MAGLIA}`),
    );
    expect(rimando, 'Niente rimanda alla scheda della maglia: chi l\'ha ricevuta in regalo non sa dove sceglierla').toBe(true);
  }, 60000);

  it('se non è rimasto niente da aggiungere non dice «aggiunti» e non porta a un carrello vuoto', async () => {
    // R088 ④ — restava un buco: un prodotto in vendita ma finito (`stock: 0`) passava il controllo
    // sul pulsante, poi il ciclo lo saltava. La persona leggeva «0 articoli aggiunti al carrello» e
    // un secondo e mezzo dopo si ritrovava sul carrello vuoto, senza sapere cos'era successo.
    globali.__RISPOSTA_SUPABASE__ = () => ({
      data: [{ ...PRODOTTI[0], stock: 0 }],
      error: null,
    });

    const s = await apriLaListaCondivisa(`${PANE}:2`);
    const aggiungi = pulsanteAggiungi(s.radice);
    expect(aggiungi, 'Il pulsante non c\'è più: questa prova non misura più niente').toBeTruthy();
    s.agisci(() => clicca(aggiungi!));

    expect(getCart(), 'Niente è entrato nel carrello, ed è giusto: la merce è finita').toEqual([]);
    expect(
      s.radice.textContent ?? '',
      'La pagina si dichiara «Aggiunti!» dopo aver aggiunto zero articoli, e un attimo dopo scarica la persona su un carrello vuoto',
    ).not.toContain('Aggiunti!');
    s.smonta();
  }, 60000);

  it('con la lettura caduta non dichiara che i regali non sono disponibili', async () => {
    globali.__RISPOSTA_SUPABASE__ = () => ({ data: null, error: { message: 'rete caduta' } });

    const s = await apriLaListaCondivisa(`${PANE}:2,${FIORI}:1`);
    const aSchermo = s.radice.textContent ?? '';

    expect(
      aSchermo,
      'La rete cade e la pagina dichiara che i prodotti scelti per te non si possono più comprare',
    ).not.toContain('non disponibili');
    expect(
      aSchermo.toLowerCase(),
      'Nessuno dice che è la lettura a non essere riuscita: il regalo sembra svanito',
    ).toMatch(/non riesc/);
  }, 60000);
});
