import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, hydrate } from '@tanstack/react-query';
import {
  databaseCoiPermessi,
  OGGI,
  DOPO_LA_161,
  PROFILI_CHIUSI_VISTA_VECCHIA,
  COLONNE_VISTA_IN_PRODUZIONE,
  type Mondo,
  type Dati,
} from './aiuti/database-coi-permessi';
import { domandaProdotto, negozioDellaSchedaOperativo, COLONNE_NEGOZIO_DELLA_SCHEDA } from '@/lib/queries/catalogo';
import { fetchSellerPublicMap, COLONNE_NEGOZIO_IN_VETRINA } from '@/lib/queries/seller-public-profiles';
import {
  leggiTendenze,
  leggiSimili,
  leggiSponsorizzati,
  leggiSuggerimentiCarrello,
  leggiVistiDiRecente,
  leggiSpessoCompratiInsieme,
} from '@/lib/queries/fasce-prodotti';
import { leggiPreferiti } from '@/lib/queries/preferiti';
import { leggiNegozioDelMese } from '@/lib/queries/negozio-del-mese';
import { leggiSuggerimentiRicerca } from '@/lib/queries/suggerimenti-ricerca';
import { leggiProdottoPerMetadati, leggiNegozioPerAnteprima, prodottoDaIndicizzare } from '@/lib/queries/metadati-vetrina';
import { dimenticaLettureDeiMetadati } from '@/lib/supabase/lettura-per-metadati';
import { leggiVendutoDa, dimenticaLaVistaSenza126 } from '@/lib/queries/venduto-da';

/**
 * 15/10/2026 (R3) — QUANDO SI CHIUDE LA LETTURA DEI PROFILI, LA VETRINA DEVE RESTARE IN PIEDI.
 *
 * La migrazione 161 aspetta la firma di Nicola: richiude 27 regole riaperte il 9 settembre, fra cui
 * l'ultima che lasciava leggere a tutti i negozi approvati dalla tabella `profiles`. Il catalogo
 * agganciava il negozio proprio li' (`profiles!products_seller_id_fkey`). Il conto fatto dalla
 * radiografia dell'11/10, rifatto su un Postgres con tutte le migrazioni: dopo la 161, per un
 * visitatore e per un cliente con account l'aggancio torna VUOTO. La scheda prodotto diceva «il
 * negozio non e' operativo» e non vendeva; tendenze, simili, sponsorizzati, carrello, visti di
 * recente e ricerca suggerita si svuotavano; Google riceveva «noindex» e l'anteprima WhatsApp del
 * negozio perdeva nome e logo. Il negoziante e l'amministratore vedevano tutto perfetto.
 *
 * Questa prova ESEGUE le letture vere del sito contro un database finto che applica le regole di
 * lettura di chi guarda, in tre mondi: quello di oggi in produzione, quello dopo la 161, e quello
 * piu' stretto (profili chiusi e vista ancora senza le colonne della 126). In tutti e tre il
 * negozio approvato deve arrivare, e quello non approvato no.
 *
 * Il gemello nel database e' tests/sql/rls/34-la-scheda-prodotto-trova-il-negozio-senza-profiles.test.sql.
 */

const { logger, clienteDelPrecarico } = vi.hoisted(() => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  clienteDelPrecarico: { attuale: null as unknown },
}));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => clienteDelPrecarico.attuale }));

const PANE = 'n-pane';
const SEGRETA = 'n-segreta';
const MARIA = 'u-maria';

