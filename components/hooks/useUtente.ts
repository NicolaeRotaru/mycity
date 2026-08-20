'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

/**
 * Chi è collegato: una domanda sola, una risposta sola.
 *
 * Il difetto (#88). Aprire una scheda prodotto faceva partire sette-otto
 * chiamate separate a `auth.getUser()` — profilo, preferiti, tracciamento
 * visite, ultimi visti, messaggi non letti (montato due volte: barra in alto e
 * barra in basso), notifiche, sincronizzazione carrello. Ognuna è una richiesta
 * di rete al server di autenticazione, e tutte chiedono la stessa identica
 * cosa. Su una rete mobile sono centinaia di millisecondi buttati, in parallelo
 * al caricamento della pagina, cioè quando la banda serve altrove.
 *
 * Qui la risposta si chiede una volta e si tiene per cinque minuti: chi la
 * vuole la legge da questa cache condivisa.
 *
 * `getSession()` invece NON va in rete: legge il token che è già in memoria. Va
 * benissimo dove serve solo sapere SE c'è qualcuno collegato. `getUser()` — che
 * il token lo verifica davvero col server — resta dove conta, cioè lato server
 * prima di scrivere qualcosa.
 */

export const CHIAVE_UTENTE = ['auth', 'utente-corrente'] as const;

async function leggiUtente() {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/** L'utente collegato, condiviso da tutti i componenti che lo chiedono. */
export function useUtente() {
  const { data, isLoading } = useQuery({
    queryKey: CHIAVE_UTENTE,
    queryFn: leggiUtente,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
  return { utente: data ?? null, userId: data?.id ?? null, caricamento: isLoading };
}

/**
 * L'identificativo di chi è collegato, senza andare in rete: legge il token già
 * in memoria. Da usare nei punti dove serve solo sapere se c'è qualcuno.
 */
export async function idUtenteInMemoria(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
