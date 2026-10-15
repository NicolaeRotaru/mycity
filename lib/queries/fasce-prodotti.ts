import {
  conNegozioApprovato,
  fetchSellerPublicMap,
  negozioApprovato,
  COLONNE_NEGOZIO_IN_VETRINA,
  type LettoreVista,
} from '@/lib/queries/seller-public-profiles';

/**
 * LE FASCE DI PRODOTTI: tendenze, simili, sponsorizzati, suggerimenti nel
 * carrello, «spesso comprati insieme», visti di recente.
 *
 * 15/10/2026 (R3) — Ognuna di queste letture viveva dentro il suo componente e
 * agganciava il negozio alla tabella `profiles`, poi teneva solo i prodotti con
 * `profiles.is_approved`. Con la migrazione 161 `profiles` si chiude a chi non e'
 * il proprietario: per ogni cliente l'aggancio torna vuoto, il filtro butta via
 * tutto, e ogni fascia della home, della scheda e del carrello sparisce in
 * silenzio — un componente con zero prodotti non si disegna, quindi nessun
 * errore a schermo. Il negoziante e l'amministratore la vedrebbero piena.
 *
 * Adesso il prodotto porta solo il suo `seller_id`, e il negozio arriva da UNA
 * domanda alla vista pubblica `seller_public_profiles` per tutta la fascia
 * (`conNegozioApprovato`). La regola resta la stessa di prima: un prodotto di un
 * negozio non approvato non si propone.
 *
 * Le letture stanno qui e non nei componenti per poterle ESEGUIRE in una prova:
 * in questa repo un componente React non si monta in vitest senza compilarlo a
 * parte, e la logica che decide cosa si vende deve poter essere messa alla prova.
 */

/** Un client che sa anche chiamare le funzioni del database. */
export type LettoreConFunzioni = LettoreVista & {
  rpc: (nome: string, argomenti?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Il negozio come lo mostra una fascia. */
export type NegozioInFascia = { store_name: string | null; is_approved: boolean };

function negozioInFascia(n: { store_name?: string | null; is_approved?: boolean } | null | undefined): NegozioInFascia | null {
  if (!n) return null;
  return { store_name: n.store_name ?? null, is_approved: n.is_approved === true };
}

// ───────────────────────────── «Trending ora» ──────────────────────────────

export type Tendenza = {
  product_id: string;
  view_count: number;
  product: { id: string; name: string; price: number; images: string[] | null; profiles: NegozioInFascia | null };
};

type RigaFascia = { id: string; name: string; price: string | number; images: string[] | null; seller_id: string | null };

const COLONNE_FASCIA = 'id, name, price, images, seller_id';

/** I prodotti piu' visti nelle ultime 24 ore; senza visite, gli ultimi pubblicati. */
export async function leggiTendenze(supa: LettoreConFunzioni): Promise<Tendenza[]> {
  // Top prodotti per views nelle ultime 24h: aggregazione lato DB (RPC 052)
  // invece di scaricare fino a 500 righe di product_views e contare nel browser.
  const { data: trending } = await supa.rpc('trending_product_ids_24h', { p_limit: 8 });
  const rows = (trending ?? []) as { product_id: string; view_count: number | string }[];

  if (rows.length === 0) {
    // Fallback: ultimi 8 prodotti disponibili
    const { data } = await supa
      .from('products')
      .select(COLONNE_FASCIA)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(8);
    const approvati = await conNegozioApprovato(supa, (data ?? []) as RigaFascia[], COLONNE_NEGOZIO_IN_VETRINA);
    return approvati.map((p) => ({
      product_id: p.id,
      view_count: 0,
      product: { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: negozioInFascia(p.profiles) },
    }));
  }

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.product_id, Number(r.view_count));
  const topIds = rows.map((r) => r.product_id);

  const { data: products } = await supa
    .from('products')
    .select(COLONNE_FASCIA)
    .in('id', topIds)
    .eq('status', 'available');

  const approvati = await conNegozioApprovato(supa, (products ?? []) as RigaFascia[], COLONNE_NEGOZIO_IN_VETRINA);
  return approvati
    .map((p) => ({
      product_id: p.id,
      view_count: counts.get(p.id) ?? 0,
      product: { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: negozioInFascia(p.profiles) },
    }))
    .sort((a, b) => b.view_count - a.view_count);
}

// ─────────────────────────── «Potrebbe piacerti» ───────────────────────────

export type ProdottoSimile = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  profiles: NegozioInFascia | null;
};

