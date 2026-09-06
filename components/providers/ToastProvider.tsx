'use client';

import { useEffect } from 'react';
import { Toaster, toast } from 'sonner';

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
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        classNames: {
          success: 'bg-olive-50 text-olive-800 border-olive-200',
          error: 'bg-secondary-50 text-secondary-800 border-secondary-200',
          warning: 'bg-accent-50 text-accent-800 border-accent-200',
          info: 'bg-cream-100 text-ink-800 border-cream-300',
        },
      }}
    />
  );
};

export default ToastProvider;
