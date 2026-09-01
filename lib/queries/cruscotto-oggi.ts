import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiTutteLeRighe } from '@/lib/supabase/blocchi';
import type { ColonneSalvo } from '@/lib/db-rows';

/**
 * IL CRUSCOTTO «OGGI» DELL'AMMINISTRAZIONE — la pagina che si apre per prima
 * la mattina.
 *
 * 27/8/2026 (R162) — TRE DIFETTI NELLA STESSA MANCIATA DI LETTURE.
 *
 * ① UNO ZERO CHE VOLEVA DIRE «NON HO LETTO». Otto letture partivano insieme e
 *   nessuna guardava se fosse andata a buon fine: i risultati si prendevano con
 *   `?? []` e `?? 0`. Una lettura caduta arrivava a schermo come «zero ordini,
 *   zero incasso, zero iscritti», identica a una giornata in cui non ha
 *   comprato nessuno. Chi guarda ci crede — e le due conclusioni possibili sono
 *   opposte: correre a cercare un guasto che non c'è, o stare tranquilli mentre
 *   qualcosa è rotto davvero. La stessa pagina Funnel questo difetto lo aveva
 *   già dichiarato e riparato; qui no.
 *
 * ② UN TETTO A MILLE CHE NESSUNO AVEVA SCRITTO. PostgREST risponde con al
 *   massimo mille righe anche quando nessuno chiede un limite. Le tre letture
 *   degli ordini contavano le righe ricevute, quindi dal millesimo ordine della
 *   giornata in poi «Ordini oggi» e «GMV oggi» avrebbero smesso di salire, in
 *   silenzio: il momento in cui il difetto morde è esattamente quello in cui
 *   quei numeri cominciano a contare. Adesso i conteggi li fa il database
 *   (`count: 'exact', head: true` — nessuna riga viaggia) e le righe che
 *   servono davvero per l'incasso si leggono a finestre. Se anche le finestre
 *   finiscono, il risultato lo DICE con `campione`, invece di far finta di
 *   essere il totale.
 *
 * ③ GLI ORDINI FERMI CONTATI DA SEMPRE. «Ordini in problema» (NEW o ACCEPTED da
 *   più di quattro ore) non aveva nessun limite indietro nel tempo: sommava gli
 *   ordini rimasti impigliati mesi fa a quelli di stamattina. La riga rossa
 *   diceva un numero che non era il lavoro di oggi, e quindi non era il lavoro
 *   di nessuno.
 *
 * Sta in un file suo, e non dentro la pagina, perché così una prova la può
 * ESEGUIRE: in questa repo un `.tsx` non si monta facilmente, e una lettura che
 * nessuno può eseguire è una lettura che nessuno può provare.
 */

/** Da quante ore un ordine ancora NEW o ACCEPTED si chiama «fermo». */
export const ORE_PRIMA_DI_CHIAMARLO_FERMO = 4;

/**
 * Quanto indietro si guarda per gli ordini fermi. Una settimana: oltre, non è
 * più il lavoro di oggi ed è una pulizia dello storico, che si fa altrove.
 */
export const GIORNI_DI_ORDINI_FERMI = 7;

/** Le colonne, ancorate allo schema: se una sparisce, il typecheck se ne accorge. */
type RigaOggi = ColonneSalvo<'orders', 'id' | 'total_price' | 'delivery_status', {
  total_price: number | string | null;
  delivery_status: string;
}>;

export type OrdineRecente = ColonneSalvo<
  'orders',
  'id' | 'total_price' | 'delivery_status' | 'created_at' | 'delivery_full_name',
  {
    total_price: number | string | null;
    delivery_status: string;
    created_at: string;
  }
> & { seller: { store_name: string | null } | null };

export type CruscottoOggi = {
  ordersTodayCount: number;
  gmvToday: number;
  deliveredToday: number;
  ordersPendingCount: number;
  ordersProblemCount: number;
  sellersPendingCount: number;
  sosActiveCount: number;
  disputesOpenCount: number;
  signupsTodayCount: number;
  recentOrders: OrdineRecente[];
  /**
   * `true` quando gli ordini della giornata hanno sfondato il tetto duro della
   * lettura a finestre: incasso e consegnati sono un campione, non il totale, e
   * la pagina deve scriverlo accanto al numero.
   */
  campione: boolean;
};