/**
 * Prima lo stesso negozio, poi la stessa categoria, senza il prodotto corrente.
 * Massimo 6. Le due letture partono insieme e i negozi si chiedono una volta sola
 * per tutte e due.
 */
export async function leggiSimili(
  supa: LettoreVista,
  { productId, categoryId, sellerId }: { productId: string; categoryId?: string; sellerId?: string },
): Promise<ProdottoSimile[]> {
  const stessoNegozio = sellerId
    ? supa
        .from('products')
        .select(COLONNE_FASCIA)
        .eq('seller_id', sellerId)
        .eq('status', 'available')
        .neq('id', productId)
        .limit(6)
    : Promise.resolve({ data: [] });
  const stessaCategoria = categoryId
    ? supa
        .from('products')
        .select(COLONNE_FASCIA)
        .eq('category_id', categoryId)
        .eq('status', 'available')
        .neq('id', productId)
        .limit(12)
    : Promise.resolve({ data: [] });

  const [daNegozio, daCategoria] = (await Promise.all([stessoNegozio, stessaCategoria])) as Array<{ data: RigaFascia[] | null }>;
  const primi = daNegozio.data ?? [];
  const poi = daCategoria.data ?? [];

  const negozi = await fetchSellerPublicMap(supa, [...primi, ...poi].map((p) => p.seller_id), COLONNE_NEGOZIO_IN_VETRINA);

  const raccolti = new Map<string, ProdottoSimile>();
  for (const p of [...primi, ...poi]) {
    if (raccolti.size >= 6) break;
    if (raccolti.has(p.id)) continue;
    const negozio = p.seller_id ? negozi.get(p.seller_id) : undefined;
    if (!negozioApprovato(negozio)) continue;
    raccolti.set(p.id, { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: negozioInFascia(negozio) });
  }
  return Array.from(raccolti.values());
}

// ─────────────────────────────── Sponsorizzati ─────────────────────────────

export type Sponsorizzato = {
  id: string;
  product_id: string;
  product: { id: string; name: string; price: number; images: string[] | null; profiles: NegozioInFascia | null } | null;
};

type RigaSponsorizzata = {
  id: string;
  product_id: string;
  product: (RigaFascia & { price: number | string }) | null;
};

/** Gli annunci attivi oggi per un posizionamento, solo di negozi approvati. */
export async function leggiSponsorizzati(
  supa: LettoreVista,
  { placement, categorySlug, oggi }: { placement: string; categorySlug?: string; oggi: string },
): Promise<Sponsorizzato[]> {
  // Legge la vista sponsored_active_public: l'annuncio senza i conti.
  // La tabella sponsored_listings porta anche daily_budget_cents,
  // spent_cents, impressions, clicks e stripe_session_id, ed era leggibile
  // da chiunque: i concorrenti vedevano quanto spendeva ogni negozio.
  let q = supa
    .from('sponsored_active_public')
    .select(`
          id, product_id,
          product:products ( id, name, price, images, seller_id )
        `)
    .eq('placement', placement)
    .lte('start_date', oggi)
    .gte('end_date', oggi)
    .limit(8);
  if (placement === 'category_top' && categorySlug) {
    q = q.eq('category_slug', categorySlug);
  }
  const { data } = await q;
  const righe = ((data ?? []) as RigaSponsorizzata[]).filter((it) => it.product);
  const negozi = await fetchSellerPublicMap(supa, righe.map((it) => it.product?.seller_id), COLONNE_NEGOZIO_IN_VETRINA);

  const fuori: Sponsorizzato[] = [];
  for (const it of righe) {
    const p = it.product!;
    const negozio = p.seller_id ? negozi.get(p.seller_id) : undefined;
    if (!negozioApprovato(negozio)) continue;
    fuori.push({
      id: it.id,
      product_id: it.product_id,
      product: { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: negozioInFascia(negozio) },
    });
  }
  return fuori;
}

// ─────────────────────────── «Completa con» (carrello) ─────────────────────

export type SuggerimentoCarrello = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  seller_id: string | null;
  has_variants: boolean | null;
  stock: number | null;
  profiles: NegozioInFascia | null;
};

