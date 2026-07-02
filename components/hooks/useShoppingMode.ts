'use client';

import { useEffect, useState } from 'react';
import {
  SHOPPING_MODE_COOKIE,
  SHOPPING_MODE_QUERY,
} from '@/lib/shopping-access';

function readShoppingCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${SHOPPING_MODE_COOKIE}=1`));
}

/**
 * True quando un venditore ha aperto il marketplace dal pulsante dedicato (?shop=1).
 * I buyer/admin/rider non usano questa modalità (sempre false per loro).
 */
export function useShoppingMode(isSeller: boolean): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!isSeller) {
      setActive(false);
      return;
    }
    setActive(readShoppingCookie());
    const onFocus = () => setActive(readShoppingCookie());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isSeller]);

  return isSeller && active;
}

/** URL per entrare in modalità acquisto venditore. */
export function marketplaceEntryHref(): string {
  return `/?${SHOPPING_MODE_QUERY}=1`;
}

/** URL per uscire dalla modalità acquisto e tornare alla dashboard. */
export function marketplaceExitHref(): string {
  return '/seller/dashboard?exit_shop=1';
}

export function useCanPurchase(isAdmin: boolean, isSeller: boolean, shoppingMode: boolean): boolean {
  if (isAdmin) return false;
  if (isSeller) return shoppingMode;
  return true;
}
