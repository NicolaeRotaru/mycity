'use client';

import { useEffect, useState, type RefObject } from 'react';

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
/**
 * Le voci di cronologia dei pannelli con `indietroChiude` non ancora tolte, in tutta la pagina: un
 * pannello aperto, o un history.back() partito col popstate non ancora arrivato. Fa da guardia al
 * salto della voce orfana (sotto): con una voce già in gioco non si torna indietro una seconda volta.
 */
let vociDeiPannelli = 0;

/** Toglie la voce del pannello che è in cima; `tolta` parte dopo il suo popstate. */
function tornaSottoLaVoce(tolta: () => void) {
  let fatto = false;
  let riserva: ReturnType<typeof setTimeout> | undefined;
  const arrivato = () => {
    if (fatto) return;
    fatto = true;
    window.removeEventListener('popstate', arrivato);
    if (riserva !== undefined) clearTimeout(riserva);
    // Dopo il giro del popstate, quando il ritorno di Next è già partito.
    setTimeout(tolta, 0);
  };
  window.addEventListener('popstate', arrivato);
  // Se il popstate non arrivasse, la voce non deve restare «in uscita» per sempre.
  riserva = setTimeout(arrivato, 1500);
  window.history.back();
}

// Bottom-sheet mobile: scroll-lock + Esc, focus-trap e ritorno del focus al
// trigger alla chiusura (WCAG 2.1.2 / 2.4.3). Condiviso tra pannello filtri e ordina.
//
// Con `indietroChiude` restituisce `true` finché la voce di cronologia del pannello c'è: dall'apertura
// fino al popstate che la toglie (anche dopo la chiusura con X, Esc o «Mostra risultati», il cui
// history.back() arriva un attimo dopo). Chi riscrive l'indirizzo con router.replace aspetta che torni
// `false`: un replace fatto prima finisce sulla voce del pannello, e il ritorno indietro lo butta (se è
// in volo Next lo scarta, perché il popstate ha la precedenza; se è concluso, la voce di sotto ha
// l'indirizzo di prima). I filtri scelti sparivano dall'indirizzo.
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
  const [voceInCronologia, setVoceInCronologia] = useState(false);
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
    vociDeiPannelli += 1;
    setVoceInCronologia(true);
    let giaTolta = false;
    const tolta = () => {
      if (giaTolta) return;
      giaTolta = true;
      vociDeiPannelli = Math.max(0, vociDeiPannelli - 1);
      setVoceInCronologia(false);
    };
    let chiusoDaIndietro = false;
    const onPopState = () => {
      chiusoDaIndietro = true;
      window.removeEventListener('popstate', onPopState);
      onClose();
      setTimeout(tolta, 0);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (chiusoDaIndietro) return;
      if (window.location.pathname === percorso) tornaSottoLaVoce(tolta);
      // Si è andati su un'altra pagina: la voce non è più in cima e non si torna indietro.
      else setTimeout(tolta, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, indietroChiude]);

  // Si è lasciata la pagina col pannello aperto, e con Indietro si torna sulla voce del pannello: la
  // pagina rinasce col pannello chiuso, e quella voce sarebbe un Indietro a vuoto. Si toglie subito.
  // La conta delle voci fa da guardia: il doppio montaggio di Strict Mode, il secondo pannello della
  // stessa pagina, o un ritorno già in corso non tornano indietro una seconda volta.
  useEffect(() => {
    if (!indietroChiude || typeof window === 'undefined' || vociDeiPannelli > 0) return;
    const stato = window.history.state as { pannelloAperto?: unknown } | null;
    if (!stato || typeof stato !== 'object' || stato.pannelloAperto !== true) return;
    vociDeiPannelli += 1;
    setVoceInCronologia(true);
    tornaSottoLaVoce(() => {
      vociDeiPannelli = Math.max(0, vociDeiPannelli - 1);
      setVoceInCronologia(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return indietroChiude && voceInCronologia;
}
