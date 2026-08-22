'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CreditCard, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { apiErrorMessage, friendlyError } from '@/lib/errors';
import { Button } from '@/components/ui/Button';

/**
 * 22/8/2026 — IL PEZZO MANCANTE ERA IL BOTTONE, NON L'ENDPOINT.
 *
 * `/api/seller/subscription/portal` esisteva, funzionava e non lo chiamava
 * nessuno: cercandolo in tutto il repo compariva solo dentro il file della
 * rotta stessa. Apre il portale Stripe dove il negoziante cambia la carta,
 * scarica le fatture o disdice l'abbonamento.
 *
 * Un negoziante che paga un canone e non ha un modo di gestirlo deve scrivere
 * a noi per disdire. È la forma peggiore di trattenere un cliente: non lo
 * trattiene, lo fa arrabbiare — e a noi costa una richiesta di assistenza per
 * ogni disdetta.
 */
export default function GestisciAbbonamento({ stato }: { stato: string | null | undefined }) {
  const [apertura, setApertura] = useState(false);

  // Senza un abbonamento mai attivato non c'è niente da gestire: la rotta
  // risponderebbe «Nessun abbonamento da gestire», e un bottone che porta a un
  // errore è peggio di un bottone che non c'è.
  if (!stato || stato === 'none' || stato === 'inactive') return null;

  const apriPortale = async () => {
    setApertura(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('Sessione scaduta: rientra e riprova.');
        return;
      }
      const res = await fetch('/api/seller/subscription/portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(apiErrorMessage(corpo, 'Non riesco ad aprire la gestione abbonamento.'));
        return;
      }
      const url = (corpo as { url?: string; data?: { url?: string } }).data?.url
        ?? (corpo as { url?: string }).url;
      if (!url) {
        toast.error('Non riesco ad aprire la gestione abbonamento.');
        return;
      }
      window.location.href = url;
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setApertura(false);
    }
  };

  return (
    <div className="bg-white border border-cream-300 rounded-2xl shadow-warm p-6">
      <h2 className="font-semibold text-ink-900 mb-1 flex items-center gap-2">
        <CreditCard size={18} className="text-primary-600 shrink-0" aria-hidden />
        Abbonamento
      </h2>
      <p className="text-sm text-ink-500 mb-4">
        Da qui cambi la carta, scarichi le fatture o disdici. Si apre la pagina
        sicura di Stripe: i dati della carta non passano da noi.
      </p>
      <Button onClick={apriPortale} loading={apertura} variant="secondary">
        <span className="inline-flex items-center gap-2">
          <ExternalLink size={16} aria-hidden />
          Gestisci l&apos;abbonamento
        </span>
      </Button>
    </div>
  );
}
