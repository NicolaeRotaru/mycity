/**
 * UN FINTO POSTGREST CHE RISPONDE COME RISPONDE A CHI GUARDA.
 *
 * 15/10/2026 (R3) — Nato per una domanda sola: «la vetrina si vede ancora quando la tabella dei
 * profili si chiude?». Il finto PostgREST di `finto-postgrest.ts` applica i filtri ma restituisce le
 * righe a tutti, e non conosce gli agganci (`profiles!products_seller_id_fkey ( … )`): con lui il
 * difetto non si poteva nemmeno mettere in scena. Questo fa le quattro cose che servono:
 *
 *  ① LE REGOLE DI LETTURA PER CHI GUARDA. Chi guarda e' un estraneo (`null`) o un utente. Su
 *    `profiles` vede la propria riga e, solo nel mondo di oggi in produzione, anche i negozi
 *    approvati (la regola «Anyone can view approved seller profiles», che la migrazione 161 toglie).
 *    Su `products` vede quelli disponibili di un negozio approvato, piu' i propri.
 *  ② LA VISTA PUBBLICA COI PERMESSI DI CHI L'HA CREATA. `seller_public_profiles` legge `profiles`
 *    per intero e mostra solo i negozi approvati con un'insegna: come la vista vera (migrazioni 124 e
 *    126, `security_invoker` mai acceso — migrazione 152).
 *  ③ GLI AGGANCI LETTI COI PERMESSI DI CHI GUARDA. Un aggancio a una riga che chi guarda non puo'
 *    leggere torna `null`; con `!inner` la riga madre sparisce. E' esattamente il modo in cui
 *    PostgREST li esegue (un LEFT JOIN LATERAL sotto le regole del chiamante).
 *  ④ UNA COLONNA CHE NON ESISTE FA FALLIRE TUTTA LA DOMANDA, col codice 42703, come il database
 *    vero. Nel mondo di oggi la vista NON ha le colonne d'impresa della migrazione 126.
 */

export type Riga = Record<string, unknown>;

export type Mondo = {
  /** La regola che lascia leggere a tutti i negozi approvati su `profiles`: viva oggi, tolta dalla 161. */
  profiliApertiAgliEstranei: boolean;
  /** La vista ha ragione sociale, forma, partita IVA e sede (migrazione 126). */
  vistaCon126: boolean;
  /**
   * Variante scomoda: un prodotto di un negozio NON approvato si legge lo stesso (una regola sui
   * prodotti piu' larga del dovuto). Serve a provare che il filtro del codice regge da solo.
   */
  prodottiDeiNonApprovatiVisibili?: boolean;
};

/** Oggi in produzione: la 161 e la 126 non sono applicate. */
export const OGGI: Mondo = { profiliApertiAgliEstranei: true, vistaCon126: false };
/** Dopo che Nicola applica le migrazioni mancanti, 126 e 161 comprese. */
export const DOPO_LA_161: Mondo = { profiliApertiAgliEstranei: false, vistaCon126: true };
/** Il mondo piu' stretto: profili chiusi e vista ancora senza le colonne d'impresa. */
export const PROFILI_CHIUSI_VISTA_VECCHIA: Mondo = { profiliApertiAgliEstranei: false, vistaCon126: false };

/** Le colonne della vista in produzione, misurate l'11/10/2026 (radiografia, R55). */
export const COLONNE_VISTA_IN_PRODUZIONE = [
  'id', 'store_name', 'store_address', 'store_lat', 'store_lng', 'store_phone', 'store_logo',
  'store_hours', 'store_media', 'store_description', 'store_customization', 'store_site',
  'offers_express', 'founded_year', 'is_approved', 'stripe_charges_enabled', 'stripe_payouts_enabled',
  'role', 'created_at',
] as const;

const COLONNE_126 = [
  'business_legal_name', 'business_form', 'business_vat_number', 'business_address', 'business_city', 'business_zip',
];

