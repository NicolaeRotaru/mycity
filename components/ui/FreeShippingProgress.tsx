import { Truck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatPrice } from '@/lib/format';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';

/**
 * Barra "Ti mancano €3 alla spedizione gratis" → stato success al traguardo.
 *
 * Leva AOV (valore medio ordine): incentiva ad aggiungere prodotti per
 * superare la soglia. Riusa FREE_SHIPPING_THRESHOLD già esistente.
 */
export function FreeShippingProgress({
  subtotal,
  threshold = FREE_SHIPPING_THRESHOLD,
  className,
}: {
  subtotal: number;
  threshold?: number;
  className?: string;
}) {
  const remaining = Math.max(0, threshold - subtotal);
  const pct = Math.min(100, threshold > 0 ? (subtotal / threshold) * 100 : 100);
  const unlocked = remaining === 0;

  return (
    <div className={cn('rounded-xl border border-olive-200 bg-olive-50 p-3', className)}>
      {unlocked ? (
        <p className="text-olive-700 font-semibold flex items-center gap-2 text-sm">
          <Truck size={16} strokeWidth={2.4} aria-hidden />
          Hai la <strong>spedizione gratis</strong>
        </p>
      ) : (
        <>
          <p className="text-olive-800 text-sm font-medium mb-2">
            Ti mancano <strong>{formatPrice(remaining)}</strong> alla{' '}
            <strong>spedizione gratis</strong>
          </p>
          <div className="w-full bg-olive-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-olive-500 h-2 rounded-full animate-progress-fill transition-[width] duration-500"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </>
      )}
    </div>
  );
}
