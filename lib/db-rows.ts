import type { Database } from '@/lib/database.types';

/**
 * 30/8/2026 (R004) — I TIPI DEL DATABASE C'ERANO, E NESSUNO LI GUARDAVA.
 *
 * `lib/database.types.ts` sono quasi tremila righe generate leggendo le
 * migrazioni: la forma vera di ogni tabella. Fino a oggi le importavano soltanto
 * due prove. In tutto il resto del sito la forma delle righe veniva riscritta a
 * mano — `type Row = { … }` — e ogni `.from('orders').select(…)` torna `any`.
 * Conseguenza: una colonna che sparisce dallo schema, o un nome scritto male, non
 * si vede a compilazione. Si vede in produzione, sui percorsi dei soldi: e'
 * successo con `orders.buyer_id`, una colonna che su quella tabella non esiste,
 * e l'esportazione dei dati usciva senza gli ordini dicendo che era andato bene.
 *
 * Tipizzare i client Supabase tutti insieme oggi non si puo': ho provato, e sono
 * 310 errori — i tipi generati vengono dalle migrazioni, non dal database vivo, e
 * su nullabilita' e relazioni sono imprecisi. Non e' un lavoro da fare di corsa
 * sopra i pagamenti.
 *
 * Questa e' l'altra strada, un pezzo per volta: le pagine smettono di inventarsi
 * la forma delle righe e la DERIVANO da qui. Il nome della colonna diventa una
 * cosa che il compilatore controlla: se domani sparisce dallo schema,
 * `npm run typecheck` diventa rosso invece di restare verde.
 */
export type Tabelle = Database['public']['Tables'];

/** La riga completa di una tabella, come esce dal database. */
export type Riga<T extends keyof Tabelle> = Tabelle[T]['Row'];

/**
 * Le sole colonne che una query chiede davvero.
 * `Colonne<'orders', 'id' | 'total_price'>` non compila se una delle due non
 * esiste piu' su `orders`.
 */
export type Colonne<T extends keyof Tabelle, K extends keyof Riga<T>> = Pick<Riga<T>, K>;

/**
 * Come `Colonne`, ma con qualche colonna ri-dichiarata.
 *
 * Serve perche' i tipi generati vengono dalle migrazioni e non dal database
 * vivo: dicono `Json` dove il codice sa che c'e' un elenco di indirizzi di
 * foto, e dicono «puo' essere nullo» su colonne che la query filtra gia'. Le
 * ri-dichiarazioni restano scritte nero su bianco nella pagina — e il nome
 * della colonna resta comunque controllato, perche' deve essere una di quelle
 * chieste.
 */
export type ColonneSalvo<
  T extends keyof Tabelle,
  K extends keyof Riga<T>,
  R extends Partial<Record<K & string, unknown>>,
> = Omit<Colonne<T, K>, keyof R> & R;