/** Prodotti degli stessi negozi del carrello che si possono davvero aggiungere col «+». */
export async function leggiSuggerimentiCarrello(
  supa: LettoreVista,
  { sellerIds, excludeIds }: { sellerIds: string[]; excludeIds: string[] },
): Promise<SuggerimentoCarrello[]> {
  const { data, error } = await supa
    .from('products')
    .select('id, name, price, images, seller_id, has_variants, stock')
    .in('seller_id', sellerIds)
    .eq('status', 'available')
    .limit(24);
  // L'errore non si ingoia: senza questa riga la lettura non FALLISCE mai — torna «riuscita»
  // con la lista vuota, la striscia sparisce in silenzio e nessuno sa perché.
  if (error) throw error;
  const rows = (data ?? []) as Array<Omit<SuggerimentoCarrello, 'profiles'>>;
  const inCart = new Set(excludeIds);
  // Qui si propone solo ciò che si può davvero comprare col «+».
  //
  // · con varianti → fuori: l'upsell aggiunge l'articolo SENZA scegliere l'opzione, e la riga
  //   arriva rotta al checkout. Per quelli serve passare dalla scheda prodotto.
  // · finiti → fuori. `status = 'available'` NON vuol dire «ce n'è»: la giacenza è una colonna a
  //   parte, e nessun automatismo porta lo status a 'out_of_stock' quando arriva a zero.
  //   `stock === null` vuol dire «non tenuta»: quello resta, perché non è un prodotto finito.
  // · di un negozio non approvato → fuori (lo dice la vista pubblica, non `profiles`).
  const candidati = rows
    .filter((p) => !inCart.has(p.id) && !p.has_variants)
    .filter((p) => p.stock === null || p.stock === undefined || p.stock > 0);
  const approvati = await conNegozioApprovato(supa, candidati, COLONNE_NEGOZIO_IN_VETRINA);
  return approvati.slice(0, 8).map((p) => ({ ...p, price: Number(p.price), profiles: negozioInFascia(p.profiles) }));
}

// ──────────────────────── «Spesso comprati insieme» ────────────────────────

export type CompratoInsieme = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  stock: number | null;
  has_variants: boolean | null;
  seller_id: string | null;
};

/**
 * Gli altri prodotti disponibili dello stesso negozio, i piu' recenti, massimo 4.
 *
 * 15/10/2026 (R3, secondo giro) — Il gemello rimasto sulla scheda prodotto. La
 * fascia agganciava il negozio a `profiles` con `!inner` e teneva solo
 * `profiles.is_approved`: dopo la migrazione 161, per ogni cliente l'aggancio
 * torna vuoto e `!inner` butta via tutte le righe. La fascia spariva, senza un
 * errore. Adesso il negozio lo dice la vista pubblica, come per le altre fasce.
 */
export async function leggiSpessoCompratiInsieme(
  supa: LettoreVista,
  { productId, sellerId }: { productId: string; sellerId: string },
): Promise<CompratoInsieme[]> {
  const { data } = await supa
    .from('products')
    .select('id, name, price, images, stock, has_variants, seller_id')
    .eq('seller_id', sellerId)
    .eq('status', 'available')
    .neq('id', productId)
    .order('created_at', { ascending: false })
    .limit(4);
  const approvati = await conNegozioApprovato(
    supa,
    (data ?? []) as Array<Omit<CompratoInsieme, 'price'> & { price: number | string }>,
    COLONNE_NEGOZIO_IN_VETRINA,
  );
  return approvati.map((p) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    images: p.images,
    stock: p.stock,
    has_variants: p.has_variants,
    seller_id: p.seller_id,
  }));
}

// ─────────────────────────────── «Ultimi visti» ────────────────────────────

export type VistoDiRecente = {
  viewed_at: string;
  product: { id: string; name: string; price: number; images: string[] | null; profiles: NegozioInFascia | null };
};

/** Gli ultimi prodotti visti da chi ha l'account, solo di negozi approvati. */
export async function leggiVistiDiRecente(
  supa: LettoreVista,
  { userId, excludeId }: { userId: string; excludeId?: string },
): Promise<VistoDiRecente[]> {
  const { data } = await supa
    .from('recently_viewed')
    .select(`
          viewed_at,
          product:products!recently_viewed_product_id_fkey ( id, name, price, images, seller_id )
        `)
    .eq('user_id', userId)
    .order('viewed_at', { ascending: false })
    .limit(12);
  const righe = ((data ?? []) as Array<{ viewed_at: string; product: RigaFascia | null }>).filter(
    (it) => it.product && it.product.id !== excludeId,
  );
  const negozi = await fetchSellerPublicMap(supa, righe.map((it) => it.product?.seller_id), COLONNE_NEGOZIO_IN_VETRINA);

  const fuori: VistoDiRecente[] = [];
  for (const it of righe) {
    const p = it.product!;
    const negozio = p.seller_id ? negozi.get(p.seller_id) : undefined;
    if (!negozioApprovato(negozio)) continue;
    fuori.push({
      viewed_at: it.viewed_at,
      product: { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: negozioInFascia(negozio) },
    });
  }
  return fuori;
}
