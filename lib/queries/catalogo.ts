/**
 * LE DOMANDE DEL CATALOGO, SCRITTE UNA VOLTA SOLA.
 *
 * 30/8/2026 (R068) — LA HOME E LA SCHEDA PRODOTTO ARRIVAVANO VUOTE.
 *
 * Il documento che il telefono riceveva non conteneva niente: ne' le categorie
 * della home, ne' il nome e il prezzo del prodotto. Tutto lo andava a prendere
 * il browser DOPO, e solo dopo aver scaricato ed eseguito il JavaScript. La
 * catena fino alla prima immagine era: scarica il codice → eseguilo → chiedi i
 * dati → chiedi la foto. Su un telefono in 4G sono secondi di pagina bianca
 * sulle due pagine che fanno vendere.
 *
 * La cura e' precaricare sul server e consegnare i dati DENTRO la pagina, cosi'
 * il browser li trova gia' pronti e non chiede niente. Perche' funzioni, la
 * domanda che fa il server e quella che fa il browser devono essere la STESSA:
 * stessa chiave di cache e stessa forma della risposta. Se differiscono anche
 * solo di una lettera nella chiave, il browser non riconosce quello che ha in
 * mano e va in rete lo stesso — cioe' il lavoro del server non serve a niente e
 * nessuno se ne accorge.
 *
 * Per questo la domanda vive qui, in un file solo, e il client che la esegue
 * arriva da fuori: nel browser e' quello anonimo con la sessione, sul server
 * quello di lettura pubblica.
 */
import { queryKeys } from '@/lib/queries/keys';

/** Il minimo che serve per fare una lettura: vale per il client del browser e per quello del server. */
export type ClientDiLettura = {
  // I client Supabase hanno tipi generati diversi fra browser e server: qui
  // serve solo la forma della chiamata.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (tabella: string) => any;
};

export type CategoriaDiTesta = {
  id: string; slug: string; name: string; icon: string | null;
  sort_order?: number | null; featured?: boolean | null;
};

/** La scheda prodotto come la usa la pagina del prodotto (#97: colonne per nome). */
export type SchedaProdotto = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  images: string[] | null;
  seller_id: string;
  status: string | null;
  created_at: string | null;
  category_id: string | null;
  stock: number | null;
  attributes: Record<string, unknown> | null;
  unit: string | null;
  compare_at_price: number | string | null;
  condition: string | null;
  express_enabled: boolean | null;
  has_variants: boolean | null;
  external_source_url: string | null;
  categories: { slug: string | null; name: string | null } | null;
  profiles: { id: string; store_name: string | null; is_approved: boolean | null; offers_express: boolean | null; store_hours: unknown } | null;
};

/** Le colonne della scheda prodotto: elencate per nome, mai `*` (#97). */
export const COLONNE_SCHEDA_PRODOTTO = `
        id, name, description, price, images, seller_id, status, created_at, category_id,
        stock, attributes, unit, compare_at_price, condition, express_enabled, has_variants,
        external_source_url,
        categories ( slug, name ), profiles!products_seller_id_fkey ( id, store_name, is_approved, offers_express, store_hours )
      `;

/**
 * Le categorie principali: la prima cosa che si vede scorrendo la home.
 *
 * `select('*')` e' voluto: e' resistente alle colonne `sort_order`/`featured`
 * (migrazione 076): se non ci sono ancora, l'ordinamento ricade sul nome.
 */
export function domandaCategorie(supa: ClientDiLettura) {
  return {
    queryKey: queryKeys.categories.all,
    queryFn: async (): Promise<CategoriaDiTesta[]> => {
      const { data, error } = await supa.from('categories').select('*').is('parent_id', null);
      if (error) throw error;
      const righe = (data ?? []) as CategoriaDiTesta[];
      righe.sort((a, b) =>
        ((b.featured ? 1 : 0) - (a.featured ? 1 : 0)) ||
        ((a.sort_order ?? 9999) - (b.sort_order ?? 9999)) ||
        a.name.localeCompare(b.name),
      );
      return righe;
    },
  };
}

/**
 * La scheda di un prodotto.
 *
 * `maybeSingle()` e non `single()`: «non c'e'» e «non riesco a leggerlo» sono
 * due cose diverse, e con `single()` un prodotto cancellato diventava un errore
 * di rete con un pulsante «Riprova» che non poteva funzionare.
 */
export function domandaProdotto(supa: ClientDiLettura, id: string) {
  return {
    queryKey: queryKeys.products.detail(id),
    queryFn: async (): Promise<SchedaProdotto | null> => {
      const { data, error } = await supa
        .from('products')
        .select(COLONNE_SCHEDA_PRODOTTO)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      // Il collegamento a categoria e negozio e' uno a uno: PostgREST lo
      // restituisce come oggetto, ma con le colonne elencate per nome i tipi
      // generati lo descrivono come elenco. Si dichiara la forma vera.
      return data as unknown as SchedaProdotto;
    },
  };
}
