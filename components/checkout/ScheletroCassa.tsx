'use client';

import { Card } from '@/components/ui/Card';

/**
 * LO SCHELETRO DELLA CASSA, MENTRE ARRIVANO I GRUPPI DEL CARRELLO.
 *
 * ── Il difetto che ha prodotto questo file ──────────────────────────────────
 * Il checkout, in attesa, restituiva `<LoadingState />` al posto dell'INTERA
 * pagina: titolo, indicatore dei passi, riepilogo e pulsante di pagamento
 * sparivano e restava un cerchietto in mezzo al bianco. La pagina collassava e
 * si riapriva nel punto in cui la persona è più tesa — ed era l'unica pagina
 * del percorso d'acquisto senza scheletro, mentre home, ricerca, prodotto e
 * negozio ne hanno uno.
 *
 * Qui la struttura vera resta a schermo: tre riquadri a sinistra e il riepilogo
 * a destra, con le stesse card del percorso d'acquisto. Cambia solo il
 * contenuto, che arriva.
 */
export function ScheletroCassa() {
  return (
    <div role="status" aria-live="polite" aria-label="Sto preparando il riepilogo dell'ordine" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        {[0, 1, 2].map((i) => (
          <Card key={i} variant="funnel" padding="lg">
            <div className="flex items-center gap-2.5 mb-4" aria-hidden>
              <div className="skeleton h-7 w-7 rounded-full" />
              <div className="skeleton h-4 w-44 rounded" />
            </div>
            <div className="space-y-2.5" aria-hidden>
              <div className="skeleton h-10 rounded-lg" />
              <div className="skeleton h-10 rounded-lg" />
              <div className="skeleton h-10 w-2/3 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>

      <div className="h-fit">
        <Card variant="funnel" padding="none" className="overflow-hidden">
          <div className="bg-surface-50 border-b border-surface-200 px-5 py-3" aria-hidden>
            <div className="skeleton h-4 w-24 rounded" />
          </div>
          <div className="px-5 py-4 space-y-3" aria-hidden>
            <div className="skeleton h-4 rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton h-12 rounded-lg" />
          </div>
        </Card>
      </div>
    </div>
  );
}
