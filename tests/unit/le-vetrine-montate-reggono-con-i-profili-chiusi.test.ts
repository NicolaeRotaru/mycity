/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';
import {
  databaseCoiPermessi,
  DOPO_LA_161,
  PROFILI_CHIUSI_VISTA_VECCHIA,
  type Mondo,
  type Dati,
} from './aiuti/database-coi-permessi';
import { CHIAVE_UTENTE } from '@/components/hooks/useUtente';
import { chiaveVendutoDa } from '@/lib/queries/venduto-da';
import { primoDelMesePiacenza } from '@/lib/tempo-piacenza';

/**
 * 15/10/2026 (R3, secondo giro) — LE FASCE MONTATE DAVVERO, CON LA TABELLA DEI PROFILI CHIUSA.
 *
 * Il primo collaudo ha rimesso la vecchia lettura da `profiles` dentro i componenti — tendenze,
 * sponsorizzati, simili, carrello, visti di recente, ricerca, «Venduto da» — e tutte le prove sono
 * rimaste verdi: provavano le funzioni in `lib/queries`, non che i componenti le chiamassero.
 * Peggio: due gemelli sulla stessa scheda prodotto e nell'account erano rimasti indietro — «Spesso
 * comprati insieme» e i preferiti — e anche il riquadro «Negozio del mese» della home.
 *
 * Qui ogni componente si MONTA. La lettura scritta dentro il componente gira contro un database
 * finto che applica le regole di chi guarda, nel mondo dopo la migrazione 161: `profiles` si
 * legge solo per la propria riga. Poi il componente si disegna con quella risposta, e si guarda
 * cosa c'e' a schermo. Se un componente torna ad agganciare il negozio a `profiles`, la sua fascia
 * resta vuota e la prova diventa rossa.
 */

const PANE = 'n-pane';
const SEGRETA = 'n-segreta';
const MARIA = 'u-maria';
const MESE = primoDelMesePiacenza();

function dati(): Dati {
  return {
    profiles: [
      {
        id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano', store_logo: 'logo-pane.png',
        store_address: 'Via Roma 1, Piacenza', store_phone: '0523 000000',
        business_legal_name: 'Pane Quotidiano', business_form: 'S.r.l.', business_vat_number: '01234567890',
        business_address: 'Via Roma 1', business_city: 'Piacenza', business_zip: '29121',
      },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta' },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi' },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia al rosmarino', description: 'Lievitata', price: 4.5, images: ['f.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-10', category_id: 'c-forno', stock: 10, has_variants: false },
      { id: 'p-grissini', name: 'Grissini stirati', description: null, price: 3, images: ['g.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-09', category_id: 'c-forno', stock: 5, has_variants: false },
      { id: 'p-torta', name: 'Torta di mele', description: null, price: 12, images: null, seller_id: PANE, status: 'available', created_at: '2026-10-08', category_id: 'c-forno', stock: null, has_variants: false },
      { id: 'p-panettone', name: 'Panettone segreto', description: null, price: 19.9, images: null, seller_id: SEGRETA, status: 'available', created_at: '2026-10-11', category_id: 'c-forno', stock: 7, has_variants: false },
    ],
    categories: [{ id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: null }],
    sponsored_active_public: [
      { id: 's-1', product_id: 'p-focaccia', placement: 'home_top', start_date: '2026-01-01', end_date: '2099-12-31', category_slug: 'forno' },
    ],
    recently_viewed: [
      { user_id: MARIA, product_id: 'p-focaccia', viewed_at: '2026-10-15T10:00:00Z' },
      { user_id: MARIA, product_id: 'p-grissini', viewed_at: '2026-10-15T08:00:00Z' },
    ],
    favorites: [
      { user_id: MARIA, product_id: 'p-torta', created_at: '2026-10-14' },
      { user_id: MARIA, product_id: 'p-focaccia', created_at: '2026-10-13' },
    ],
    shop_of_month: [
      { id: 'm-1', cover_image_url: null, headline: null, story: 'Il forno del quartiere', discount_code: null, discount_percent: null, month: MESE, seller_id: PANE },
    ],
  };
}

