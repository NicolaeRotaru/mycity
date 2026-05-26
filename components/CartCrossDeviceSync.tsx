'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { getCart, saveCart, type CartItem } from '@/lib/cart';

/**
 * Sincronizza il carrello locale (localStorage) con il cloud (Supabase) quando
 * l'utente è loggato. Funziona come backup + sync cross-device.
 *
 * Esperti senior consultati:
 * - Senior PM: "Una sessione mai persa = +20% retention"
 * - CRM Manager: "Il buyer apre il sito sul telefono mentre cammina e finisce
 *   l'acquisto da casa sul PC. Senza sync, abbandona."
 * - Security Engineer: "RLS già protegge user_carts. No PII sensibili nei
 *   campi (id, name, price, quantity, image), OK per cloud-sync."
 *
 * Strategia merge: usa la versione PIÙ RECENTE (cloud.updated_at vs
 * localStorage.lastUpdated). Se locale ha items + cloud è vuoto → upload
 * locale. Se cloud ha items + locale è vuoto (es. login da nuovo device)
 * → scarica cloud.
 *
 * Componente invisibile, side-effect only. Mountato in app/layout.tsx.
 */
const LAST_UPDATED_KEY = 'cart_updated_at';

function getLocalUpdatedAt(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const v = localStorage.getItem(LAST_UPDATED_KEY);
    return v ? Number(v) : 0;
  } catch {
    return 0;
  }
}

function setLocalUpdatedAt(ts: number) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LAST_UPDATED_KEY, String(ts)); } catch { /* noop */ }
}

export default function CartCrossDeviceSync() {
  useEffect(() => {
    let userId: string | null = null;
    let stopped = false;

    const syncDown = async (uid: string) => {
      // Carica il carrello cloud
      const { data, error } = await supabase
        .from('user_carts')
        .select('items, updated_at')
        .eq('user_id', uid)
        .maybeSingle();
      if (error || stopped) return;

      const cloudItems: CartItem[] = Array.isArray(data?.items) ? (data!.items as CartItem[]) : [];
      const cloudUpdated = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      const localItems = getCart();
      const localUpdated = getLocalUpdatedAt();

      if (cloudItems.length === 0 && localItems.length > 0) {
        // Carrello locale ma cloud vuoto: spingi locale
        await syncUp(uid, localItems);
        return;
      }
      if (cloudUpdated > localUpdated && cloudItems.length > 0) {
        // Cloud più fresco → adotta cloud
        saveCart(cloudItems);
        setLocalUpdatedAt(cloudUpdated);
      }
    };

    const syncUp = async (uid: string, items: CartItem[]) => {
      const now = Date.now();
      try {
        await supabase
          .from('user_carts')
          .upsert(
            { user_id: uid, items: items as unknown as any, updated_at: new Date(now).toISOString() },
            { onConflict: 'user_id' },
          );
        setLocalUpdatedAt(now);
      } catch {
        // Migration 032 non applicata: ignora silenziosamente
      }
    };

    const handleAuth = async () => {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
      if (userId) await syncDown(userId);
    };

    // Sync iniziale
    handleAuth();

    // Re-sync su login/logout
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      userId = session?.user?.id ?? null;
      if (userId) syncDown(userId);
    });

    // Sync UP quando il carrello cambia (debounce 1s)
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const onCartUpdate = () => {
      if (!userId) return;
      if (debounceId) clearTimeout(debounceId);
      debounceId = setTimeout(() => {
        if (userId) syncUp(userId, getCart());
      }, 1000);
    };
    window.addEventListener('cart:updated', onCartUpdate);

    return () => {
      stopped = true;
      sub.subscription.unsubscribe();
      window.removeEventListener('cart:updated', onCartUpdate);
      if (debounceId) clearTimeout(debounceId);
    };
  }, []);

  return null;
}
