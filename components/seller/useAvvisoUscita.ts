'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { clicDaFermare } from '@/components/seller/site/dove-e-l-errore';

export const MESSAGGIO_USCITA = 'Hai modifiche non salvate: se esci le perdi. Uscire lo stesso?';

/**
 * R09-010 — Con modifiche non salvate: il browser avvisa se si chiude o ricarica la pagina
 * (beforeunload), e un clic su un collegamento interno (il menu del pannello) chiede conferma,
 * perché beforeunload i collegamenti di Next non li vede.
 */
export function useAvvisoUscita(dirty: boolean) {
  const pathname = usePathname();

  useEffect(() => {
    if (!dirty) return;
    const alRicarico = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', alRicarico);
    return () => window.removeEventListener('beforeunload', alRicarico);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const alClic = (e: MouseEvent) => {
      // clicDaFermare decide se è un collegamento interno verso un'altra pagina; il testo è nostro.
      if (clicDaFermare(e, dirty, pathname ?? '', () => window.confirm(MESSAGGIO_USCITA))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', alClic, true);
    return () => document.removeEventListener('click', alClic, true);
  }, [dirty, pathname]);
}
