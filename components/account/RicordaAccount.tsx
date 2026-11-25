'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Modal } from '@/components/ui/Modal';
import { CHIAVE_CAMBIO, dopoEventoAccesso, type SessioneMinima } from '@/lib/account/piu-account';

/**
 * Tiene aggiornati gli account salvati su questo dispositivo (lib/account/piu-account.ts) a ogni
 * evento dell'accesso, in tutto il sito: le chiavi che la libreria rinnova da sola, il nuovo account
 * durante un'aggiunta, e «Esci», che li dimentica tutti. Chi non ha mai aggiunto un account non ha
 * niente di salvato, e qui non si scrive niente. Montato una volta sola in app/layout.tsx.
 *
 * Dopo un cambio fatto in un'altra scheda questa si ferma con un avviso (collaudi del 25/11): il cookie
 * dell'accesso è uno solo, e una scheda rimasta col modulo del negozio di prima scriverebbe col nuovo
 * account. Non si ricarica da sola: una scheda sulla cassa, a pagamento confermato, perderebbe la
 * conferma e si potrebbe pagare due volte. L'evento «storage» arriva solo alle ALTRE schede.
 */

/** Il cookie dell'accesso c'è? (sb-<progetto>-auth-token, anche a pezzi .0 .1 …) */
function cookieDellAccesso(): boolean {
  try {
    return document.cookie.split(';').some((c) => /^\s*sb-[^=]+-auth-token(\.\d+)?=/.test(c));
  } catch {
    return true; // nel dubbio si dice che c'è: meglio non cancellare niente
  }
}

export default function RicordaAccount() {
  const [cambiato, setCambiato] = useState(false);

  useEffect(() => {
    if (typeof supabase?.auth?.onAuthStateChange !== 'function') return;
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      dopoEventoAccesso(evento, (sessione as SessioneMinima | null) ?? null, undefined, undefined, {
        sessioneNelDeposito: cookieDellAccesso(),
        percorso: window.location.pathname,
      });
    });
    const altraScheda = (e: StorageEvent) => {
      if (e.key === CHIAVE_CAMBIO && e.newValue) setCambiato(true);
    };
    window.addEventListener('storage', altraScheda);
    return () => {
      data?.subscription?.unsubscribe();
      window.removeEventListener('storage', altraScheda);
    };
  }, []);

  return (
    <Modal
      open={cambiato}
      onClose={() => window.location.reload()}
      title="Hai cambiato account in un’altra scheda"
      description="Questa pagina è ancora quella dell’account di prima. Ricaricala prima di continuare, così quello che fai va all’account giusto."
      closeOnBackdrop={false}
      closeOnEsc={false}
      size="sm"
      footer={
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white hover:bg-primary-800"
        >
          Ricarica la pagina
        </button>
      }
    >
      <p className="text-sm text-ink-700">Se stavi pagando, controlla i tuoi ordini dopo aver ricaricato: un pagamento già fatto resta valido.</p>
    </Modal>
  );
}
