'use client';

import { useEffect, useState } from 'react';
import { Bike } from 'lucide-react';
import { cn } from '@/lib/cn';
import { deliveryWindow, splitDuration, DEFAULT_CUTOFF_HOUR, EXPRESS_ETA_LABEL, STANDARD_ETA_LABEL } from '@/lib/delivery';

/**
 * useDeliveryCutoff — countdown SSR-safe verso l'orario limite consegna.
 *
 * `now` parte null durante SSR (come DropOfDay) per evitare hydration
 * mismatch: Date.now() differisce tra server e client.
 */
export function useDeliveryCutoff(cutoffHour = DEFAULT_CUTOFF_HOUR) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) {
    return { hydrated: false as const, day: 'oggi' as const, h: 0, m: 0, s: 0 };
  }
  const win = deliveryWindow(now, cutoffHour);
  const { h, m, s } = splitDuration(new Date(win.targetIso).getTime() - now);
  return { hydrated: true as const, day: win.day, h, m, s };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Mostra la promessa di consegna a due velocità, legata alla disponibilità:
 *  - `available` (prodotto a inventario e pronto): Express ~30-60 min, in giornata
 *    entro il cutoff → "🛵 Ordina entro 02:14:31 e arriva oggi in 30-60 min".
 *  - non disponibile / su ordinazione: Standard → "🛵 Consegna in 2-3 giorni".
 * Variante `banner` per blocchi in evidenza, `inline` per pagine prodotto.
 */
export function DeliveryCutoff({
  cutoffHour = DEFAULT_CUTOFF_HOUR,
  variant = 'inline',
  available = true,
  externalDeliveryLabel,
  className,
}: {
  cutoffHour?: number;
  variant?: 'inline' | 'banner';
  /** Prodotto a inventario e pronto (stock > 0). false → Standard 2-3 giorni. */
  available?: boolean;
  /** Prodotto importato da marketplace: mostra il tempo di consegna esterno. */
  externalDeliveryLabel?: string | null;
  className?: string;
}) {
  const { hydrated, day, h, m, s } = useDeliveryCutoff(cutoffHour);

  // Pre-hydration: messaggio statico senza timer (no mismatch, no layout shift).
  const timer = hydrated && day === 'oggi'
    ? <span className="font-mono font-bold tabular-nums">{pad(h)}:{pad(m)}:{pad(s)}</span>
    : null;

  // Prodotto importato: il tempo di consegna è quello indicato dal marketplace.
  const content = externalDeliveryLabel ? (
    <span>Consegna in <strong>{externalDeliveryLabel}</strong></span>
  ) : !available ? (
    <span>Consegna in <strong>{STANDARD_ETA_LABEL}</strong></span>
  ) : day === 'oggi' && hydrated ? (
    <span>Ordina entro {timer} e <strong>arriva oggi</strong> in {EXPRESS_ETA_LABEL}</span>
  ) : (
    <span>Arriva <strong>{day}</strong></span>
  );

  if (variant === 'banner') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg bg-olive-50 text-olive-800 px-3 py-2 text-sm font-medium',
          className,
        )}
      >
        <Bike size={18} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
        {content}
      </div>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-olive-700 font-medium', className)}>
      <Bike size={15} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
      {content}
    </span>
  );
}
