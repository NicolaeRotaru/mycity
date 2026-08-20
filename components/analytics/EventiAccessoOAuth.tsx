'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { trackSignedIn, trackSignupCompleted } from '@/lib/analytics/events';

/**
 * Emette l'evento di registrazione o accesso per chi entra con Google.
 *
 * Perché serve un pezzo lato browser: gli eventi del funnel si emettono da qui
 * (PostHog e GA4 girano nel browser), ma il percorso Google passa da una rotta
 * server — `/auth/callback` — che non può emetterli. Prima nessuno lo faceva, e
 * i numeri di «quanti si registrano» e «quanti accedono» contavano solo chi
 * usava email e password: cioè escludevano proprio le persone che scelgono la
 * strada più corta.
 *
 * La rotta di ritorno aggiunge `?auth=signup|signin&via=oauth`; questo
 * componente lo legge, emette l'evento una volta sola e pulisce l'indirizzo.
 */
export default function EventiAccessoOAuth() {
  const searchParams = useSearchParams();
  const fatto = useRef(false);

  useEffect(() => {
    if (fatto.current) return;
    const tipo = searchParams.get('auth');
    if (tipo !== 'signup' && tipo !== 'signin') return;
    fatto.current = true;

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const utente = data.user;
      if (utente) {
        // #214 — Il canale d'ingresso viaggia con l'evento: senza, non si
        // poteva sapere quale porta porta piu' gente.
        const canale = searchParams.get('via') ?? 'sconosciuto';
        if (tipo === 'signup') {
          const ruolo = (utente.user_metadata?.role as 'buyer' | 'seller' | 'rider' | 'admin') ?? 'buyer';
          trackSignupCompleted(utente.id, ruolo, canale);
        } else {
          trackSignedIn(utente.id, canale);
        }
      }

      // Ripulisce l'indirizzo: senza questo un ricaricamento della pagina
      // riemetterebbe l'evento e gonfierebbe i conteggi.
      const url = new URL(window.location.href);
      url.searchParams.delete('auth');
      url.searchParams.delete('via');
      window.history.replaceState({}, '', url.toString());
    })();
  }, [searchParams]);

  return null;
}
