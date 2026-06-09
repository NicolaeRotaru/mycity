'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * Stato di errore per le pagine admin che caricano dati: invece di restare bloccate
 * sullo spinner quando la query fallisce (es. tabella/migrazione mancante), mostra un
 * messaggio chiaro con "Riprova".
 */
export function LoadError({ onRetry, hint }: { onRetry: () => void; hint?: string }) {
  return (
    <div className="bg-white border border-amber-200 rounded-2xl p-8 text-center space-y-3 max-w-lg mx-auto mt-6">
      <AlertTriangle className="mx-auto text-amber-500" size={28} aria-hidden />
      <p className="text-ink-900 font-semibold">Impossibile caricare i dati</p>
      <p className="text-sm text-ink-500">{hint ?? 'Riprova tra poco.'}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
      >
        <RotateCcw size={15} aria-hidden /> Riprova
      </button>
    </div>
  );
}
