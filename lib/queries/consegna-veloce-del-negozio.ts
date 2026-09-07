/**
 * SE IL NEGOZIO OFFRE LA CONSEGNA VELOCE — UNA STRADA SOLA.
 *
 * 6/9/2026 — DUE PAGINE GEMELLE, LA STESSA CHIAVE DI CACHE, DUE FUNZIONI
 * DIVERSE.
 *
 * «Nuovo prodotto» e «Modifica prodotto» chiedevano al profilo la stessa cosa —
 * il negozio offre la consegna veloce? — sotto la stessa riga di cache
 * (`['seller','profile','offers-express']`), ma con due funzioni scritte a
 * mano, una per pagina. Una delle due, davanti alla sessione non ancora pronta,
 * rispondeva «no» senza segnalare niente; l'altra rispondeva «non lo so».
 * Siccome la riga di cache è una sola, la risposta sbagliata della prima
 * arrivava alla seconda già confezionata come buona: al negoziante che la
 * consegna veloce ce l'ha da mesi ricompariva il consiglio di andare ad
 * attivarla, e il riquadro che avvisa del guasto non compariva affatto.
 *
 * Adesso la domanda ha una funzione sola, in un file solo. Chi legge quel dato
 * importa questo aggancio: due strade che partono dalla stessa chiave non
 * possono più arrivare a due risposte diverse.
 *
 * LA PROVA: tests/unit/le-due-pagine-del-prodotto-leggono-la-consegna-allo-stesso-modo.test.ts
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/queries/keys';

/** La riga di cache condivisa: una domanda, una chiave. */
export const chiaveConsegnaVeloceDelNegozio = [...queryKeys.seller.profile, 'offers-express'] as const;

/**
 * La lettura vera. Sta qui fuori, con un nome, perché le pagine passino QUESTA
 * e non una copia scritta di nuovo: la prova confronta le due funzioni.
 */
export async function leggiSeIlNegozioOffreLaConsegnaVeloce(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  // «La sessione non è ancora pronta» non è «il negozio non offre la consegna
  // veloce»: è una lettura che non è riuscita, e va detta come tale.
  if (!user) throw new Error('Sessione non ancora pronta');
  const { data, error } = await supabase.from('profiles').select('offers_express').eq('id', user.id).single();
  if (error) throw error;
  return Boolean((data as { offers_express?: boolean } | null)?.offers_express);
}

export type ConsegnaVeloceDelNegozio = {
  /** `undefined` finché non si sa: non è un «no». */
  offre: boolean | undefined;
  inLettura: boolean;
  nonLetta: boolean;
};

export function useConsegnaVeloceDelNegozio(): ConsegnaVeloceDelNegozio {
  const { data, isLoading, isError } = useQuery({
    queryKey: chiaveConsegnaVeloceDelNegozio,
    queryFn: leggiSeIlNegozioOffreLaConsegnaVeloce,
  });
  return { offre: data, inLettura: isLoading, nonLetta: isError };
}