function dati(): Dati {
  return {
    profiles: [
      {
        id: PANE, role: 'seller', is_approved: true, store_name: 'Pane Quotidiano',
        store_address: 'Via Roma 1, Piacenza', store_phone: '0523 000000', store_logo: 'logo-pane.png',
        store_description: 'Forno a legna dal 1952', offers_express: true, store_hours: { lun: '7-13' },
        business_legal_name: 'Pane Quotidiano', business_form: 'S.r.l.', business_vat_number: '01234567890',
        business_address: 'Via Roma 1', business_city: 'Piacenza', business_zip: '29121',
        billing_iban: 'IT60X0542811101000000123456', city: 'Piacenza',
      },
      { id: SEGRETA, role: 'seller', is_approved: false, store_name: 'Bottega Segreta', billing_iban: 'IT00X' },
      { id: MARIA, role: 'buyer', is_approved: false, store_name: null, full_name: 'Maria Rossi' },
    ],
    products: [
      { id: 'p-focaccia', name: 'Focaccia al rosmarino', description: 'Lievitata 24 ore', price: 4.5, images: ['f.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-10', category_id: 'c-forno', stock: 10, has_variants: false },
      { id: 'p-grissini', name: 'Grissini stirati', description: null, price: 3, images: ['g.jpg'], seller_id: PANE, status: 'available', created_at: '2026-10-09', category_id: 'c-forno', stock: 5, has_variants: false },
      { id: 'p-torta', name: 'Torta di mele', description: null, price: 12, images: null, seller_id: PANE, status: 'available', created_at: '2026-10-08', category_id: 'c-forno', stock: null, has_variants: false },
      { id: 'p-taglie', name: 'Pane in tre pezzature', description: null, price: 2, images: null, seller_id: PANE, status: 'available', created_at: '2026-10-07', category_id: 'c-forno', stock: 9, has_variants: true },
      { id: 'p-finito', name: 'Focaccia farcita', description: null, price: 6, images: null, seller_id: PANE, status: 'available', created_at: '2026-10-06', category_id: 'c-forno', stock: 0, has_variants: false },
      { id: 'p-panettone', name: 'Panettone segreto', description: null, price: 19.9, images: null, seller_id: SEGRETA, status: 'available', created_at: '2026-10-11', category_id: 'c-forno', stock: 7, has_variants: false },
    ],
    categories: [{ id: 'c-forno', slug: 'forno', name: 'Forno', parent_id: null }],
    sponsored_active_public: [
      { id: 's-1', product_id: 'p-focaccia', placement: 'home_top', start_date: '2026-10-01', end_date: '2026-10-31', category_slug: 'forno' },
      { id: 's-2', product_id: 'p-panettone', placement: 'home_top', start_date: '2026-10-01', end_date: '2026-10-31', category_slug: 'forno' },
    ],
    recently_viewed: [
      { user_id: MARIA, product_id: 'p-focaccia', viewed_at: '2026-10-15T10:00:00Z' },
      { user_id: MARIA, product_id: 'p-panettone', viewed_at: '2026-10-15T09:00:00Z' },
      { user_id: MARIA, product_id: 'p-grissini', viewed_at: '2026-10-15T08:00:00Z' },
    ],
    favorites: [
      { user_id: MARIA, product_id: 'p-torta', created_at: '2026-10-14' },
      { user_id: MARIA, product_id: 'p-panettone', created_at: '2026-10-13' },
      { user_id: MARIA, product_id: 'p-focaccia', created_at: '2026-10-12' },
    ],
    shop_of_month: [
      { id: 'm-ott', cover_image_url: null, headline: 'Il forno del mese', story: null, discount_code: null, discount_percent: null, month: '2026-10-01', seller_id: PANE },
      { id: 'm-nov', cover_image_url: null, headline: 'Una bottega', story: null, discount_code: null, discount_percent: null, month: '2026-11-01', seller_id: SEGRETA },
    ],
  };
}

/**
 * Il secondo negozio approvato. In produzione ce ne sono due: una fascia che ne tiene solo uno
 * — per esempio una mappa dei negozi che si ferma alla prima riga — con un negozio solo in scena
 * resterebbe verde (lo ha misurato il primo collaudo).
 */
const SALUMI = 'n-salumi';
function datiConDueNegozi(): Dati {
  const d = dati();
  d.profiles.push({
    id: SALUMI, role: 'seller', is_approved: true, store_name: 'Salumeria Due', store_address: 'Via Po 2, Piacenza',
    store_phone: '0523 111111', offers_express: false,
  });
  d.products.push(
    { id: 'p-coppa', name: 'Coppa piacentina', description: null, price: 9, images: null, seller_id: SALUMI, status: 'available', created_at: '2026-10-12', category_id: 'c-forno', stock: 4, has_variants: false },
    { id: 'p-focaccia-salumi', name: 'Focaccia di salumeria', description: null, price: 5, images: null, seller_id: SALUMI, status: 'available', created_at: '2026-10-05', category_id: 'c-forno', stock: 3, has_variants: false },
  );
  d.sponsored_active_public.push({ id: 's-3', product_id: 'p-coppa', placement: 'home_top', start_date: '2026-10-01', end_date: '2026-10-31', category_slug: 'forno' });
  d.recently_viewed.push({ user_id: MARIA, product_id: 'p-coppa', viewed_at: '2026-10-15T07:00:00Z' });
  d.favorites.push({ user_id: MARIA, product_id: 'p-coppa', created_at: '2026-10-11' });
  return d;
}

const MONDI: Array<[string, Mondo]> = [
  ['oggi in produzione (161 e 126 non applicate)', OGGI],
  ['dopo la 161 (profili chiusi, vista con la 126)', DOPO_LA_161],
  ['profili chiusi e vista ancora senza la 126', PROFILI_CHIUSI_VISTA_VECCHIA],
];
const CHI: Array<[string, string | null]> = [
  ['un visitatore senza account', null],
  ['una cliente con account', MARIA],
];
const CASI = MONDI.flatMap(([m, mondo]) => CHI.map(([c, chi]) => [`${m} · ${c}`, mondo, chi] as const));

function db(mondo: Mondo, chi: string | null, rpcs?: Parameters<typeof databaseCoiPermessi>[3]) {
  return databaseCoiPermessi(dati(), mondo, chi, rpcs);
}

beforeEach(() => {
  dimenticaLettureDeiMetadati();
  // 16/10/2026 — il «no» della vista senza la 126 si ricorda per dieci minuti: ogni prova parte
  // da un processo che non ha ancora chiesto niente, come le prove di un mondo diverso pretendono.
  dimenticaLaVistaSenza126();
  logger.warn.mockClear();
  logger.error.mockClear();
});

describe('la controprova: il finto database mette in scena il difetto vero', () => {
  // Se il finto database non riproducesse la malattia, tutte le prove qui sotto sarebbero verdi
  // per comodita'. Qui si chiede la VECCHIA lettura, quella con l'aggancio a `profiles`.
  const VECCHIA = 'id, name, profiles!products_seller_id_fkey ( id, store_name, is_approved )';

  it('oggi in produzione l aggancio a profiles porta il negozio', async () => {
    const { data } = await db(OGGI, null).client.from('products').select(VECCHIA).eq('id', 'p-focaccia').maybeSingle();
    expect((data as { profiles: { store_name: string } | null }).profiles?.store_name).toBe('Pane Quotidiano');
  });

  it.each([null, MARIA])('dopo la 161 l aggancio a profiles torna vuoto (chi guarda: %s)', async (chi) => {
    const { data } = await db(DOPO_LA_161, chi).client.from('products').select(VECCHIA).eq('id', 'p-focaccia').maybeSingle();
    expect(data, 'il prodotto si legge ancora').not.toBeNull();
    expect((data as { profiles: unknown }).profiles, 'il negozio agganciato a profiles deve tornare vuoto').toBeNull();
  });

  it('dopo la 161 l aggancio con !inner della vecchia ricerca suggerita non trova niente', async () => {
    const { data } = await db(DOPO_LA_161, null).client
      .from('products')
      .select('id, profiles!products_seller_id_fkey!inner ( store_name, is_approved )')
      .eq('profiles.is_approved', true);
    expect(data).toEqual([]);
  });

  it('il negoziante, invece, la propria riga la vede sempre: per questo dentro casa nessuno se ne accorgeva', async () => {
    const { data } = await db(DOPO_LA_161, PANE).client.from('products').select(VECCHIA).eq('id', 'p-focaccia').maybeSingle();
    expect((data as { profiles: { store_name: string } | null }).profiles?.store_name).toBe('Pane Quotidiano');
  });

  it('una colonna che la vista di produzione non ha fa fallire la domanda intera', async () => {
    const { error } = await db(OGGI, null).client.from('seller_public_profiles').select('id, business_vat_number');
    expect(error).toMatchObject({ code: '42703' });
  });
});

describe('la scheda prodotto', () => {
  it.each(CASI)('si apre e si compra — %s', async (_n, mondo, chi) => {
    const scheda = await domandaProdotto(db(mondo, chi).client, 'p-focaccia').queryFn();
    expect(scheda, 'la scheda non e arrivata').not.toBeNull();
    expect(scheda!.profiles?.store_name).toBe('Pane Quotidiano');
    expect(scheda!.profiles?.offers_express).toBe(true);
    expect(scheda!.profiles?.store_hours).toEqual({ lun: '7-13' });
    expect(negozioDellaSchedaOperativo(scheda!), 'la pagina direbbe «il negozio non e operativo»').toBe(true);
  });

  it.each(MONDI)('di un negozio non approvato resta non acquistabile, anche per il suo proprietario — %s', async (_n, mondo) => {
    const scheda = await domandaProdotto(db(mondo, SEGRETA).client, 'p-panettone').queryFn();
    expect(scheda, 'il proprietario il suo prodotto lo legge').not.toBeNull();
    expect(negozioDellaSchedaOperativo(scheda!)).toBe(false);
  });

  it('di un negozio non approvato resta non acquistabile anche se la riga del prodotto trapela', async () => {
    // Variante scomoda: una regola sui prodotti piu' larga del dovuto lascia leggere il prodotto.
    // Il negozio non e' nella vetrina pubblica, quindi il prodotto non si compra lo stesso.
    const mondo = { ...DOPO_LA_161, prodottiDeiNonApprovatiVisibili: true };
    const scheda = await domandaProdotto(db(mondo, null).client, 'p-panettone').queryFn();
    expect(scheda).not.toBeNull();
    expect(negozioDellaSchedaOperativo(scheda!)).toBe(false);
  });

  it('se la vista dei negozi non risponde, la scheda fallisce invece di dire «negozio non operativo»', async () => {
    const vero = db(DOPO_LA_161, null).client;
    const rotto = {
      from: (t: string) =>
        t === 'seller_public_profiles'
          ? { select: () => ({ in: async () => ({ data: null, error: { code: '08006', message: 'connessione persa' } }) }) }
          : vero.from(t),
    };
    await expect(domandaProdotto(rotto, 'p-focaccia').queryFn()).rejects.toMatchObject({ code: '08006' });
  });

  it('il precarico del server consegna la scheda col negozio anche dopo la 161', async () => {
    clienteDelPrecarico.attuale = db(DOPO_LA_161, null).client;
    const { precaricaProdotto } = await import('@/lib/queries/precarico');
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } });
    hydrate(qc, await precaricaProdotto('p-focaccia'));
    const esplode = { from: () => { throw new Error('il browser e andato in rete'); } };
    const scheda = await qc.fetchQuery(domandaProdotto(esplode, 'p-focaccia'));
    expect(scheda?.profiles?.store_name).toBe('Pane Quotidiano');
    expect(negozioDellaSchedaOperativo(scheda!)).toBe(true);
  });

  it('chiede alla vista solo colonne che esistono anche in produzione', () => {
    const chieste = COLONNE_NEGOZIO_DELLA_SCHEDA.split(',').map((c) => c.trim());
    expect(chieste.filter((c) => !(COLONNE_VISTA_IN_PRODUZIONE as readonly string[]).includes(c))).toEqual([]);
    expect(COLONNE_NEGOZIO_IN_VETRINA.split(',').map((c) => c.trim()).filter((c) => !(COLONNE_VISTA_IN_PRODUZIONE as readonly string[]).includes(c))).toEqual([]);
  });
});

