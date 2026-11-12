'use client';

import { useEffect } from 'react';

/**
 * R11-015 — LE MODIFICHE NON SALVATE NON SI PERDONO IN SILENZIO.
 *
 * Dettagli del negozio e profilo si perdevano chiudendo la scheda, ricaricando
 * o tornando indietro, senza nessun avviso. Finché `sporco` è vero il browser
 * chiede conferma prima di lasciare la pagina.
 */
export const DOMANDA_USCITA = 'Hai modifiche non salvate: se esci le perdi. Vuoi uscire lo stesso?';

export function useAvvisoModificheNonSalvate(sporco: boolean): void {
  useEffect(() => {
    if (!sporco) return;
    const avvisa = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Alcuni browser vogliono ancora returnValue impostato.
      e.returnValue = DOMANDA_USCITA;
      return DOMANDA_USCITA;
    };
    window.addEventListener('beforeunload', avvisa);
    return () => window.removeEventListener('beforeunload', avvisa);
  }, [sporco]);
}
