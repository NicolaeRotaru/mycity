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
// Timestamp dell'ultima modifica LOCALE del carrello. Condiviso con
// CartCrossDeviceSync: il merge cloud↔locale usa "il più recente vince", quindi
// ogni mutazione locale (aggiunta/rimozione/svuota) deve avanzare questo orologio,
// altrimenti un carrello cloud stale può "resuscitare" item rimossi al login.
export const CART_UPDATED_AT_KEY = 'cart_updated_at';

const bumpUpdatedAt = () => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CART_UPDATED_AT_KEY, String(Date.now())); } catch { /* noop */ }
};

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
  bumpUpdatedAt();
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
  // Tracking unificato (PostHog + GA4) via façade lib/analytics/events.
  // Fire-and-forget; no-op senza consenso analytics.
  import('@/lib/analytics/events')
    .then((m) => m.trackAddToCart(item.id, qty, Math.round(item.price * 100), { name: item.name, storeName: item.storeName }))
    .catch(() => {});
};

export const removeFromCart = (id: string) => {
  saveCart(getCart().filter((c) => c.id !== id));
  // Tracking (PostHog + GA4), fire-and-forget.
  import('@/lib/analytics/events').then((m) => m.trackRemoveFromCart(id)).catch(() => {});
};

export const updateQuantity = (id: string, quantity: number) => {
  if (quantity < 1) return removeFromCart(id);
  saveCart(getCart().map((c) => (c.id === id ? { ...c, quantity } : c)));
};

export const clearCart = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
  bumpUpdatedAt();
  window.dispatchEvent(new Event('cart:updated'));
};

export const cartTotal = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.price * item.quantity, 0);

export const cartCount = (items?: CartItem[]) =>
  (items ?? getCart()).reduce((sum, item) => sum + item.quantity, 0);