describe('quello che leggono Google e WhatsApp', () => {
  it.each(MONDI)('la scheda resta indicizzabile col nome del negozio — %s', async (_n, mondo) => {
    const meta = await leggiProdottoPerMetadati('p-focaccia', db(mondo, null).client as unknown as SupabaseClient);
    expect(meta?.profiles?.store_name).toBe('Pane Quotidiano');
    expect(prodottoDaIndicizzare(meta!), 'Google riceverebbe «noindex» su un prodotto in vendita').toBe(true);
  });

  it('un prodotto di un negozio non approvato non si indicizza, anche se la riga trapela', async () => {
    const mondo = { ...DOPO_LA_161, prodottiDeiNonApprovatiVisibili: true };
    const meta = await leggiProdottoPerMetadati('p-panettone', db(mondo, null).client as unknown as SupabaseClient);
    expect(meta).not.toBeNull();
    expect(prodottoDaIndicizzare(meta!)).toBe(false);
  });

  it.each(MONDI)('l anteprima del negozio ha nome, descrizione e logo — %s', async (_n, mondo) => {
    const negozio = await leggiNegozioPerAnteprima(PANE, db(mondo, null).client as unknown as SupabaseClient);
    expect(negozio).toEqual({ store_name: 'Pane Quotidiano', store_description: 'Forno a legna dal 1952', store_logo: 'logo-pane.png' });
  });

  it('l anteprima di un negozio non approvato resta generica', async () => {
    expect(await leggiNegozioPerAnteprima(SEGRETA, db(DOPO_LA_161, null).client as unknown as SupabaseClient)).toBeNull();
  });
});

