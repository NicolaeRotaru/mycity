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
  client: CouponDbClient = supabase,
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
    const { count } = await client
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
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
