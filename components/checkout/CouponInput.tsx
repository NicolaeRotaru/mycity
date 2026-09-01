'use client';

import { Check } from 'lucide-react';
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
  /** Vero mentre il codice si sta verificando: il pulsante si spegne. */
  applying?: boolean;
  onCodeChange: (code: string) => void;
  onApply: () => void;
  onRemove: () => void;
};

export function CouponInput({
  couponCode,
  appliedCoupon,
  couponError,
  applying = false,
  onCodeChange,
  onApply,
  onRemove,
}: Props) {
  return (
    <div className="px-5 py-3 border-t bg-cream-50/50">
      {appliedCoupon ? (
        <div className="flex items-center justify-between bg-olive-50 border border-olive-200 rounded px-3 py-2 text-sm">
          <span className="text-olive-800 inline-flex items-center gap-1">
            <Check size={14} strokeWidth={2.5} aria-hidden /> <strong>{appliedCoupon.coupon.code}</strong> applicato (−{formatPrice(appliedCoupon.discount)})
          </span>
          {/* 27/8/2026 (R098) — era testo nudo: un bersaglio da circa 30×16 pixel dentro la
              cassa. Sotto i 44 raccomandati (WCAG 2.5.8) chi ha le mani grandi lo manca, e chi
              lo manca crede che il sito non risponda. */}
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-[44px] items-center px-3 py-2 text-xs text-rose-600 hover:underline"
          >
            Rimuovi
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* 140 — Il campo aveva solo un segnaposto. Un segnaposto sparisce
              appena si scrive, e un lettore di schermo non è tenuto a leggerlo:
              chi arrivava qui da tastiera trovava una casella senza nome. */}
          <div className="flex gap-2">
            <label htmlFor="codice-sconto" className="sr-only">Codice sconto</label>
            <input
              id="codice-sconto"
              type="text"
              value={couponCode}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder="es. BENVENUTO10"
              aria-invalid={couponError ? true : undefined}
              aria-describedby={couponError ? 'codice-sconto-errore' : undefined}
              className="flex-1 border p-2 rounded text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-700"
            />
            {/* 22/8/2026 — il pulsante restava premibile durante la verifica:
                chi non vedeva succedere niente premeva di nuovo, e partivano
                due controlli in parallelo. */}
            {/* 27/8/2026 (R098) — la taglia piccola è alta 32 pixel: sotto il minimo che si tocca
                senza sbagliare. Su un pulsante della cassa non ci va. */}
            <Button type="button" onClick={onApply} size="md" loading={applying} disabled={applying}>
              {applying ? 'Verifico…' : 'Applica'}
            </Button>
          </div>
          {couponError && (
            <p id="codice-sconto-errore" role="alert" className="text-xs text-rose-600">{couponError}</p>
          )}
        </div>
      )}
    </div>
  );
}
