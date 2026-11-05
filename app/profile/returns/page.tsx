'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { statoDelReso, type RigaReso } from '@/app/orders/[id]/stato-del-reso';

/**
 * 5/11/2026 — I MIEI RESI.
 *
 * La voce «Resi» del menu dell'account portava alla pagina con le regole dei resi, non ai
 * resi che il cliente aveva chiesto: lo stato si vedeva solo aprendo un ordine alla volta.
 * Qui ci sono le richieste, con la stessa frase di stato della pagina dell'ordine
 * (`statoDelReso`), e il collegamento alle regole resta in fondo.
 */
type Reso = RigaReso & { order_id: string };

export default function IMieiResiPage() {
  const { data: resi = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['returns', 'mine'],
    queryFn: async (): Promise<Reso[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('returns')
        .select('id, order_id, status, created_at')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Reso[];
    },
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.05em] text-primary-700">Account</p>
        <h1 className="mt-0.5 font-serif text-3xl font-extrabold leading-tight text-ink-900">I miei resi</h1>
        <p className="mt-1 text-sm text-ink-500">Le richieste di reso che hai fatto e a che punto sono.</p>
      </header>

      {isError ? (
        <ErrorState
          variant="compact"
          title="Non riusciamo a leggere i tuoi resi"
          description="Controlla la connessione e riprova."
          onRetry={() => void refetch()}
        />
      ) : resi.length === 0 ? (
        <div className="rounded-2xl border border-cream-300 bg-white p-8 text-center">
          <RotateCcw size={28} className="mx-auto mb-2 text-ink-300" aria-hidden />
          <p className="text-sm text-ink-600">Non hai ancora chiesto nessun reso.</p>
          <p className="mt-1 text-xs text-ink-500">Un reso si chiede dalla pagina dell&apos;ordine.</p>
        </div>
      ) : (
        <ul className="divide-y divide-cream-200 rounded-2xl border border-cream-300 bg-white">
          {resi.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <div>
                <p className="font-semibold text-ink-900">{statoDelReso([r])?.testo}</p>
                {r.created_at && (
                  <p className="text-xs text-ink-500">
                    Chiesto il {new Date(r.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>
              <Link href={`/orders/${r.order_id}`} className="text-sm font-semibold text-primary-700 underline">
                Vedi l&apos;ordine
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-ink-600">
        Come funzionano i resi: <Link href="/returns" className="text-primary-700 underline">regole dei resi e rimborsi</Link>.
      </p>
    </div>
  );
}
