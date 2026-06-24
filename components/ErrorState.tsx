'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Stato di ERRORE riusabile — speculare a EmptyState (stessa impronta visiva),
 * ma per i fallimenti di caricamento (rete/DB), NON per il vuoto reale.
 *
 * Perché esiste: diverse liste (prodotti, ordini, preferiti, negozi) su errore di
 * rete mostravano lo stato "vuoto" ("Nessun risultato"), facendo credere all'utente
 * che non ci fosse nulla quando invece il caricamento era fallito. Qui diamo un
 * messaggio onesto + un'azione "Riprova" (refetch).
 */

type Props = {
  title?: string;
  description?: string;
  /** Se fornito, mostra il pulsante "Riprova" (tipicamente il refetch di React Query). */
  onRetry?: () => void;
  variant?: 'default' | 'compact';
  className?: string;
};

export default function ErrorState({
  title = 'Qualcosa è andato storto',
  description = 'Non siamo riusciti a caricare i dati. Controlla la connessione e riprova.',
  onRetry,
  variant = 'default',
  className = '',
}: Props) {
  const isCompact = variant === 'compact';
  return (
    <div role="alert" className={`text-center ${isCompact ? 'py-6' : 'py-12'} px-4 ${className}`}>
      <div
        className={`mx-auto rounded-full flex items-center justify-center mb-3 bg-secondary-50 text-secondary-700 ${
          isCompact ? 'w-12 h-12' : 'w-16 h-16'
        }`}
      >
        <AlertTriangle size={isCompact ? 22 : 28} strokeWidth={2} aria-hidden />
      </div>
      <h3 className={`font-serif text-ink-900 font-bold ${isCompact ? 'text-base' : 'text-lg'}`}>{title}</h3>
      {description && (
        <p className={`text-ink-500 mt-1 max-w-md mx-auto ${isCompact ? 'text-xs' : 'text-sm'}`}>{description}</p>
      )}
      {onRetry && (
        <div className="mt-4 flex items-center justify-center">
          <Button variant="secondary" size="sm" shape="pill" icon={RotateCcw} onClick={onRetry}>
            Riprova
          </Button>
        </div>
      )}
    </div>
  );
}