type Esito = { error: { message?: string } | null };

/**
 * Una lettura caduta si ferma qui e risale come errore. Non esiste un ramo in
 * cui il guasto diventa uno zero: è il difetto ① e va tolto alla radice, non
 * gestito a valle.
 */
function seRotta(esito: Esito, cosa: string): void {
  if (esito.error) {
    const dettaglio = esito.error.message ? `: ${esito.error.message}` : '';
    throw new Error(`Non sono riuscito a leggere ${cosa}${dettaglio}`);
  }
}

export async function leggiCruscottoOggi(
  supabase: SupabaseClient,
  adesso: Date = new Date(),
): Promise<CruscottoOggi> {
  const todayStart = new Date(adesso);
  todayStart.setHours(0, 0, 0, 0);
  const inizioOggi = todayStart.toISOString();
  const fermoDa = new Date(adesso.getTime() - ORE_PRIMA_DI_CHIAMARLO_FERMO * 60 * 60_000).toISOString();
  const nonPrimaDi = new Date(adesso.getTime() - GIORNI_DI_ORDINI_FERMI * 86_400_000).toISOString();

  const [
    ordersToday,
    ordersPending,
    ordersProblem,
    sellersPending,
    sosActive,
    disputesOpen,
    signupsToday,
    recentOrders,
  ] = await Promise.all([
    // Le righe servono per davvero — l'incasso si somma riga per riga — quindi
    // si leggono a finestre invece di prendere le prime mille e tacere.
    leggiTutteLeRighe<RigaOggi>((da, a) =>
      supabase
        .from('orders')
        .select('id, total_price, delivery_status')
        .gte('created_at', inizioOggi)
        .order('created_at', { ascending: true })
        .range(da, a) as unknown as PromiseLike<{ data: RigaOggi[] | null; error: { message?: string } | null }>,
    ),
    // Questi sono conteggi e basta: li fa il database, e nessuna riga viaggia.
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .eq('delivery_status', 'NEW').gte('created_at', inizioOggi),
    supabase.from('orders').select('id', { count: 'exact', head: true })
      .in('delivery_status', ['NEW', 'ACCEPTED'])
      .gte('created_at', nonPrimaDi)
      .lt('created_at', fermoDa),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'seller').eq('is_approved', false),
    supabase.from('rider_sos_events').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    supabase.from('disputes').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', inizioOggi),
    supabase.from('orders')
      .select('id, total_price, delivery_status, created_at, delivery_full_name, seller:profiles!orders_seller_id_fkey ( store_name )')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  seRotta(ordersToday, 'gli ordini di oggi');
  seRotta(ordersPending, 'gli ordini ancora da accettare');
  seRotta(ordersProblem, 'gli ordini fermi');
  seRotta(sellersPending, 'i venditori in attesa di approvazione');
  seRotta(sosActive, 'le richieste di aiuto dei fattorini');
  seRotta(disputesOpen, 'i reclami aperti');
  seRotta(signupsToday, 'i nuovi iscritti di oggi');
  seRotta(recentOrders, 'gli ultimi ordini');

  const todayOrders = ordersToday.data;
  const todayGmv = todayOrders
    .filter((o) => o.delivery_status !== 'CANCELED')
    .reduce((s, o) => s + Number(o.total_price ?? 0), 0);
  const todayDelivered = todayOrders.filter((o) => o.delivery_status === 'DELIVERED').length;

  return {
    ordersTodayCount: todayOrders.length,
    gmvToday: todayGmv,
    deliveredToday: todayDelivered,
    ordersPendingCount: ordersPending.count ?? 0,
    ordersProblemCount: ordersProblem.count ?? 0,
    sellersPendingCount: sellersPending.count ?? 0,
    sosActiveCount: sosActive.count ?? 0,
    disputesOpenCount: disputesOpen.count ?? 0,
    signupsTodayCount: signupsToday.count ?? 0,
    recentOrders: (recentOrders.data ?? []) as unknown as OrdineRecente[],
    campione: ordersToday.troncato,
  };
}
