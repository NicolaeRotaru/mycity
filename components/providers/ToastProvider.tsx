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
    window.addEventListener('cart:non-salvato', avvisa);
    return () => window.removeEventListener('cart:non-salvato', avvisa);
  }, []);

  return <Toaster position="top-right" richColors />;
};

export default ToastProvider;
