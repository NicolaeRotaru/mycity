'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';

/**
 * Chiude un overlay (drawer/modale) con il tasto "indietro" di sistema invece
 * di far navigare la pagina. All'apertura inserisce una entry sintetica nella
 * history del browser: la pressione di "indietro" la consuma e si limita a
 * chiudere l'overlay (nessuna navigazione, nessun'altra azione).
 *
 * Se l'overlay viene chiuso dall'UI (X / backdrop / Escape) mentre la entry
 * sintetica è ancora in cima, la rimuove con `history.back()` per non lasciare
 * voci spurie nella cronologia.
 *
 * Ritorna un ref `navigating`: chi consuma l'hook lo imposta a `true` PRIMA di
 * far partire una navigazione (es. click su una voce di menu) e poi chiama
 * `onClose()`. In quel caso la pulizia NON esegue `history.back()`: quel back
 * genererebbe un `popstate` che l'App Router di Next interpreta come "torna
 * indietro", annullando la navigazione appena avviata (è il motivo per cui i
 * pulsanti del menu non funzionavano, mentre "Esci" sì: naviga in modo
 * asincrono, ben dopo il back).
 */
export function useCloseOnBack(
  open: boolean,
  onClose: () => void,
): MutableRefObject<boolean> {
  const pushedRef = useRef(false);
  const navigatingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

    navigatingRef.current = false;
    window.history.pushState({ __overlay: true }, '');
    pushedRef.current = true;

    const onPop = () => {
      // Il back ha già rimosso la entry sintetica: chiudi soltanto l'overlay.
      pushedRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (pushedRef.current) {
        pushedRef.current = false;
        // Chiusura via UI (X / backdrop / Escape): rimuovi la entry sintetica.
        // Se invece stiamo navigando, lascia stare: il back annullerebbe la
        // navigazione del link.
        if (!navigatingRef.current) {
          window.history.back();
        }
      }
    };
  }, [open]);

  return navigatingRef;
}
