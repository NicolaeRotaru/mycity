'use client';

import { useState } from 'react';
import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

/**
 * Avviso (non bloccante) per i venditori senza abbonamento attivo. Mostra una
 * CTA per attivare/riprendere l'abbonamento €50/mese via Stripe. Per scelta di
 * prodotto NON limita l'accesso alla dashboard: è solo un promemoria.
 */
export function SubscriptionBanner({ status }: { status: string | null | undefined }) {
  const [loading, setLoading] = useState(false);
  if (status === 'active') return null;

  const isPastDue = status === 'past_due';

  const start = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/seller/subscription/checkout', { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || 'Errore nell’attivazione');
      window.location.href = json.url as string;
    } catch (e) {
      toast.error(friendlyError(e));
      setLoading(false);
    }
  };

  return (
    <div className="mb-5 rounded-2xl border-2 border-accent-200 bg-accent-50 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-xl bg-accent-100 flex items-center justify-center text-accent-700">
            <CreditCard size={20} />
          </div>
          <div>
            <p className="font-bold text-ink-900">
              {isPastDue ? 'Abbonamento in sospeso' : 'Attiva il tuo abbonamento'}
            </p>
            <p className="text-sm text-ink-600">
              {isPastDue
                ? 'L’ultimo pagamento dell’abbonamento (€50/mese) non è andato a buon fine. Aggiorna il metodo di pagamento per non perdere visibilità.'
                : 'L’abbonamento venditore costa €50/mese. Attivalo per supportare la piattaforma — la commissione sulle vendite è del 10%.'}
            </p>
          </div>
        </div>
        <Button onClick={start} loading={loading} icon={CreditCard} className="shrink-0">
          {isPastDue ? 'Aggiorna pagamento' : 'Attiva €50/mese'}
        </Button>
      </div>
    </div>
  );
}
