'use client';

import { useEffect, type RefObject } from 'react';

/**
 * #134 — La correzione esisteva già, a un file di distanza.
 *
 * Il pannello dei filtri della RICERCA aveva tutto: blocco dello scorrimento,
 * uscita con Esc, fuoco che entra nel pannello e torna al pulsante quando si
 * chiude. Il pannello dei filtri della CATEGORIA, che si apre uguale e si
 * dichiara `aria-modal`, non aveva niente: dichiarava di essere un dialogo
 * modale e si comportava come un pezzo di pagina. Da tastiera si finiva dietro
 * il velo senza modo di uscire, e chi usa uno screen reader restava chiuso
 * dentro un dialogo che non era un dialogo.
 *
 * Stava scritto in un solo file perché nessuno l'aveva estratto. Ora sta qui, e
 * la regola è: nessun overlay del marketplace scritto a mano — o passa da
 * `components/ui/Modal.tsx`, o passa da questo hook.
 */
// Bottom-sheet mobile: scroll-lock + Esc, focus-trap e ritorno del focus al
// trigger alla chiusura (WCAG 2.1.2 / 2.4.3). Condiviso tra pannello filtri e ordina.
export function useBottomSheetA11y(
  open: boolean,
  sheetRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
  /** Un menu a tendina (le notifiche del negozio) non blocca lo scorrimento della pagina. */
  opzioni: { bloccaScorrimento?: boolean; indietroChiude?: boolean } = {},
) {
  const blocca = opzioni.bloccaScorrimento !== false;
  const indietroChiude = opzioni.indietroChiude === true;
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const focusables = () =>
      sheetRef.current
        ? Array.from(
            sheetRef.current.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    // All'apertura sposta il focus dentro al pannello.
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    if (blocca) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (blocca) document.body.style.overflow = '';
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Il pannello dei filtri sul telefono sembra una pagina: col pannello aperto il tasto Indietro
  // faceva uscire dalla ricerca. Con `indietroChiude`, all'apertura si aggiunge una voce di
  // cronologia sulla stessa pagina: Indietro toglie quella e chiude il pannello. Chiuso in altro
  // modo (X, velo, Esc, «Mostra risultati») la voce si toglie subito, così non resta un Indietro
  // a vuoto da premere due volte.
  useEffect(() => {
    if (!open || !indietroChiude || typeof window === 'undefined') return;
    const percorso = window.location.pathname;
    const stato = window.history.state;
    window.history.pushState({ ...(stato && typeof stato === 'object' ? stato : {}), pannelloAperto: true }, '');
    let chiusoDaIndietro = false;
    const onPopState = () => {
      chiusoDaIndietro = true;
      onClose();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Se nel frattempo si è andati su un'altra pagina, la voce non è più in cima: non si torna indietro.
      if (!chiusoDaIndietro && window.location.pathname === percorso) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, indietroChiude]);
}