const COLONNE: Record<string, string[]> = {
  profiles: [
    ...COLONNE_VISTA_IN_PRODUZIONE, ...COLONNE_126,
    'full_name', 'email', 'city', 'billing_iban', 'wallet_balance_cents', 'approval_status',
  ],
  products: [
    'id', 'name', 'description', 'price', 'images', 'seller_id', 'status', 'created_at', 'category_id',
    'stock', 'attributes', 'unit', 'compare_at_price', 'condition', 'express_enabled', 'has_variants',
    'external_source_url',
  ],
  categories: ['id', 'slug', 'name', 'parent_id', 'icon'],
  sponsored_active_public: ['id', 'product_id', 'placement', 'start_date', 'end_date', 'category_slug'],
  recently_viewed: ['user_id', 'product_id', 'viewed_at'],
};

/** Gli agganci che il database conosce: da quale tabella, con quale colonna, verso dove. */
const AGGANCI: Record<string, Record<string, { colonna: string; verso: string }>> = {
  products: {
    profiles: { colonna: 'seller_id', verso: 'profiles' },
    categories: { colonna: 'category_id', verso: 'categories' },
  },
  sponsored_active_public: { products: { colonna: 'product_id', verso: 'products' } },
  recently_viewed: { products: { colonna: 'product_id', verso: 'products' } },
};

export type Dati = Record<string, Riga[]>;

type Errore = { code: string; message: string };
class ErroreDb extends Error {
  constructor(readonly errore: Errore) {
    super(errore.message);
  }
}

type Voce =
  | { tipo: 'colonna'; nome: string }
  | { tipo: 'aggancio'; alias: string; relazione: string; interno: boolean; figli: Voce[] };

/** Divide una select di PostgREST nelle sue voci, rispettando le parentesi degli agganci. */
function leggiSelect(select: string): Voce[] {
  const pulita = select.replace(/\s+/g, ' ').trim();
  const pezzi: string[] = [];
  let profondita = 0;
  let corrente = '';
  for (const c of pulita) {
    if (c === '(') profondita += 1;
    if (c === ')') profondita -= 1;
    if (c === ',' && profondita === 0) {
      pezzi.push(corrente.trim());
      corrente = '';
    } else {
      corrente += c;
    }
  }
  if (corrente.trim()) pezzi.push(corrente.trim());

  return pezzi.map((pezzo): Voce => {
    const aperta = pezzo.indexOf('(');
    if (aperta < 0) return { tipo: 'colonna', nome: pezzo };
    const testa = pezzo.slice(0, aperta).trim();
    const dentro = pezzo.slice(aperta + 1, pezzo.lastIndexOf(')'));
    const [alias, resto] = testa.includes(':') ? testa.split(':') : [null, testa];
    const parti = resto.split('!').map((p) => p.trim());
    return {
      tipo: 'aggancio',
      alias: (alias ?? parti[0]).trim(),
      relazione: parti[0],
      interno: parti.includes('inner'),
      figli: leggiSelect(dentro),
    };
  });
}

type Filtro = { tipo: string; colonna: string; valore: unknown };

