'use client';

import { formatPrice } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import type { Coupon } from '@/lib/coupons';

/**
 * Coupon input form per checkout. Mostra stato applicato o input field.
 * Estratto da app/checkout/page.tsx — controlled component.
 */

type Props = {
  couponCode: string;
  appliedCoupon: { coupon: Coupon; discount: number; freeShipping: boolean } | null;
  couponError: string | null;
  onCodeChange: (code: string) => void;
  onApply: () => void;
  onRemove: () => void;
};

export function CouponInput({
  couponCode,
  appliedCoupon,
  couponError,
  onCodeChange,
  onApply,
  onRemove,
}: Props) {
  return (
    <div className="px-5 py-3 border-t bg-cream-50/50">
      {appliedCoupon ? (
        <div className="flex items-center justify-between bg-olive-50 border border-olive-200 rounded px-3 py-2 text-sm">
          <span className="text-olive-800">
            ✓ <strong>{appliedCoupon.coupon.code}</strong> applicato (−{formatPrice(appliedCoupon.discount)})
          </span>
          <button
            type="button"
            onClick={onRemove}
            className="text-rose-600 hover:underline text-xs"
          >
            Rimuovi
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex gap-2">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder="Codice sconto (es. BENVENUTO10)"
              className="flex-1 border p-2 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            />
            <Button type="button" onClick={onApply} size="sm">Applica</Button>
          </div>
          {couponError && <p className="text-xs text-rose-600">{couponError}</p>}
        </div>
      )}
    </div>
  );
}
