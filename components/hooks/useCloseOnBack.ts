'use client';

import { useEffect, useRef } from 'react';

/**
 * Chiude un overlay (drawer/modale) con il tasto "indietro" di sistema invece
 * di far navigare la pagina. All'apertura inserisce una entry sintetica nella
 * history del browser: la pressione di "indietro" la consuma e si limita a
 * chiudere l'overlay (nessuna navigazione, nessun'altra azione).
 *
 * Se l'overlay viene chiuso dall'UI (X / backdrop / Escape) mentre la entry
 * sintetica è ancora in cima, la rimuove con `history.back()` per non lasciare
 * voci spurie nella cronologia.
 */
export function useCloseOnBack(open: boolean, onClose: () => void) {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;

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
      // Chiusura via UI: la entry sintetica è ancora presente → rimuovila.
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [open]);
}
