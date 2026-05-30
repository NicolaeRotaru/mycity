'use client';

import { useEffect, useState } from 'react';
import { Bike } from 'lucide-react';
import { cn } from '@/lib/cn';
import { deliveryWindow, splitDuration, DEFAULT_CUTOFF_HOUR } from '@/lib/delivery';

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
 * Mostra "🛵 Ordina entro 02:14:31 e arriva oggi" — urgenza onesta legata
 * alla consegna reale. Variante `banner` per blocchi in evidenza.
 */
export function DeliveryCutoff({
  cutoffHour = DEFAULT_CUTOFF_HOUR,
  variant = 'inline',
  className,
}: {
  cutoffHour?: number;
  variant?: 'inline' | 'banner';
  className?: string;
}) {
  const { hydrated, day, h, m, s } = useDeliveryCutoff(cutoffHour);

  // Pre-hydration: messaggio statico senza timer (no mismatch, no layout shift).
  const timer = hydrated && day === 'oggi'
    ? <span className="font-mono font-bold tabular-nums">{pad(h)}:{pad(m)}:{pad(s)}</span>
    : null;

  if (variant === 'banner') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg bg-olive-50 text-olive-800 px-3 py-2 text-sm font-medium',
          className,
        )}
      >
        <Bike size={18} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
        {day === 'oggi' && hydrated ? (
          <span>Ordina entro {timer} e <strong>arriva oggi</strong></span>
        ) : (
          <span>Ordina ora e <strong>arriva {day}</strong></span>
        )}
      </div>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm text-olive-700 font-medium', className)}>
      <Bike size={15} strokeWidth={2.2} className="text-olive-600 shrink-0" aria-hidden />
      {day === 'oggi' && hydrated ? (
        <span>Ordina entro {timer} e arriva <strong>oggi</strong></span>
      ) : (
        <span>Arriva <strong>{day}</strong></span>
      )}
    </span>
  );
}
