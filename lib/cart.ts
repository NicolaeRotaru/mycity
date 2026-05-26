'use client';

export type CartItem = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  sellerId?: string;
  storeName?: string;
};

const KEY = 'cart';

export const getCart = (): CartItem[] => {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
};

export const saveCart = (items: CartItem[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event('cart:updated'));
};

export const addToCart = (item: Omit<CartItem, 'quantity'> & { quantity?: number }) => {
  const cart = getCart();
  const existing = cart.find((c) => c.id === item.id);
  const qty = item.quantity ?? 1;
  if (existing) {
    existing.quantity += qty;
  } else {
    cart.push({ ...item, quantity: qty });
  }
  saveCart(cart);
  // GA4 e-commerce event (no-op se gtag non caricato / consenso negato)
  if (typeof window !== 'undefined' && window.gtag) {
    try {
      window.gtag('event', 'add_to_cart', {
        currency: 'EUR',
        value: Number((item.price * qty).toFixed(2)),
        items: [{
          item_id: item.id,
          item_name: item.name,
          price: item.price,
          quantity: qty,
          item_brand: item.storeName,
        }],
      });
    } catch { /* noop */ }
  }
  // PostHog event (fire and forget)
  import('@/lib/analytics/events').then((m) => m.trackAddToCart(item.id, qty, Math.round(item.price * 100))).catch(() => {});
};

export const removeFromCart = (id: string) => {
  saveCart(getCart().filter((c) => c.id !== id));
};

export const updateQuantity = (id: string, quantity: number) => {
  if (quantity < 1) return removeFromCart(id);
  saveCart(getCart().map((c) => (c.id === id ? { ...c, quantity } : c)));
};

export const clearCart = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('cart:updated'));
};

export const cartTotal = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.price * item.quantity, 0);

export const cartCount = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.quantity, 0);