export function databaseCoiPermessi(dati: Dati, mondo: Mondo, chi: string | null, rpcs: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const profili = () => dati.profiles ?? [];

  /** La funzione del database `negozio_approvato`: gira coi permessi di chi l'ha creata. */
  const negozioApprovato = (id: unknown) =>
    profili().some((p) => p.id === id && p.role === 'seller' && p.is_approved === true);

  const colonneDi = (tabella: string): string[] => {
    if (tabella === 'seller_public_profiles') {
      return mondo.vistaCon126 ? [...COLONNE_VISTA_IN_PRODUZIONE, ...COLONNE_126] : [...COLONNE_VISTA_IN_PRODUZIONE];
    }
    return COLONNE[tabella] ?? Object.keys((dati[tabella] ?? [])[0] ?? {});
  };

  /** Le righe che chi guarda puo' leggere, tabella per tabella. */
  const visibili = (tabella: string): Riga[] => {
    if (tabella === 'profiles') {
      return profili().filter(
        (p) =>
          (chi !== null && p.id === chi) ||
          (mondo.profiliApertiAgliEstranei && p.is_approved === true && p.store_name != null),
      );
    }
    if (tabella === 'seller_public_profiles') {
      const colonne = colonneDi(tabella);
      return profili()
        .filter((p) => p.is_approved === true && p.store_name != null && p.role === 'seller')
        .map((p) => Object.fromEntries(colonne.map((c) => [c, p[c] ?? null])));
    }
    if (tabella === 'products') {
      return (dati.products ?? []).filter(
        (p) =>
          (p.status === 'available' && (negozioApprovato(p.seller_id) || mondo.prodottiDeiNonApprovatiVisibili === true)) ||
          (chi !== null && p.seller_id === chi),
      );
    }
    if (tabella === 'recently_viewed') return (dati.recently_viewed ?? []).filter((r) => chi !== null && r.user_id === chi);
    return dati[tabella] ?? [];
  };

  const controllaColonna = (tabella: string, colonna: string) => {
    if (colonna === '*') return;
    if (!colonneDi(tabella).includes(colonna)) {
      throw new ErroreDb({ code: '42703', message: `column ${tabella}.${colonna} does not exist` });
    }
  };

  /** Proietta una riga sulle voci della select, eseguendo gli agganci coi permessi di chi guarda. */
  const proietta = (tabella: string, riga: Riga, voci: Voce[]): Riga | null => {
    const fuori: Riga = {};
    for (const v of voci) {
      if (v.tipo === 'colonna') {
        controllaColonna(tabella, v.nome);
        if (v.nome === '*') for (const c of colonneDi(tabella)) fuori[c] = riga[c] ?? null;
        else fuori[v.nome] = riga[v.nome] ?? null;
        continue;
      }
      const aggancio = AGGANCI[tabella]?.[v.relazione];
      if (!aggancio) {
        throw new ErroreDb({ code: 'PGRST200', message: `Could not find a relationship between '${tabella}' and '${v.relazione}'` });
      }
      const bersaglio = visibili(aggancio.verso).find((r) => r.id === riga[aggancio.colonna]);
      const figlio = bersaglio ? proietta(aggancio.verso, bersaglio, v.figli) : null;
      if (v.interno && !figlio) return null;
      fuori[v.alias] = figlio;
    }
    return fuori;
  };

  const confronta = (riga: Riga, f: Filtro): boolean => {
    const v = riga[f.colonna];
    switch (f.tipo) {
      case 'eq': return v === f.valore;
      case 'neq': return v !== f.valore;
      case 'is': return (v ?? null) === (f.valore ?? null);
      case 'in': return (f.valore as unknown[]).includes(v);
      case 'lte': return String(v) <= String(f.valore);
      case 'gte': return String(v) >= String(f.valore);
      case 'ilike': {
        const re = new RegExp(`^${String(f.valore).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
        return re.test(String(v ?? ''));
      }
      default: throw new Error(`filtro ${f.tipo} non simulato`);
    }
  };

  class Domanda {
    private colonne = '*';
    private filtri: Filtro[] = [];
    private ordine: Array<{ colonna: string; crescente: boolean }> = [];
    private tetto: number | null = null;
    private modo: 'elenco' | 'una' | 'unaForse' = 'elenco';
    constructor(private readonly tabella: string) {}

    select(colonne = '*') { this.colonne = colonne; return this; }
    eq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'eq', colonna, valore }); return this; }
    neq(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'neq', colonna, valore }); return this; }
    is(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'is', colonna, valore }); return this; }
    in(colonna: string, valore: unknown[]) { this.filtri.push({ tipo: 'in', colonna, valore }); return this; }
    lte(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'lte', colonna, valore }); return this; }
    gte(colonna: string, valore: unknown) { this.filtri.push({ tipo: 'gte', colonna, valore }); return this; }
    ilike(colonna: string, valore: string) { this.filtri.push({ tipo: 'ilike', colonna, valore }); return this; }
    order(colonna: string, o?: { ascending?: boolean }) { this.ordine.push({ colonna, crescente: o?.ascending !== false }); return this; }
    limit(n: number) { this.tetto = n; return this; }
    single() { this.modo = 'una'; return this; }
    maybeSingle() { this.modo = 'unaForse'; return this; }

    private esegui(): { data: unknown; error: Errore | null } {
      try {
        const voci = leggiSelect(this.colonne);
        let righe = [...visibili(this.tabella)];
        // Filtri sulle colonne della tabella; quelli sugli agganci («profiles.is_approved»)
        // filtrano l'aggancio, e con `!inner` anche la riga madre.
        const sullaTabella = this.filtri.filter((f) => !f.colonna.includes('.'));
        const sugliAgganci = this.filtri.filter((f) => f.colonna.includes('.'));
        for (const f of sullaTabella) {
          controllaColonna(this.tabella, f.colonna);
          righe = righe.filter((r) => confronta(r, f));
        }
        for (const o of [...this.ordine].reverse()) {
          righe.sort((a, b) => {
            const cmp = String(a[o.colonna]) === String(b[o.colonna]) ? 0 : String(a[o.colonna]) < String(b[o.colonna]) ? -1 : 1;
            return o.crescente ? cmp : -cmp;
          });
        }
        let proiettate = righe.map((r) => proietta(this.tabella, r, voci)).filter((r): r is Riga => r !== null);
        for (const f of sugliAgganci) {
          const [alias, colonna] = f.colonna.split('.');
          const voce = voci.find((v) => v.tipo === 'aggancio' && v.alias === alias) as Extract<Voce, { tipo: 'aggancio' }> | undefined;
          proiettate = proiettate.flatMap((r) => {
            const figlio = r[alias] as Riga | null;
            const tiene = figlio !== null && confronta(figlio, { ...f, colonna });
            if (tiene) return [r];
            if (voce?.interno) return [];
            return [{ ...r, [alias]: null }];
          });
        }
        if (this.tetto !== null) proiettate = proiettate.slice(0, this.tetto);
        if (this.modo === 'elenco') return { data: proiettate, error: null };
        if (proiettate.length > 1) return { data: null, error: { code: 'PGRST116', message: 'more than one row' } };
        if (proiettate.length === 0 && this.modo === 'una') {
          return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        }
        return { data: proiettate[0] ?? null, error: null };
      } catch (e) {
        if (e instanceof ErroreDb) return { data: null, error: e.errore };
        throw e;
      }
    }

    then<T>(risolvi: (r: { data: unknown; error: Errore | null }) => T, rifiuta?: (e: unknown) => T) {
      try {
        return Promise.resolve(risolvi(this.esegui()));
      } catch (e) {
        return rifiuta ? Promise.resolve(rifiuta(e)) : Promise.reject(e);
      }
    }
  }

  /** `search_products_smart` come nel database: prodotti visibili, negozio approvato, nome dalla vista. */
  const cercaProdotti = ({ q, lim }: Record<string, unknown>) => {
    const vetrina = visibili('seller_public_profiles');
    const termine = String(q ?? '').toLowerCase();
    return visibili('products')
      .filter((p) => p.status === 'available' && negozioApprovato(p.seller_id))
      .filter((p) => String(p.name).toLowerCase().split(/\s+/).includes(termine))
      .slice(0, Number(lim ?? 10))
      .map((p) => ({
        id: p.id, name: p.name, price: p.price, images: p.images, seller_id: p.seller_id,
        store_name: vetrina.find((v) => v.id === p.seller_id)?.store_name ?? null,
      }));
  };

  const letture: string[] = [];
  return {
    letture,
    client: {
      from: (tabella: string) => {
        letture.push(tabella);
        return new Domanda(tabella);
      },
      rpc: async (nome: string, argomenti: Record<string, unknown> = {}) => {
        if (rpcs[nome]) return { data: rpcs[nome](argomenti), error: null };
        if (nome === 'search_products_smart') return { data: cercaProdotti(argomenti), error: null };
        if (nome === 'trending_product_ids_24h') return { data: [], error: null };
        return { data: null, error: { code: '42883', message: `function ${nome} does not exist` } };
      },
    },
  };
}
