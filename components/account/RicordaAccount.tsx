'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { CHIAVE_CAMBIO, dopoEventoAccesso, type SessioneMinima } from '@/lib/account/piu-account';

/**
 * Tiene aggiornati gli account salvati su questo dispositivo (lib/account/piu-account.ts) a ogni
 * evento dell'accesso, in tutto il sito: le chiavi che la libreria rinnova da sola, il nuovo account
 * durante un'aggiunta, e «Esci», che li dimentica tutti. Chi non ha mai aggiunto un account non ha
 * niente di salvato, e qui non si scrive niente. Montato una volta sola in app/layout.tsx.
 *
 * Dopo un cambio fatto in un'altra scheda questa si ricarica (collaudo del 25/11): il cookie
 * dell'accesso è uno solo, e una scheda rimasta col modulo del negozio di prima scriverebbe col nuovo
 * account. L'evento «storage» arriva solo alle ALTRE schede, mai a quella che ha fatto il cambio.
 */
export default function RicordaAccount() {
  useEffect(() => {
    if (typeof supabase?.auth?.onAuthStateChange !== 'function') return;
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      dopoEventoAccesso(evento, (sessione as SessioneMinima | null) ?? null);
    });
    const altraScheda = (e: StorageEvent) => {
      if (e.key === CHIAVE_CAMBIO && e.newValue) window.location.reload();
    };
    window.addEventListener('storage', altraScheda);
    return () => {
      data?.subscription?.unsubscribe();
      window.removeEventListener('storage', altraScheda);
    };
  }, []);
  return null;
}
