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
  sheetRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLButtonElement | null>,
  onClose: () => void,
) {
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
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      trigger?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
