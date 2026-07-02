'use client';

import Link from 'next/link';
import { Store } from 'lucide-react';
import { useProfile } from '@/components/hooks/useProfile';
import { useShoppingMode, marketplaceExitHref } from '@/components/hooks/useShoppingMode';

/**
 * Banner per venditori in modalità acquisto: chiarisce che stanno comprando
 * come clienti e offre un solo percorso di ritorno alla dashboard negozio.
 */
export default function SellerShoppingBanner() {
  const { isSeller } = useProfile();
  const shoppingMode = useShoppingMode(isSeller);

  if (!shoppingMode) return null;

  return (
    <div className="border-b border-primary-200 bg-primary-50">
      <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <p className="text-ink-800">
          <span className="font-semibold">Modalità acquisto</span>
          {' '}— stai comprando sul marketplace come cliente.
        </p>
        <Link
          href={marketplaceExitHref()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-800"
        >
          <Store size={14} aria-hidden />
          Torna al negozio
        </Link>
      </div>
    </div>
  );
}
