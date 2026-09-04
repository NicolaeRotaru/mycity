import { Truck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FREE_SHIPPING_THRESHOLD } from '@/lib/constants';
import { promessaSpedizione } from '@/lib/promesse-pubbliche';

/**
 * Barra "Ti mancano €3 alla spedizione gratis" → stato success al traguardo.
 *
 * Leva AOV (valore medio ordine): incentiva ad aggiungere prodotti per
 * superare la soglia. Riusa FREE_SHIPPING_THRESHOLD già esistente.
 *
 * ⚠️ Le parole non si scrivono qui: le decide `promessaSpedizione()`, che le fa nascere dalla
 * cifra che la cassa addebita davvero. Scritta a mano, questa barra prometteva «Hai la spedizione
 * gratis» mentre in cassa partivano comunque 3 € di consegna.
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
  const promessa = promessaSpedizione(subtotal, threshold);
  const pct = Math.min(100, threshold > 0 ? (subtotal / threshold) * 100 : 100);
  const unlocked = promessa.sopraSoglia;

  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        // In-progress → accent (incoraggia ad aggiungere); sbloccato → olive (success).
        unlocked ? 'border-olive-200 bg-olive-50' : 'border-accent-200 bg-accent-50',
        className,
      )}
    >
      {unlocked ? (
        <p className="text-olive-700 font-semibold flex items-center gap-2 text-sm">
          <Truck size={16} strokeWidth={2.4} className="shrink-0" aria-hidden />
          <span>{promessa.titolo}</span>
        </p>
      ) : (
        <>
          <p className="text-accent-700 text-sm font-medium mb-2 flex items-center gap-2">
            <Truck size={16} strokeWidth={2.4} className="shrink-0" aria-hidden />
            <span>{promessa.titolo}</span>
          </p>
          <div className="w-full bg-accent-100 rounded-full h-2 overflow-hidden">
            <div
              className="bg-accent-500 h-2 rounded-full animate-progress-fill transition-[width] duration-500"
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
