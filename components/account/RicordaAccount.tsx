'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { dopoEventoAccesso, type SessioneMinima } from '@/lib/account/piu-account';

/**
 * Tiene aggiornati gli account salvati su questo dispositivo (lib/account/piu-account.ts) a ogni
 * evento dell'accesso, in tutto il sito: le chiavi che la libreria rinnova da sola, il nuovo account
 * durante un'aggiunta, e «Esci», che li dimentica tutti. Chi non ha mai aggiunto un account non ha
 * niente di salvato, e qui non si scrive niente. Montato una volta sola in app/layout.tsx.
 */
export default function RicordaAccount() {
  useEffect(() => {
    if (typeof supabase?.auth?.onAuthStateChange !== 'function') return;
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      dopoEventoAccesso(evento, (sessione as SessioneMinima | null) ?? null);
    });
    return () => data?.subscription?.unsubscribe();
  }, []);
  return null;
}