const MONDI_CHIUSI: Array<[string, Mondo]> = [
  ['dopo la 161', DOPO_LA_161],
  ['profili chiusi e vista senza la 126', PROFILI_CHIUSI_VISTA_VECCHIA],
];
const CHI: Array<[string, string | null]> = [
  ['visitatore', null],
  ['cliente con account', MARIA],
];
const CASI = MONDI_CHIUSI.flatMap(([m, mondo]) => CHI.map(([c, chi]) => [`${m} · ${c}`, mondo, chi] as const));
const CASI_CLIENTE = MONDI_CHIUSI.map(([m, mondo]) => [`${m} · cliente con account`, mondo] as const);

const globale = globalThis as Record<string, unknown>;

type Opzioni = { queryKey: readonly unknown[]; queryFn?: (c: unknown) => Promise<unknown>; enabled?: boolean };

/**
 * Monta il componente, esegue le letture che il componente stesso chiede, lo ridisegna con le
 * risposte e restituisce il testo a schermo. Le letture sono quelle scritte DENTRO il componente:
 * qui non si chiama nessuna funzione di `lib/queries` a mano.
 */
async function aSchermo(file: string, nome: string, props: Record<string, unknown>, mondo: Mondo, chi: string | null) {
  const componente = (await monta(file))[nome];
  // 31/10/2026 — «Trending ora» si disegna solo con visite vere: senza, la classifica era finta.
  // Le visite delle ultime 24 ore qui sono date, anche al panettone della bottega non approvata.
  const visite = () => [
    { product_id: 'p-panettone', view_count: 20 },
    { product_id: 'p-focaccia', view_count: 12 },
  ];
  globale.__CLIENT_SUPABASE__ = databaseCoiPermessi(dati(), mondo, chi, { trending_product_ids_24h: visite }).client;
  globale.__UTENTE__ = chi ? { id: chi } : null;

  const risposte = new Map<string, unknown>();
  const chieste = new Map<string, Opzioni>();
  function rispondi(o: Opzioni) {
    const k = JSON.stringify(o.queryKey);
    if (k === JSON.stringify(CHIAVE_UTENTE)) return chi ? { id: chi } : null;
    if (!risposte.has(k)) chieste.set(k, o);
    return risposte.get(k);
  }
  globale.__DATI_QUERY__ = rispondi;

  for (let giro = 0; giro < 4; giro += 1) {
    const s = accendi(componente, props);
    await attendi();
    s.smonta();
    const nuove = [...chieste.entries()].filter(([k]) => !risposte.has(k));
    if (nuove.length === 0) break;
    for (const [k, o] of nuove) {
      risposte.set(k, o.enabled === false || !o.queryFn ? undefined : await o.queryFn({ queryKey: o.queryKey, meta: undefined }));
    }
  }

  const s = accendi(componente, props);
  await attendi();
  const testo = testoVisibile(s.radice);
  s.smonta();
  return { testo, chieste, risposte };
}

afterEach(() => {
  for (const k of ['__CLIENT_SUPABASE__', '__UTENTE__', '__DATI_QUERY__']) delete globale[k];
});

describe('la home', () => {
  it.each(CASI)('«Trending ora» si vede, senza il panettone della bottega non approvata — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo('components/home/TrendingNow.tsx', 'default', {}, mondo, chi);
    expect(testo, 'la fascia «Trending ora» e sparita').toContain('Focaccia al rosmarino');
    expect(testo).not.toContain('Panettone segreto');
  });

  it.each(CASI)('gli sponsorizzati restano in home — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo('components/SponsoredCarousel.tsx', 'default', { placement: 'home_top' }, mondo, chi);
    expect(testo, 'l annuncio pagato e sparito dalla home').toContain('Focaccia al rosmarino');
  });

  it.each(CASI)('il riquadro «Negozio del mese» resta in home — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo('components/home/ShopOfMonthHero.tsx', 'default', {}, mondo, chi);
    expect(testo, 'il riquadro del negozio del mese e sparito').toContain('Pane Quotidiano');
  });

  it.each(CASI)('la pagina «Negozio del mese» mostra il negozio scelto — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo('app/shop-of-month/page.tsx', 'default', {}, mondo, chi);
    expect(testo).toContain('Pane Quotidiano');
  });

  it.each(CASI_CLIENTE)('«Ultimi visti» della cliente restano pieni — %s', async (_n, mondo) => {
    const { testo } = await aSchermo('components/RecentlyViewed.tsx', 'default', {}, mondo, MARIA);
    expect(testo).toContain('Focaccia al rosmarino');
    expect(testo).toContain('Grissini stirati');
  });
});

