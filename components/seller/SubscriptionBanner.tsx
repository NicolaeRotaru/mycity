'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { FILTRO_PRIMO_INCASSO } from '@/lib/abbonamento-primo-incasso';
import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/errors';
import { Button } from '@/components/ui/Button';
import { apiErrorMessage } from '@/lib/errors';
import { ABBONAMENTO_NEGOZI_ACCESO } from '@/lib/funzioni-al-lancio';
// 31/8/2026 (R037) — La percentuale non si scrive qui: arriva da dove viene poi
// trattenuta sul venduto, cosi' non puo' piu' restare indietro da sola.
import { COMMISSIONE_DEL_PERCENTO, PREZZO_ABBONAMENTO_MESE } from '@/app/seller/earnings/commissione';
// 184 — `json.error` funziona solo se il server risponde `{error:'testo'}`.
// Le rotte rispondono `{ok:false, error:{code,message}}`: `json.error` era
// un oggetto, quindi falso-y mai e stringa mai, e finiva sempre nel
// messaggio di riserva. Su tre schermate che portano soldi la persona
// leggeva «Errore nel pagamento» invece del motivo vero — che il server
// aveva scritto e mandato. `apiErrorMessage` legge tutte e due le forme.

/**
 * Avviso (non bloccante) per i venditori senza abbonamento attivo. Mostra una
 * CTA per attivare/riprendere l'abbonamento €50/mese via Stripe. Per scelta di
 * prodotto NON limita l'accesso alla dashboard: è solo un promemoria.
 */
export function SubscriptionBanner({ status }: { status: string | null | undefined }) {
  const [loading, setLoading] = useState(false);
  const isPastDue = status === 'past_due';
  // Collaudo K03 (R10-020) — L'invito ad attivare segue la regola della cassa: solo dopo il primo
  // incasso. Prima il banner lo mostrava al negozio appena approvato, e il tasto rispondeva 403.
  // Finché non si sa (lettura in corso o caduta) l'invito non si mostra. Chi è in ritardo di
  // pagamento ha già un abbonamento: per lui l'avviso resta.
  const chiedeIncasso = ABBONAMENTO_NEGOZI_ACCESO && status !== 'active' && !isPastDue;
  const [haIncassato, setHaIncassato] = useState<boolean | null>(null);
  useEffect(() => {
    if (!chiedeIncasso) return;
    let vivo = true;
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('orders')
          .select('id')
          .eq('seller_id', user.id)
          .or(FILTRO_PRIMO_INCASSO)
          .limit(1);
        if (vivo && !error) setHaIncassato(Array.isArray(data) && data.length > 0);
      } catch {
        // Non si sa: l'invito resta nascosto.
      }
    })();
    return () => { vivo = false; };
  }, [chiedeIncasso]);

  // 31/10/2026 — Abbonamento sospeso al lancio (ABBONAMENTO_NEGOZI_ACCESO): nessun
  // invito a pagare 50 € al mese che la rotta poi rifiuterebbe.
  if (!ABBONAMENTO_NEGOZI_ACCESO || status === 'active') return null;
  if (!isPastDue && haIncassato !== true) return null;

  const start = async () => {
    setLoading(true);
    try {
      // 12/11/2026 (R10-022) — Con il pagamento non riuscito l'abbonamento c'e' gia': la cassa
      // risponde «risulta già un abbonamento» (409). La carta si aggiorna nel portale Stripe.
      const porta = isPastDue ? '/api/seller/subscription/portal' : '/api/seller/subscription/checkout';
      const res = await fetch(porta, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(apiErrorMessage(json, 'Errore nell’attivazione'));
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
                ? `L’ultimo pagamento dell’abbonamento (${PREZZO_ABBONAMENTO_MESE}/mese) non è andato a buon fine. Aggiorna il metodo di pagamento per non perdere visibilità.`
                : `L’abbonamento venditore costa ${PREZZO_ABBONAMENTO_MESE}/mese. Attivalo per supportare la piattaforma — la commissione sulle vendite è ${COMMISSIONE_DEL_PERCENTO}.`}
            </p>
          </div>
        </div>
        <Button onClick={start} loading={loading} icon={CreditCard} className="shrink-0">
          {isPastDue ? 'Aggiorna pagamento' : `Attiva ${PREZZO_ABBONAMENTO_MESE}/mese`}
        </Button>
      </div>
    </div>
  );
}
