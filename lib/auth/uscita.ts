'use client';

import { supabase } from '@/lib/supabase/client';

/**
 * 27/11/2026 — DOPO «ESCI» LA PAGINA RESTAVA SU «CARICAMENTO…» PER SEMPRE.
 *
 * Nicola, dal telefono: usciva dall'area dell'amministratore e la pagina girava
 * all'infinito, con «Accedi» in basso. Riprodotto in locale e misurato sulla coda
 * dei cambi pagina di Next (15.5): ogni «Esci» faceva `router.push('/sign-in')` e
 * subito dopo `router.refresh()`. Ma nell'uscita il cambio pagina non è uno solo:
 *
 *  1. la sessione si chiude e l'area riservata (layout di /admin, /seller,
 *     /rider) se ne accorge subito, prima ancora che `signOut` finisca, e chiede
 *     lei di andare all'accesso;
 *  2. finito `signOut`, il tasto chiede di nuovo l'accesso: Next scarta il primo
 *     cambio pagina ma lascia il segno «ultimo in coda» su quello scartato;
 *  3. il `refresh()` si aggancia a quello scartato e non parte mai. La sua attesa
 *     non si chiude più, e la pagina resta sul caricamento dell'area riservata.
 *
 * Il rinfresco non serviva: la pagina dell'accesso arriva comunque nuova dal
 * server, e i dati dell'account li toglie già l'ascolto dell'uscita
 * (components/providers/QueryProvider.tsx). Quindi qui c'è un solo cambio pagina
 * e nessun `refresh()`.
 *
 * ⚠️ La trappola resta dentro Next: dopo i due cambi pagina il segno «ultimo in
 * coda» è ancora su quello scartato. Qualunque comando che non sia un cambio
 * pagina, mandato mentre l'accesso sta arrivando (un `refresh()` scritto dopo
 * questa funzione, in un ascolto dell'uscita, o un'azione server), si blocca allo
 * stesso modo. Oggi nel sito non ce n'è nessuno: non aggiungerne.
 * Ogni «Esci» del sito passa da qui. La prova, col vero motore dei cambi pagina
 * di Next: tests/unit/dopo-esci-la-pagina-non-resta-in-caricamento.test.ts
 */

/** Il pezzo del router che serve: si naviga e basta (niente `refresh`, vedi sopra). */
export type RouterDellUscita = { push: (href: string) => void };

export async function esciEVaiAllAccesso(
  router: RouterDellUscita,
  {
    verso = '/sign-in',
    esci = () => supabase.auth.signOut(),
  }: { verso?: string; esci?: () => Promise<unknown> } = {},
): Promise<void> {
  await esci();
  router.push(verso);
}