describe('la scheda prodotto', () => {
  it.each(CASI)('«Potrebbe piacerti» propone gli altri prodotti del forno — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo(
      'components/SimilarProducts.tsx', 'default',
      { productId: 'p-focaccia', categoryId: 'c-forno', sellerId: PANE }, mondo, chi,
    );
    expect(testo).toContain('Grissini stirati');
    expect(testo).not.toContain('Panettone segreto');
  });

  it.each(CASI)('«Spesso comprati insieme» resta sulla scheda — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo(
      'components/products/FrequentlyBoughtTogether.tsx', 'FrequentlyBoughtTogether',
      { productId: 'p-focaccia', sellerId: PANE, storeName: 'Pane Quotidiano' }, mondo, chi,
    );
    expect(testo, 'la fascia «Spesso comprati insieme» e sparita').toContain('Spesso comprati insieme');
    expect(testo).toContain('Grissini stirati');
  });

  it('«Spesso comprati insieme» non propone i prodotti di un negozio non approvato', async () => {
    const { testo } = await aSchermo(
      'components/products/FrequentlyBoughtTogether.tsx', 'FrequentlyBoughtTogether',
      { productId: 'p-altro', sellerId: SEGRETA }, { ...DOPO_LA_161, prodottiDeiNonApprovatiVisibili: true }, null,
    );
    expect(testo).not.toContain('Panettone segreto');
  });

  it.each(CASI)('«Venduto da» si disegna, e chiede la stessa chiave che il server precarica — %s', async (_n, mondo, chi) => {
    const { testo, chieste } = await aSchermo(
      'components/products/VendutoDa.tsx', 'VendutoDa', { sellerId: PANE, storeName: 'Pane Quotidiano' }, mondo, chi,
    );
    expect(testo).toContain('Venduto da');
    expect(testo).toContain('Pane Quotidiano');
    // Se la chiave fosse diversa da quella del precarico, il browser rifarebbe la lettura e
    // l'avviso sulla migrazione 126 tornerebbe a finire sul telefono del cliente.
    expect([...chieste.values()].map((o) => o.queryKey)).toContainEqual(chiaveVendutoDa(PANE));
  });
});

describe('il carrello', () => {
  it.each(CASI)('«Completa con» propone quello che si compra col + — %s', async (_n, mondo, chi) => {
    const { testo } = await aSchermo(
      'components/cart/CartUpsell.tsx', 'CartUpsell',
      { items: [{ id: 'p-focaccia', name: 'Focaccia al rosmarino', price: 4.5, quantity: 1, sellerId: PANE }] }, mondo, chi,
    );
    expect(testo, 'i suggerimenti del carrello sono spariti').toContain('Grissini stirati');
  });
});

describe('l account', () => {
  it.each(CASI_CLIENTE)('i preferiti della cliente restano nella sua pagina — %s', async (_n, mondo) => {
    const { testo } = await aSchermo('app/favorites/page.tsx', 'default', {}, mondo, MARIA);
    expect(testo, 'la pagina direbbe «Nessun preferito ancora»').toContain('Torta di mele');
    expect(testo).toContain('Focaccia al rosmarino');
    expect(testo).not.toContain('Nessun preferito ancora');
  });
});

describe('la ricerca', () => {
  it.each(CASI)('la tendina trova la focaccia scrivendo meta parola — %s', async (_n, mondo, chi) => {
    const componente = (await monta('components/SearchBar.tsx')).default;
    globale.__CLIENT_SUPABASE__ = databaseCoiPermessi(dati(), mondo, chi).client;
    const chieste: Opzioni[] = [];
    function annota(o: Opzioni) {
      chieste.push(o);
      return undefined;
    }
    globale.__DATI_QUERY__ = annota;
    const s = accendi(componente, {});
    const campo = s.radice.querySelector('input') as HTMLInputElement;
    await act(async () => {
      const imposta = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      imposta.call(campo, 'foc');
      campo.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    // Il campo aspetta che si smetta di scrivere prima di chiedere.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    s.smonta();
    const domanda = chieste.find((o) => o.enabled !== false && JSON.stringify(o.queryKey).includes('"foc"'));
    expect(domanda, 'la tendina non ha chiesto niente per «foc»').toBeDefined();
    const suggerimenti = (await domanda!.queryFn!({ queryKey: domanda!.queryKey })) as Array<{ kind: string; name?: string }>;
    expect(suggerimenti.filter((x) => x.kind === 'product').map((x) => x.name)).toContain('Focaccia al rosmarino');
  });
});
