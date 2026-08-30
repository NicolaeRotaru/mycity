/**
 * 27/8/2026 (R079) — LA VETRINA IN HOME SCARICAVA DUECENTO PRODOTTI PER MOSTRARNE DICIOTTO,
 * E SCEGLIEVA I SEI NEGOZI A CASO.
 *
 * La scheda di ogni negozio mostra tre foto (`StorePreviewCard` fa `products.slice(0, 3)`). La
 * lettura ne chiedeva duecento, con la colonna delle immagini dentro, e ne buttava
 * centottantadue — sulla home, cioè la prima pagina che si apre, quasi sempre da telefono, dove
 * ogni kilobyte pesa sul tempo che passa prima di vedere qualcosa.
 *
 * E i sei negozi in vetrina venivano presi con un `.limit(6)` senza `.order()`: quali fossero lo
 * decideva il piano di esecuzione di PostgreSQL. La stessa persona poteva vederne sei diversi a
 * ogni ricarica, e al negoziante che chiede «perché il mio non compare mai» non c'era niente da
 * rispondere: nessuno l'aveva deciso.
 *
 * La prova esegue la lettura contro un finto PostgREST che registra come sono state chieste le
 * righe: quante, in che ordine, e con quale funzione.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Riga } from './aiuti/finto-postgrest';
import { leggiVetrinaNegozi, PRODOTTI_PER_NEGOZIO } from '@/lib/queries/vetrina-negozi';
import type { SupabaseClient } from '@supabase/supabase-js';

const negozio = (n: number) => ({
  id: `negozio-${n}`,
  store_name: `Bottega ${String.fromCharCode(65 + n)}`,
  store_address: 'via Roma 1',
  store_logo: null,
  store_hours: null,
  store_media: null,
  is_approved: true,
  stripe_charges_enabled: true,
  stripe_payouts_enabled: true,
});

const prodotto = (negozioN: number, i: number): Riga => ({
  id: `p-${negozioN}-${i}`,
  name: `Prodotto ${i}`,
  price: 3,
  images: ['foto.jpg'],
  seller_id: `negozio-${negozioN}`,
  status: 'available',
  created_at: `2026-08-${String(1 + (i % 27)).padStart(2, '0')}T10:00:00Z`,
});

/** Otto negozi, quaranta prodotti a testa: com'era il giorno che il difetto è stato misurato. */
const TABELLE = {
  seller_public_profiles: Array.from({ length: 8 }, (_, n) => negozio(n)),
  products: Array.from({ length: 8 }, (_, n) => Array.from({ length: 40 }, (_, i) => prodotto(n, i))).flat(),
};

/** La funzione del database che dà i primi N di OGNI negozio (migrazione 122). */
const conStoreCards = () => ({
  store_cards: (argomenti: Record<string, unknown>) => ({
    data: TABELLE.seller_public_profiles.slice(0, Number(argomenti.p_limit ?? 6)).map((s) => ({
      seller_id: s.id,
      prodotti: TABELLE.products
        .filter((p) => p.seller_id === s.id)
        .slice(0, Number(argomenti.p_per_store ?? 4)),
      totale: 40,
    })),
    error: null,
  }),
  store_review_stats: () => ({ data: [], error: null }),
});

describe('la vetrina dei negozi in home', () => {
  it('chiede al database tre prodotti per negozio, non duecento in blocco', async () => {
    const db = fintoDb(TABELLE, conStoreCards());

    const vetrina = await leggiVetrinaNegozi(db.client as unknown as SupabaseClient);

    const lettureProdotti = db.chiamate.filter((c) => c.tabella === 'products');
    expect(lettureProdotti, 'duecento righe scaricate sulla home per mostrarne diciotto').toEqual([]);
    const chiamata = db.rpc.find((r) => r.nome === 'store_cards');
    expect(chiamata?.argomenti).toMatchObject({ p_per_store: PRODOTTI_PER_NEGOZIO });
    for (const [negozio, prodotti] of Object.entries(vetrina.productsByStore)) {
      expect(prodotti.length, `dal negozio ${negozio} arrivano più prodotti di quanti se ne vedano`).toBeLessThanOrEqual(3);
    }
  });

  it('i sei negozi in vetrina sono una scelta, non il caso', async () => {
    const db = fintoDb(TABELLE, conStoreCards());

    const vetrina = await leggiVetrinaNegozi<{ id: string; store_name: string }>(db.client as unknown as SupabaseClient);

    const letturaNegozi = db.chiamate.find((c) => c.tabella === 'seller_public_profiles');
    expect(letturaNegozi?.ordinamenti, 'quali negozi finiscono in home lo decide il piano del database').toContain('store_name');
    expect(vetrina.stores).toHaveLength(6);
    expect(vetrina.stores.map((s) => s.store_name)).toEqual([...vetrina.stores.map((s) => s.store_name)].sort());
  });

  it('ogni negozio in vetrina ha le sue foto: nessuno resta senza', async () => {
    const db = fintoDb(TABELLE, conStoreCards());
    const vetrina = await leggiVetrinaNegozi<{ id: string }>(db.client as unknown as SupabaseClient);
    for (const s of vetrina.stores) {
      expect(vetrina.productsByStore[s.id]?.length, `il negozio ${s.id} compare vuoto`).toBe(3);
    }
  });

  it('se la funzione del database non c è, la vetrina si riempie lo stesso', async () => {
    // Un database indietro con la migrazione non deve lasciare la home con sei negozi senza foto.
    const db = fintoDb(TABELLE, { store_review_stats: () => ({ data: [], error: null }) });

    const vetrina = await leggiVetrinaNegozi<{ id: string }>(db.client as unknown as SupabaseClient);

    expect(Object.values(vetrina.productsByStore).flat().length).toBeGreaterThan(0);
    for (const prodotti of Object.values(vetrina.productsByStore)) {
      expect(prodotti.length).toBeLessThanOrEqual(3);
    }
  });
});
