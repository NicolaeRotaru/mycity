'use client';

import { useEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';

/**
 * R01-001 — LA X DEGLI AVVISI PARLA ITALIANO, E C'È SOLO DOVE CHIUDE.
 * sonner 1.7.4 chiama la X «Close toast» e non lascia cambiarla dal Toaster
 * (`closeButtonAriaLabel` non gli arriva); e su un avviso di caricamento la X
 * c'è ma non fa niente (sonner non chiude mai un «loading»). Qui ogni X prende
 * l'etichetta italiana, e sui caricamenti non si mostra: quando il caricamento
 * diventa un esito (stesso id) la X torna, e quella chiude davvero.
 *
 * LA PROVA: tests/unit/riparazione-r01-la-x-degli-avvisi.test.tsx
 */
const ETICHETTA_CHIUDI_AVVISO = 'Chiudi avviso';

function sistemaLeX(radice: HTMLElement) {
  radice.querySelectorAll<HTMLButtonElement>('button[data-close-button]').forEach((x) => {
    if (x.getAttribute('aria-label') !== ETICHETTA_CHIUDI_AVVISO) x.setAttribute('aria-label', ETICHETTA_CHIUDI_AVVISO);
    const inCaricamento = x.closest('[data-sonner-toast]')?.getAttribute('data-type') === 'loading';
    const display = inCaricamento ? 'none' : '';
    if (x.style.display !== display) x.style.display = display;
  });
}

/**
 * 22/8/2026 — L'AVVISO CHE IL CARRELLO NON SI È SALVATO.
 *
 * `localStorage.setItem` lancia quando lo spazio del browser è pieno, e in
 * navigazione privata su alcuni browser lancia comunque. Prima quell'eccezione
 * risaliva fino a chi aveva premuto «Aggiungi al carrello»: nessun prodotto
 * aggiunto, nessun messaggio, niente.
 *
 * Adesso `saveCart` non lancia più — il carrello resta in memoria per questa
 * visita — ma emette un evento, e qui lo si dice. Sta nel provider dei
 * messaggi perché l'avviso deve arrivare da qualunque pagina, non solo dal
 * carrello.
 */
const ToastProvider = () => {
  const contenitore = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const radice = contenitore.current;
    if (!radice || typeof MutationObserver === 'undefined') return;
    sistemaLeX(radice);
    const osservatore = new MutationObserver(() => sistemaLeX(radice));
    osservatore.observe(radice, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-type', 'aria-label'] });
    return () => osservatore.disconnect();
  }, []);

  useEffect(() => {
    const avvisa = (e: Event) => {
      const motivo = (e as CustomEvent<{ motivo?: string }>).detail?.motivo;
      toast.warning(motivo ?? 'Il browser non riesce a salvare il carrello.', {
        duration: 8000,
      });
    };
    // 22/8/2026 — e il tetto dei 99 pezzi, che prima si scopriva alla cassa.
    const tetto = (e: Event) => {
      const motivo = (e as CustomEvent<{ motivo?: string }>).detail?.motivo;
      toast.info(motivo ?? 'Hai raggiunto il massimo per questo articolo.', { duration: 7000 });
    };
    window.addEventListener('cart:non-salvato', avvisa);
    window.addEventListener('cart:tetto-raggiunto', tetto);
    return () => {
      window.removeEventListener('cart:non-salvato', avvisa);
      window.removeEventListener('cart:tetto-raggiunto', tetto);
    };
  }, []);

  /**
   * 6/9/2026 — GLI AVVISI PARLANO COI COLORI DI MYCITY.
   *
   * `richColors` accendeva la tavolozza di fabbrica di sonner: verde, rosso, ambra e
   * blu saturi. Il blu era l'unico di tutto il marketplace, e ogni «aggiunto al
   * carrello» lo mostrava. Qui i quattro stati tornano sui colori del marchio —
   * oliva per il buon esito, vino per l'errore, mostarda per l'avviso, crema per
   * l'informazione. Le classi vincono di sicuro: sonner avvolge le sue regole in
   * `:where(...)`, che pesa zero nel foglio di stile.
   */
  /*
   * 12/11/2026 (R12-003) — Gli avvisi sparivano da soli dopo 4 secondi (il
   * default di sonner) e non avevano la X: un cliente che legge piano perdeva
   * l'errore prima di finirlo, senza modo di riaprirlo. Ora restano 8 secondi
   * (qui sonner non distingue la durata per tipo) e si chiudono con la X.
   */
  return (
    // `contents`: il contenitore serve solo a trovare le X, non disegna niente.
    <div ref={contenitore} className="contents">
      <Toaster
        position="top-right"
        closeButton
        toastOptions={{
          duration: DURATA_AVVISI_MS,
          classNames: {
            success: 'bg-olive-50 text-olive-800 border-olive-200',
            error: 'bg-secondary-50 text-secondary-800 border-secondary-200',
            warning: 'bg-accent-50 text-accent-800 border-accent-200',
            info: 'bg-cream-100 text-ink-800 border-cream-300',
          },
        }}
      />
    </div>
  );
};

/** Quanto resta a schermo un avviso: abbastanza per leggere una frase con calma. */
export const DURATA_AVVISI_MS = 8000;

export default ToastProvider;
