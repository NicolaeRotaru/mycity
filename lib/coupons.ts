// L'import resta, ma serve a UNA funzione sola: `validateCouponFromBrowser`,
// che è la strada del browser e il singleton del browser lo vuole per davvero.
// Quello che è sparito è il valore di ripiego su `validateCoupon`, dove il
// singleton finiva dentro un processo server senza che nessuno lo chiedesse.
import { supabase } from './supabase/client';

/**
 * Client Supabase minimale richiesto da validateCoupon. Sia il browser client
 * (`@/lib/supabase/client`) sia il server client (`getServerSupabase()`)
 * soddisfano questa forma, così la stessa validazione gira identica nei due lati.
 */
type CouponDbClient = {
  from: (table: string) => any;
};

export type Coupon = {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED' | 'FREE_SHIPPING';
  value: number;
  min_subtotal: number;
  max_uses: number | null;
  uses_count: number;
  first_order_only: boolean;
  expires_at: string | null;
  active: boolean;
  description: string | null;
};

export type CouponValidation =
  | { ok: true; coupon: Coupon; discount: number; freeShipping: boolean }
  | { ok: false; reason: string };

/**
 * Valida un coupon e ne calcola lo sconto. SICUREZZA: deve essere eseguita
 * lato server prima di addebitare (vedi /api/stripe/checkout). Il valore di
 * sconto NON va mai accettato dal client: si ricalcola sempre qui dal coupon
 * reale. Il parametro `client` consente di passare il server client.
 */
export async function validateCoupon(
  code: string,
  subtotal: number,
  userId: string | null,
  // 22/8/2026 — QUESTO PARAMETRO AVEVA UN VALORE DI RIPIEGO, ED ERA IL CLIENT
  // DEL BROWSER.
  //
  // `import { supabase } from './supabase/client'` è il singleton di un modulo
  // marcato `'use client'`: una variabile condivisa da tutte le richieste che
  // arrivano allo stesso processo Node. Oggi tutte e due le rotte passano il
  // loro client, quindi il ripiego non scattava mai — ma era un innesco armato
  // su una strada dove passano i soldi: chiamare `validateCoupon(code, subtotal,
  // userId)` con tre argomenti era una firma legittima che il compilatore
  // accettava in silenzio, e sarebbe finita su un client anonimo senza sessione.
  //
  // Adesso il quarto argomento è obbligatorio: chi lo dimentica lo scopre dal
  // controllo dei tipi, non da un buono applicato alla persona sbagliata.
  client: CouponDbClient,
): Promise<CouponValidation> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { ok: false, reason: 'Inserisci un codice' };

  const { data: coupon, error } = await client
    .from('coupons')
    .select('*')
    .eq('code', trimmed)
    .eq('active', true)
    .maybeSingle();

  if (error || !coupon) return { ok: false, reason: 'Codice non valido' };

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { ok: false, reason: 'Codice scaduto' };
  }
  if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
    return { ok: false, reason: 'Codice esaurito' };
  }
  if (subtotal < Number(coupon.min_subtotal)) {
    return {
      ok: false,
      reason: `Spesa minima richiesta: €${Number(coupon.min_subtotal).toFixed(2)}`,
    };
  }
  if (coupon.first_order_only) {
    if (!userId) return { ok: false, reason: 'Devi accedere per usare questo codice' };
    // 3/9/2026 — «PRIMO ORDINE» NON VUOL DIRE «ESISTE UNA RIGA IN orders».
    //
    // Qui si contavano TUTTE le righe di quell'utente, senza guardare come
    // erano andate a finire. Lunedì Maria ordina con BENVENUTO10, il fornaio
    // rifiuta perché il pane è finito; il sistema le scrive «Il codice sconto
    // BENVENUTO10 torna utilizzabile» e glielo restituisce davvero. Martedì
    // Maria riprova e la cassa risponde «Codice valido solo al primo ordine»:
    // l'ordine annullato contava come primo ordine. Vale anche per l'annullo
    // del cliente e per l'ordine in contanti scaduto dal giro automatico.
    //
    // È il buono di benvenuto, cioè la leva che serve a far fare il primo
    // acquisto: si perdeva proprio al primo intoppo, e dopo una promessa
    // scritta del contrario.
    //
    // Contano solo gli ordini andati a buon fine: fuori gli annullati e quelli
    // col pagamento fallito. Un ordine consegnato e poi RIMBORSATO resta
    // dentro: la merce è arrivata, quel primo acquisto c'è stato — escluderlo
    // aprirebbe la porta a «compro, mi faccio rimborsare, riuso il buono».
    //
    // ⚠️ La stessa regola vive nella funzione `check_coupon` del database, che
    // è quella che risponde al carrello nel browser. Finché la migrazione
    // gemella non è applicata, la cassa accetta il codice ma il carrello lo
    // rifiuta ancora: le due copie vanno cambiate insieme.
    const { count } = await client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('delivery_status', 'CANCELED')
      .neq('payment_status', 'FAILED');
    if ((count ?? 0) > 0) {
      return { ok: false, reason: 'Codice valido solo al primo ordine' };
    }
  }

  let discount = 0;
  let freeShipping = false;
  if (coupon.type === 'PERCENT') {
    discount = Math.round(subtotal * (Number(coupon.value) / 100) * 100) / 100;
  } else if (coupon.type === 'FIXED') {
    discount = Math.min(subtotal, Number(coupon.value));
  } else if (coupon.type === 'FREE_SHIPPING') {
    freeShipping = true;
  }

  return { ok: true, coupon, discount, freeShipping };
}

/**
 * Valida un codice DAL BROWSER, passando dalla funzione `check_coupon` del
 * database invece di leggere la tabella coupons.
 *
 * Perché non si legge più la tabella: la policy di lettura era `active = true`
 * per tutti, e il ruolo anonimo aveva il permesso di SELECT. Una sola chiamata
 * con la chiave pubblica del browser — che sta nel bundle, quindi la ha
 * chiunque — scaricava l'elenco completo dei codici attivi con valore, soglia
 * minima e scadenza. La funzione risponde solo «vale / non vale» e, se vale,
 * quanto sconto: nessun elenco da sfogliare.
 *
 * I percorsi server (/api/stripe/checkout e /api/orders/cod) continuano a usare
 * validateCoupon con il client di servizio: lì la lettura diretta serve e non è
 * esposta a nessuno.
 */
export async function validateCouponFromBrowser(
  code: string,
  subtotal: number,
): Promise<CouponValidation> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { ok: false, reason: 'Inserisci un codice' };

  const { data, error } = await supabase.rpc('check_coupon', {
    p_code: trimmed,
    p_subtotal: subtotal,
  });

  if (error || !data) return { ok: false, reason: 'Codice non valido' };

  const res = data as {
    ok: boolean;
    reason?: string;
    discount?: number;
    freeShipping?: boolean;
    coupon?: Partial<Coupon>;
  };

  if (!res.ok || !res.coupon) return { ok: false, reason: res.reason ?? 'Codice non valido' };

  return {
    ok: true,
    // La funzione restituisce i soli campi che servono a mostrare il codice
    // applicato; il calcolo dello sconto resta comunque rifatto lato server
    // prima di addebitare.
    coupon: res.coupon as Coupon,
    discount: Number(res.discount ?? 0),
    freeShipping: Boolean(res.freeShipping),
  };
}