describe('le fasce di prodotti', () => {
  // La variante scomoda in tutti i mondi: il prodotto del negozio non approvato si legge. Le fasce
  // devono scartarlo lo stesso, perche' il filtro sta nel codice e non solo nelle regole.
  const conFuga = (mondo: Mondo): Mondo => ({ ...mondo, prodottiDeiNonApprovatiVisibili: true });

  it.each(CASI)('«Trending ora» si riempie anche senza visite — %s', async (_n, mondo, chi) => {
    const fascia = await leggiTendenze(db(conFuga(mondo), chi).client);
    const ids = fascia.map((t) => t.product.id);
    expect(ids).toContain('p-focaccia');
    expect(ids).not.toContain('p-panettone');
    expect(fascia.find((t) => t.product.id === 'p-focaccia')?.product.profiles?.store_name).toBe('Pane Quotidiano');
  });

  it.each(CASI)('«Trending ora» con le visite tiene l ordine e scarta il negozio non approvato — %s', async (_n, mondo, chi) => {
    const conVisite = db(conFuga(mondo), chi, {
      trending_product_ids_24h: () => [
        { product_id: 'p-panettone', view_count: 50 },
        { product_id: 'p-grissini', view_count: 9 },
        { product_id: 'p-focaccia', view_count: 20 },
      ],
    });
    const fascia = await leggiTendenze(conVisite.client);
    expect(fascia.map((t) => t.product.id)).toEqual(['p-focaccia', 'p-grissini']);
  });

  it.each(CASI)('«Potrebbe piacerti» propone gli altri prodotti del forno — %s', async (_n, mondo, chi) => {
    const simili = await leggiSimili(db(conFuga(mondo), chi).client, { productId: 'p-focaccia', categoryId: 'c-forno', sellerId: PANE });
    const ids = simili.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['p-grissini', 'p-torta']));
    expect(ids).not.toContain('p-focaccia');
    expect(ids).not.toContain('p-panettone');
    expect(ids.length).toBeLessThanOrEqual(6);
  });

  it.each(CASI)('gli sponsorizzati restano in home, solo di negozi approvati — %s', async (_n, mondo, chi) => {
    const annunci = await leggiSponsorizzati(db(conFuga(mondo), chi).client, { placement: 'home_top', oggi: '2026-10-15' });
    expect(annunci.map((a) => a.product?.id)).toEqual(['p-focaccia']);
    expect(annunci[0].product?.profiles?.store_name).toBe('Pane Quotidiano');
  });

  it.each(CASI)('«Completa con» nel carrello propone quello che si compra col + — %s', async (_n, mondo, chi) => {
    const suggeriti = await leggiSuggerimentiCarrello(db(conFuga(mondo), chi).client, {
      sellerIds: [PANE, SEGRETA],
      excludeIds: ['p-focaccia'],
    });
    const ids = suggeriti.map((p) => p.id).sort();
    // fuori: gia' nel carrello, con varianti, finito, negozio non approvato.
    expect(ids).toEqual(['p-grissini', 'p-torta']);
    expect(suggeriti.every((p) => p.profiles?.store_name === 'Pane Quotidiano')).toBe(true);
  });

  it('«Completa con» non ingoia un errore di lettura', async () => {
    const rotto = { from: () => ({ select: () => ({ in: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: '57014', message: 'tempo scaduto' } }) }) }) }) }) };
    await expect(leggiSuggerimentiCarrello(rotto, { sellerIds: [PANE], excludeIds: [] })).rejects.toMatchObject({ code: '57014' });
  });

  it.each(MONDI)('«Ultimi visti» della cliente restano pieni — %s', async (_n, mondo) => {
    const visti = await leggiVistiDiRecente(db(conFuga(mondo), MARIA).client, { userId: MARIA });
    expect(visti.map((v) => v.product.id)).toEqual(['p-focaccia', 'p-grissini']);
  });

  it.each(CASI)('la ricerca suggerita trova la focaccia anche scrivendo meta parola — %s', async (_n, mondo, chi) => {
    // «foc» non e' una parola intera: la ricerca del database non risponde e scatta il ripiego per nome.
    const suggerimenti = await leggiSuggerimentiRicerca(db(conFuga(mondo), chi).client, 'foc');
    const prodotti = suggerimenti.filter((s) => s.kind === 'product');
    expect(prodotti.map((p) => p.kind === 'product' && p.id)).toEqual(expect.arrayContaining(['p-focaccia']));
    expect(prodotti.every((p) => p.kind === 'product' && p.store === 'Pane Quotidiano')).toBe(true);
  });

  it('la ricerca suggerita non propone il panettone della bottega non approvata', async () => {
    const suggerimenti = await leggiSuggerimentiRicerca(db(conFuga(DOPO_LA_161), null).client, 'panet');
    expect(suggerimenti.filter((s) => s.kind === 'product')).toEqual([]);
  });

  it('una select che dimentica la chiave del negozio non svuota la fascia', async () => {
    // Senza `id` la mappa dei negozi resterebbe vuota e ogni prodotto sembrerebbe di un negozio
    // non approvato: la fascia sparirebbe senza un errore.
    const mappa = await fetchSellerPublicMap(db(DOPO_LA_161, null).client, [PANE], 'store_name');
    expect(mappa.get(PANE)?.store_name).toBe('Pane Quotidiano');
    expect(mappa.get(PANE)?.is_approved).toBe(true);
  });
});

