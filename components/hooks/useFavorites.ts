'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';
import { trackFavoriteAdded } from '@/lib/analytics/events';
import { idUtenteInMemoria } from '@/components/hooks/useUtente';
import { opzioniDelTocco, type Verso } from '@/lib/preferiti/tocco-del-cuore';

/**
 * I preferiti dell'utente collegato.
 *
 * ⚠️ PERCHÉ QUI SI CONTROLLA L'ERRORE OVUNQUE, letto e scritto.
 *
 * Prima nessuna delle tre chiamate lo guardava, e ognuna raccontava la stessa bugia da un lato
 * diverso:
 *
 * · la LETTURA senza `error` non fallisce mai. Torna «riuscita» con l'insieme vuoto, e chi ha
 *   trenta prodotti salvati vede trenta cuori grigi. Peggio: la query risulta a buon fine, quindi
 *   non riprova da sola — il grigio resta finché non si ricarica la pagina.
 * · la SCRITTURA senza `error` non fallisce mai. Il cuore fa la sua animazione, `onSuccess` parte,
 *   la lista si rilegge e il prodotto non c'è. Nessun messaggio. Per chi guarda è un clic che non
 *   ha fatto niente, dopo un'animazione che diceva di sì. È il difetto degli stati visto dal lato
 *   della scrittura: lì il sito diceva «non c'è niente» senza aver guardato, qui dice «fatto»
 *   senza aver fatto.
 *
 * E c'è un terzo pezzo che non si cura con un `if`: se la lettura fallisce, «non lo so» non deve
 * uscire come «non è fra i preferiti». Per questo l'insieme esce insieme a `lettoDavvero`, e chi
 * disegna il cuore ha il terzo stato invece di doverlo indovinare.
 *
 * ⚠️ E PERCHÉ IL CUORE CAMBIA PRIMA DELLA RISPOSTA DEL SERVER.
 *
 * Prima si riempiva alla fine di tre giri di rete: «chi sei», la riga scritta, la rilettura di
 * tutto l'elenco. Adesso cambia sotto il dito e, se il server rifiuta, torna com'era. Le regole di
 * quel ribaltamento stanno in `lib/preferiti/tocco-del-cuore.ts`, dove una prova le esegue — il
 * caso scomodo compreso, cioè il server che dice di no.
 */
export const useFavorites = () => {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.favorites.all,
    queryFn: async () => {
      // #88 — Qui basta sapere SE c'e' qualcuno collegato: `getSession()` legge
      // il token gia' in memoria, senza una chiamata di rete in piu'.
      const userId = await idUtenteInMemoria();
      if (!userId) return new Set<string>();
      const { data, error } = await supabase
        .from('favorites')
        .select('product_id')
        .eq('user_id', userId);
      if (error) throw error;
      return new Set<string>((data ?? []).map((f: { product_id: string }) => f.product_id));
    },
    staleTime: 30_000,
  });

  const favorites = query.data ?? new Set<string>();
  // «Ho in mano la lista», non «la lettura è finita»: con `isLoading` falso e `data` a `undefined`
  // la seconda risponderebbe di sì su una lettura fallita. È la stessa distinzione di `vistaDaQuery`.
  const lettoDavvero = query.data !== undefined;

  /**
   * La scrittura vera, e basta: l'unico pezzo che tocca l'accesso e il database.
   *
   * Le regole del tocco — il cuore che cambia subito e torna indietro se il server rifiuta — stanno
   * in `lib/preferiti/tocco-del-cuore.ts`, dove una prova le può eseguire davvero.
   */
  const scriviIlPreferito = async (productId: string, verso: Verso) => {
    // #88 — Qui basta sapere SE c'è qualcuno collegato: `getSession()` legge il token già in
    // memoria. Prima c'era `getUser()`, cioè una chiamata di rete piazzata proprio in mezzo al
    // percorso del tocco, quando la fretta conta.
    const userId = await idUtenteInMemoria();
    if (!userId) throw new Error('AUTH_REQUIRED');
    if (verso === 'togli') {
      const { error } = await supabase.from('favorites').delete().eq('user_id', userId).eq('product_id', productId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase.from('favorites').insert({ user_id: userId, product_id: productId });
    if (error) throw error;
    // Il conteggio parte DOPO che la riga è entrata davvero: prima si contava un preferito
    // aggiunto anche quando l'inserimento era fallito, e il numero cresceva senza la riga.
    trackFavoriteAdded(productId);
  };

  const toggle = useMutation(opzioniDelTocco(qc, scriviIlPreferito));

  return { favorites, lettoDavvero, toggle };
};
