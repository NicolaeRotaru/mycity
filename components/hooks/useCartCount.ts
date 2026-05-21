'use client';

import { useEffect, useState } from 'react';
import { cartCount } from '@/lib/cart';

export const useCartCount = () => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(cartCount());
    update();
    window.addEventListener('cart:updated', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('cart:updated', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return count;
};