describe('«Venduto da» (R55)', () => {
  it('oggi in produzione, senza la 126, si vede il negozio e resta una traccia nei log', async () => {
    const dati = await leggiVendutoDa(db(OGGI, null).client, PANE);
    expect(dati).toMatchObject({
      store_name: 'Pane Quotidiano',
      store_address: 'Via Roma 1, Piacenza',
      store_phone: '0523 000000',
      business_legal_name: null,
      business_vat_number: null,
    });
    expect(logger.warn, 'la vista senza colonne d impresa deve lasciare un avviso').toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0][0])).toContain('126');
  });

  it('dopo la 126 il riquadro ha ragione sociale, partita IVA e sede, senza avvisi', async () => {
    const dati = await leggiVendutoDa(db(DOPO_LA_161, null).client, PANE);
    expect(dati).toMatchObject({
      business_legal_name: 'Pane Quotidiano',
      business_form: 'S.r.l.',
      business_vat_number: '01234567890',
      business_city: 'Piacenza',
    });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('un negozio che la vista non mostra non produce un riquadro', async () => {
    expect(await leggiVendutoDa(db(DOPO_LA_161, null).client, SEGRETA)).toBeNull();
  });

  it('se la lettura fallisce per un altro motivo, lo scrive nei log e non torna «vuoto»', async () => {
    // Variante scomoda (il secondo collaudo): la PRIMA lettura cade per la rete, la seconda —
    // quella ridotta — riuscirebbe. Se il codice scambiasse ogni errore per «manca la 126»,
    // ripiegherebbe, mostrerebbe il riquadro e scriverebbe nei registri un falso «migrazione 126
    // non applicata». Qui deve fallire, scrivere l'errore vero e nessun avviso sulla 126.
    const vero = db(OGGI, null).client;
    let letture = 0;
    const rotto = {
      from: (t: string) => {
        letture += 1;
        if (letture === 1) {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '08006', message: 'connessione persa' } }) }) }) };
        }
        return vero.from(t);
      },
    };
    await expect(leggiVendutoDa(rotto, PANE)).rejects.toMatchObject({ code: '08006' });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.warn, 'un errore di rete scambiato per «manca la 126»').not.toHaveBeenCalled();
    expect(letture, 'dopo un errore di rete non si ripiega sulla lettura ridotta').toBe(1);
  });

  it('se anche la lettura ridotta cade, lo scrive e non torna «vuoto»', async () => {
    let letture = 0;
    const rotto = {
      from: () => {
        letture += 1;
        const errore = letture === 1
          ? { code: '42703', message: 'column seller_public_profiles.business_legal_name does not exist' }
          : { code: '08006', message: 'connessione persa' };
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: errore }) }) }) };
      },
    };
    await expect(leggiVendutoDa(rotto, PANE)).rejects.toMatchObject({ code: '08006' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('i gemelli rimasti indietro al primo giro', () => {
  const conFuga = (mondo: Mondo): Mondo => ({ ...mondo, prodottiDeiNonApprovatiVisibili: true });

  it('la controprova: dopo la 161 la vecchia lettura di «Spesso comprati insieme» non trova niente', async () => {
    const { data } = await db(DOPO_LA_161, MARIA).client
      .from('products')
      .select('id, name, profiles!products_seller_id_fkey!inner ( is_approved )')
      .eq('seller_id', PANE)
      .eq('profiles.is_approved', true);
    expect(data).toEqual([]);
  });

  it.each(CASI)('«Spesso comprati insieme» propone gli altri prodotti del forno — %s', async (_n, mondo, chi) => {
    const insieme = await leggiSpessoCompratiInsieme(db(conFuga(mondo), chi).client, { productId: 'p-focaccia', sellerId: PANE });
    // i piu' recenti per primi, al massimo quattro, senza il prodotto della scheda
    expect(insieme.map((p) => p.id)).toEqual(['p-grissini', 'p-torta', 'p-taglie', 'p-finito']);
  });

  it.each(MONDI)('«Spesso comprati insieme» di un negozio non approvato resta vuoto, anche se le righe trapelano — %s', async (_n, mondo) => {
    expect(await leggiSpessoCompratiInsieme(db(conFuga(mondo), null).client, { productId: 'p-x', sellerId: SEGRETA })).toEqual([]);
  });

  it('la controprova: dopo la 161 la vecchia lettura dei preferiti perde il negozio', async () => {
    const { data } = await db(DOPO_LA_161, MARIA).client
      .from('favorites')
      .select('product_id, products ( id, profiles!products_seller_id_fkey ( store_name, is_approved ) )')
      .eq('user_id', MARIA);
    const prodotti = (data as Array<{ products: { profiles: unknown } | null }>).map((f) => f.products);
    expect(prodotti.filter(Boolean).every((p) => p!.profiles === null)).toBe(true);
  });

  it.each(MONDI)('i preferiti della cliente restano, in ordine, senza la bottega non approvata — %s', async (_n, mondo) => {
    const preferiti = await leggiPreferiti(db(conFuga(mondo), MARIA).client, MARIA);
    expect(preferiti.map((p) => p.id)).toEqual(['p-torta', 'p-focaccia']);
    expect(preferiti.every((p) => p.profiles?.store_name === 'Pane Quotidiano')).toBe(true);
  });

  it('i preferiti non ingoiano un errore di lettura', async () => {
    const rotto = { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { code: '57014', message: 'tempo scaduto' } }) }) }) }) };
    await expect(leggiPreferiti(rotto, MARIA)).rejects.toMatchObject({ code: '57014' });
  });

  it('la controprova: dopo la 161 il vecchio «Negozio del mese» perde il negozio, e il riquadro spariva', async () => {
    const { data } = await db(DOPO_LA_161, null).client
      .from('shop_of_month')
      .select('id, seller:profiles!shop_of_month_seller_id_fkey ( id, store_name, store_logo )')
      .eq('month', '2026-10-01')
      .maybeSingle();
    expect((data as { seller: unknown }).seller).toBeNull();
  });

  it.each(CASI)('il «Negozio del mese» arriva col suo negozio — %s', async (_n, mondo, chi) => {
    const scelta = await leggiNegozioDelMese(db(mondo, chi).client, '2026-10-01');
    expect(scelta?.headline).toBe('Il forno del mese');
    expect(scelta?.seller).toEqual({ id: PANE, store_name: 'Pane Quotidiano', store_logo: 'logo-pane.png' });
  });

  it.each(MONDI)('un negozio non approvato non si mette in evidenza come negozio del mese — %s', async (_n, mondo) => {
    const scelta = await leggiNegozioDelMese(db(mondo, null).client, '2026-11-01');
    expect(scelta?.seller).toBeNull();
  });

  it('un mese senza scelta non ha riquadro', async () => {
    expect(await leggiNegozioDelMese(db(DOPO_LA_161, null).client, '2026-12-01')).toBeNull();
  });
});

