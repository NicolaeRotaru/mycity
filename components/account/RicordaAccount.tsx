'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { Modal } from '@/components/ui/Modal';
import {
  CHIAVE_CAMBIO, PAGINE_DELL_ACCESSO, cambioChiestoQui, dopoEventoAccesso, fermaQuestaScheda,
  utenteDellaPaginaAttuale, vedeEntrare, type SessioneMinima,
} from '@/lib/account/piu-account';

/**
 * L'ascolto dell'accesso per i più account (lib/account/piu-account.ts), montato una volta sola in
 * app/layout.tsx. A ogni evento:
 *  · i dati del browser (carrello, bozze) diventano dell'account che c'è, e quelli di un altro
 *    account vanno da parte per lui (la regola, che chiama anche la sincronizzazione del carrello);
 *  · l'elenco degli account salvati si aggiorna, e «Esci» lo cancella;
 *  · se arriva un account diverso da quello della pagina, fuori dalle pagine di accesso e senza
 *    averlo chiesto questa scheda, la scheda si ferma con un avviso. Non si ricarica da sola: una
 *    scheda sulla cassa, a pagamento confermato, perderebbe la conferma e si potrebbe pagare due volte.
 * Lo stesso avviso parte dal segnale che l'altra scheda scrive (evento «storage»): arriva anche dove
 * l'evento dell'accesso non arrivasse.
 */

/** Il cookie dell'accesso c'è? (sb-<progetto>-auth-token, anche a pezzi .0 .1 …) */
function cookieDellAccesso(): boolean {
  try {
    return document.cookie.split(';').some((c) => /^\s*sb-[^=]+-auth-token(\.\d+)?=/.test(c));
  } catch {
    return true; // nel dubbio si dice che c'è: meglio non cancellare niente
  }
}

const sullAccesso = () => PAGINE_DELL_ACCESSO.some((p) => window.location.pathname.startsWith(p));

export default function RicordaAccount() {
  const [cambiato, setCambiato] = useState(false);

  useEffect(() => {
    if (typeof supabase?.auth?.onAuthStateChange !== 'function') return;
    const { data } = supabase.auth.onAuthStateChange((evento, sessione) => {
      const s = (sessione as SessioneMinima | null) ?? null;
      dopoEventoAccesso(evento, s, undefined, undefined, { sessioneNelDeposito: cookieDellAccesso() });
      if (s?.user?.id && vedeEntrare(s.user.id, window.location.pathname)) setCambiato(true);
    });
    const altraScheda = (e: StorageEvent) => {
      if (e.key !== CHIAVE_CAMBIO || !e.newValue) return;
      const id = e.newValue.split(':')[0];
      if (id === utenteDellaPaginaAttuale() || cambioChiestoQui() || sullAccesso()) return;
      fermaQuestaScheda();
      setCambiato(true);
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
