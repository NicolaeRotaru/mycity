'use client';

import Image from 'next/image';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import type { CartItem } from '@/lib/cart';

/**
 * Lista prodotti raggruppati per seller (visibile nella sidebar checkout).
 * Estratto da app/checkout/page.tsx per ridurre il monolite.
 */

type SellerGroup = {
  sellerId: string;
  storeName: string;
  items: CartItem[];
};

type Props = {
  groups: SellerGroup[];
};

export function CartGroupsList({ groups }: Props) {
  return (
    <div className="divide-y max-h-72 overflow-y-auto">
      {groups.map((g) => (
        <div key={g.sellerId} className="px-5 py-3">
          <p className="text-xs font-semibold text-primary-800 mb-2">🏪 {g.storeName}</p>
          {g.items.map((item) => (
            <div key={item.id} className="flex gap-3 items-center pl-2 py-1">
              <div className="relative w-10 h-10 bg-cream-100 rounded shrink-0 overflow-hidden">
                <Image
                  src={sizedImage(item.image ?? 'https://placehold.co/100x100/eef2ff/6366f1?text=?', 'thumb')}
                  alt={item.name}
                  fill
                  sizes="40px"
                  unoptimized
                  className="object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink-800 text-sm truncate">{item.name}</p>
                <p className="text-xs text-ink-400">×{item.quantity}</p>
              </div>
              <span className="font-semibold text-ink-800 text-sm">{formatPrice(item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
