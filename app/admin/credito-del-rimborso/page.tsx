'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatDate, formatPriceFromCents } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import type { EsitoDelControllo } from '@/lib/rimborsi/credito-da-controllare';

/**
 * IL CONTROLLO DEL CREDITO DI UN RIMBORSO (riesame del 16/10, quarto giro).
 *
 * Ci si arriva dall'avviso «Rimborso col credito da controllare»: il credito MyCity di un rimborso
 * in contanti e' uscito, ma in quel momento il diario del credito non ha risposto, e la cifra non
 * e' stata verificata. Prima l'avviso chiedeva di guardare il diario, e nessuna pagina lo
 * mostrava. Qui c'e' la riga, il saldo del cliente e il verdetto
 * (lib/rimborsi/credito-da-controllare.ts).
 */

type Risposta = {
  ref: string;
  attesoCents: number | null;
  righe: Array<{ id: string; delta_cents: number | null; created_at: string | null }>;
  saldoCents: number | null;
  verdetto: { esito: EsitoDelControllo; scrittoCents: number | null; frase: string };
};

function Controllo() {
  const parametri = useSearchParams();
  const ref = parametri.get('ref') ?? '';
  const atteso = parametri.get('atteso') ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'credito-del-rimborso', ref, atteso],
    enabled: ref.length > 0,
    queryFn: async (): Promise<Risposta> => {
      const { data: { session } } = await supabase.auth.getSession();
      const q = new URLSearchParams({ ref, ...(atteso ? { atteso } : {}) });
      const res = await fetch(`/api/admin/credito-del-rimborso?${q.toString()}`, {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {},
      });
      const corpo = await res.json();
      if (!res.ok) throw new Error(corpo?.error?.message ?? 'Controllo non disponibile');
      return corpo as Risposta;
    },
  });

  if (!ref) {
    return (
      <p className="text-sm text-ink-700">
        Apri questa pagina dall&apos;avviso «Rimborso col credito da controllare»: l&apos;indirizzo porta il riferimento
        del rimborso e la cifra da controllare.
      </p>
    );
  }
  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <p className="text-sm text-secondary-700">{error instanceof Error ? error.message : 'Controllo non disponibile'}</p>;
  }

  const colore =
    data.verdetto.esito === 'torna'
      ? 'border-olive-300 bg-olive-50 text-olive-800'
      : 'border-secondary-300 bg-secondary-50 text-secondary-800';

  return (
    <div className="space-y-4">
      <p className={`rounded-lg border p-3 text-sm font-semibold ${colore}`}>{data.verdetto.frase}</p>
      <div className="rounded-xl border border-cream-300 bg-white p-4 text-sm text-ink-800">
        <p>
          Riferimento: <span className="font-mono break-all">{data.ref}</span>
        </p>
        {data.attesoCents != null && <p className="mt-1">Rimborso registrato come credito: {formatPriceFromCents(data.attesoCents)}</p>}
        {data.righe.map((r) => (
          <p key={r.id} className="mt-1">
            Riga del diario: {formatPriceFromCents(Number(r.delta_cents ?? 0))}
            {r.created_at ? ` · ${formatDate(r.created_at)}` : ''}
          </p>
        ))}
        {data.saldoCents != null && <p className="mt-1">Credito MyCity del cliente adesso: {formatPriceFromCents(data.saldoCents)}</p>}
      </div>
    </div>
  );
}

export default function CreditoDelRimborsoPage() {
  return (
    <div>
      <AdminPageTitle
        eyebrow="Soldi"
        title="Credito di un rimborso"
        sub="Il controllo che chiede l'avviso «Rimborso col credito da controllare»: la riga del diario del credito, letta qui."
      />
      <Suspense fallback={<LoadingState />}>
        <Controllo />
      </Suspense>
    </div>
  );
}
