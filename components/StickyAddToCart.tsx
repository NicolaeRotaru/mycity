'use client';

import { useEffect, useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { formatPrice } from '@/lib/format';

type Props = {
  price: number;
  available: boolean;
  onAdd: () => void;
  /** Microcopy di rassicurazione sotto il prezzo (es. "Paghi alla consegna"). */
  note?: string;
};

/**
 * Bottone CTA sticky in fondo allo schermo su mobile — best practice retail
 * (Amazon, Asos, Glovo). Compare quando l'utente scrolla giù oltre l'header.
 *
 * Solo md:hidden — su desktop c'è già la sticky card a destra del prodotto.
 * Lascia spazio per la MobileTabBar in basso (z-index + bottom offset).
 */
export default function StickyAddToCart({ price, available, onAdd, note }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Visible quando si scrolla oltre la prima metà del primo schermo
      const trigger = Math.max(300, window.innerHeight * 0.5);
      setVisible(window.scrollY > trigger);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="md:hidden fixed left-0 right-0 z-30 transition-transform duration-300 animate-slide-up pb-safe"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 56px)' }}
      aria-label="Aggiungi al carrello (sticky)"
    >
      <div className="container mx-auto px-3">
        <div className="bg-white border border-cream-300 rounded-2xl shadow-warm-lg p-3 flex items-center gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-primary-700 leading-tight">{formatPrice(price)}</p>
            <p className="text-[11px] text-olive-700 font-medium leading-tight">
              {note ?? 'Totale'}
            </p>
          </div>
          <button
            onClick={onAdd}
            disabled={!available}
            className="ml-auto inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-ink-900 px-5 py-3 rounded-full font-bold text-sm transition-colors"
          >
            <ShoppingCart size={18} strokeWidth={2.4} />
            {available ? 'Aggiungi al carrello' : 'Non disponibile'}
          </button>
        </div>
      </div>
    </div>
  );
}
