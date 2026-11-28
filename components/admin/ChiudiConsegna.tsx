'use client';

/**
 * 28/11/2026 (onda 2, R06-004) — «CHIUDI LA CONSEGNA», PER QUANDO IL FATTORINO SPARISCE.
 *
 * Una consegna in contanti in strada (OUT_FOR_DELIVERY) si chiude solo col codice che il cliente
 * detta al fattorino. Se il fattorino non riapre più l'app l'ordine resta «in consegna» per sempre e
 * il negozio non viene pagato. Qui l'amministratore la chiude al posto suo, con i contanti dichiarati
 * a voce dal fattorino e un motivo scritto: la rotta /api/admin/chiudi-consegna chiama la funzione
 * del database (migrazione 360), che scrive consegna e incasso insieme e lascia la riga nel registro.
 *
 * Solo dove la funzione lo accetta: contanti, consegna a domicilio, con un fattorino, in strada.
 * In «ritirato» (PICKED_UP) la merce non è arrivata alla porta: lì si annulla, non si chiude.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { friendlyError } from '@/lib/errors';
import { contanteDaRimettereCents } from '@/lib/shipping';
import { Button } from '@/components/ui/Button';

/** Il più corto motivo che la funzione del database accetta (360: `length(v_motivo) < 10`). */
export const MOTIVO_MINIMO = 10;

export type OrdineDaChiudere = {
  id: string;
  payment_method: string | null;
  delivery_status: string | null;
  rider_id: string | null;
  pickup_in_store: boolean | null;
  total_price: number | string | null;
  rider_fee_cents: number | null;
  shipping_cost: number | string | null;
  cash_confirmed_at: string | null;
};

/** Le stesse condizioni della 360: contanti, a domicilio, con un fattorino, in strada. */
export function consegnaDaChiudereAMano(o: Pick<OrdineDaChiudere, 'payment_method' | 'delivery_status' | 'rider_id' | 'pickup_in_store'>): boolean {
  return o.payment_method === 'cod' && o.delivery_status === 'OUT_FOR_DELIVERY' && !!o.rider_id && !o.pickup_in_store;
}

export function ChiudiConsegna({ ordine, onChiusa }: { ordine: OrdineDaChiudere; onChiusa: () => void }) {
  const giaDichiarato = !!ordine.cash_confirmed_at;
  const [aperto, setAperto] = useState(false);
  const [importo, setImporto] = useState((contanteDaRimettereCents(ordine) / 100).toFixed(2));
  const [motivo, setMotivo] = useState('');

  const chiudi = useMutation({
    mutationFn: async () => {
      let incassatoCents: number | null = null;
      if (!giaDichiarato) {
        const cents = Math.round(parseFloat(importo.replace(',', '.')) * 100);
        if (!Number.isFinite(cents) || cents < 0) throw new Error('Scrivi i contanti dichiarati dal fattorino');
        incassatoCents = cents;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/admin/chiudi-consegna', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ orderId: ordine.id, incassatoCents, motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? 'Chiusura della consegna non riuscita');
      return data as { incassoRegistrato?: boolean };
    },
    onSuccess: (data) => {
      toast.success(
        data?.incassoRegistrato
          ? 'Consegna chiusa e incasso registrato. Ora conferma la rimessa per pagare il negozio.'
          : 'Consegna chiusa.',
      );
      setAperto(false);
      onChiusa();
    },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  if (!aperto) {
    return (
      <button
        type="button"
        onClick={() => setAperto(true)}
        className="text-sm font-semibold text-primary-700 hover:text-primary-900 hover:underline"
      >
        Chiudi la consegna
      </button>
    );
  }

  return (
    <form
      aria-label="Chiudi la consegna"
      className="w-full space-y-2 rounded-xl border border-primary-200 bg-primary-50 p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        chiudi.mutate();
      }}
    >
      <p className="text-ink-700">
        Il fattorino non chiude la consegna? Chiudila tu come consegnata.{' '}
        {giaDichiarato
          ? 'I contanti li aveva già dichiarati lui: resta solo da chiudere.'
          : 'Scrivi i contanti che ti ha dichiarato: la rimessa li aspetterà da lui.'}
      </p>
      {!giaDichiarato && (
        <label className="block text-xs text-ink-700">
          Contanti dichiarati (€)
          <input
            name="incassato"
            type="number"
            step="0.01"
            min="0"
            value={importo}
            onChange={(e) => setImporto(e.target.value)}
            className="ml-1 w-28 rounded border border-cream-300 px-2 py-1 font-mono"
          />
        </label>
      )}
      <label className="block text-xs text-ink-700">
        Perché la chiudi tu (almeno {MOTIVO_MINIMO} caratteri)
        <input
          name="motivo"
          type="text"
          value={motivo}
          maxLength={300}
          onChange={(e) => setMotivo(e.target.value)}
          className="mt-0.5 block w-full rounded border border-cream-300 px-2 py-1"
        />
      </label>
      <div className="flex gap-2">
        <Button size="sm" type="submit" loading={chiudi.isPending} disabled={motivo.trim().length < MOTIVO_MINIMO}>
          Chiudi come consegnata
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setAperto(false)}>
          Lascia stare
        </Button>
      </div>
    </form>
  );
}
