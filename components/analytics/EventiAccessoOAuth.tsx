'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { trackSignedIn, trackSignupCompleted } from '@/lib/analytics/events';
import { decidiEventoDiAccesso, PARAMETRI_DA_RIPULIRE } from '@/lib/analytics/porta-di-ingresso';

/**
 * Emette l'evento di registrazione o accesso per chi arriva da una strada che
 * passa dal server: il pulsante Google e il link di conferma della mail.
 *
 * Perché serve un pezzo lato browser: gli eventi del funnel si emettono da qui
 * (PostHog e GA4 girano nel browser), ma quei due percorsi passano da una rotta
 * server — `/auth/callback` — che non può emetterli. Prima nessuno lo faceva, e
 * i numeri di «quanti si registrano» e «quanti accedono» contavano solo chi
 * usava email e password: cioè escludevano proprio le persone che scelgono la
 * strada più corta.
 *
 * 27/8/2026 (R160) — E POI HANNO SMESSO DI CONTARE ANCHE QUELLI.
 *
 * La rotta di ritorno decideva «registrazione o accesso?» guardando se
 * l'account era nato da meno di un minuto. Con email e password l'account nasce
 * alla compilazione del modulo e il link di conferma si apre dopo: oltre il
 * minuto, cioè quasi sempre, arrivava qui `auth=signin`. Gli iscritti dal
 * canale email risultavano zero e gli accessi gonfiati di uno per ognuno.
 *
 * La regola non sta più qui dentro: sta in `porta-di-ingresso.ts`, dove si può
 * mettere sotto una prova. Questo componente la applica e basta.
 */
export default function EventiAccessoOAuth() {
  const searchParams = useSearchParams();
  const fatto = useRef(false);

  useEffect(() => {
    if (fatto.current) return;
    const evento = decidiEventoDiAccesso(searchParams);
    if (!evento) return;
    fatto.current = true;

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const utente = data.user;
      if (utente) {
        // #214 — Il canale d'ingresso viaggia con l'evento: senza, non si
        // poteva sapere quale porta porta piu' gente.
        if (evento.tipo === 'signup') {
          const ruolo = (utente.user_metadata?.role as 'buyer' | 'seller' | 'rider' | 'admin') ?? 'buyer';
          trackSignupCompleted(utente.id, ruolo, evento.canale);
        } else {
          trackSignedIn(utente.id, evento.canale);
        }
      }

      // Ripulisce l'indirizzo: senza questo un ricaricamento della pagina
      // riemetterebbe l'evento e gonfierebbe i conteggi.
      const url = new URL(window.location.href);
      for (const parametro of PARAMETRI_DA_RIPULIRE) url.searchParams.delete(parametro);
      window.history.replaceState({}, '', url.toString());
    })();
  }, [searchParams]);

  return null;
}
