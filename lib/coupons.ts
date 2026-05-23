import { supabase } from './supabase/client';

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

export async function validateCoupon(
  code: string,
  subtotal: number,
  userId: string | null,
): Promise<CouponValidation> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return { ok: false, reason: 'Inserisci un codice' };

  const { data: coupon, error } = await supabase
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
    const { count } = await supabase
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