describe('con due negozi approvati, come in produzione', () => {
  const dueNegozi = (mondo: Mondo, chi: string | null, rpcs?: Parameters<typeof databaseCoiPermessi>[3]) =>
    databaseCoiPermessi(datiConDueNegozi(), { ...mondo, prodottiDeiNonApprovatiVisibili: true }, chi, rpcs).client;

  it.each(CASI)('ogni fascia porta i prodotti di tutti e due i negozi — %s', async (_n, mondo, chi) => {
    const supa = dueNegozi(mondo, chi);
    const tendenze = (await leggiTendenze(supa)).map((t) => t.product.id);
    expect(tendenze).toEqual(expect.arrayContaining(['p-focaccia', 'p-coppa']));

    const simili = (await leggiSimili(supa, { productId: 'p-grissini', categoryId: 'c-forno' })).map((p) => p.id);
    expect(simili).toEqual(expect.arrayContaining(['p-focaccia', 'p-coppa']));

    const annunci = (await leggiSponsorizzati(supa, { placement: 'home_top', oggi: '2026-10-15' })).map((a) => a.product?.id);
    expect(annunci).toEqual(['p-focaccia', 'p-coppa']);

    const carrello = (await leggiSuggerimentiCarrello(supa, { sellerIds: [PANE, SALUMI], excludeIds: [] })).map((p) => p.id);
    expect(carrello).toEqual(expect.arrayContaining(['p-grissini', 'p-coppa']));

    const ricerca = (await leggiSuggerimentiRicerca(supa, 'foc')).filter((x) => x.kind === 'product');
    expect([...new Set(ricerca.map((x) => x.kind === 'product' && x.store))].sort()).toEqual(['Pane Quotidiano', 'Salumeria Due']);
  });

  it.each(MONDI)('la cliente ritrova visti e preferiti di tutti e due i negozi — %s', async (_n, mondo) => {
    const supa = dueNegozi(mondo, MARIA);
    const visti = (await leggiVistiDiRecente(supa, { userId: MARIA })).map((v) => v.product.id);
    expect(visti).toEqual(['p-focaccia', 'p-grissini', 'p-coppa']);
    const preferiti = (await leggiPreferiti(supa, MARIA)).map((p) => [p.id, p.profiles?.store_name]);
    expect(preferiti).toEqual([
      ['p-torta', 'Pane Quotidiano'],
      ['p-focaccia', 'Pane Quotidiano'],
      ['p-coppa', 'Salumeria Due'],
    ]);
  });
});
