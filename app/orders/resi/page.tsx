'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { LoadingState } from '@/components/ui/LoadingState';
import EmptyState from '@/components/EmptyState';
import { testoDelloStato } from '../[id]/stato-del-reso';

/**
 * 1/11/2026 — I RESI DEL CLIENTE, CON LO STATO DI OGNUNO.
 *
 * La voce «Resi» del menu account portava alla pagina delle regole (/returns):
 * chi aveva chiesto un reso non trovava da nessuna parte a che punto era, se
 * non aprendo ordine per ordine. Qui ci sono tutti, dal piu' recente, con la
 * stessa frase della pagina dell'ordine e il collegamento all'ordine.
 * Se la lettura non riesce lo si dice: una lista vuota direbbe «nessun reso».
 */
type RigaDellaLista = { id: string; order_id: string; status: string; created_at: string | null };

export default function IMieiResiPage() {
  const [resi, setResi] = useState<RigaDellaLista[] | null>(null);
  const [errore, setErrore] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: utente } = await supabase.auth.getUser();
      const id = utente?.user?.id;
      if (!id) {
        setResi([]);
        return;
      }
      const { data, error } = await supabase
        .from('returns')
        .select('id, order_id, status, created_at')
        .eq('buyer_id', id)
        .order('created_at', { ascending: false });
      if (error) setErrore(true);
      setResi((data ?? []) as RigaDellaLista[]);
    })();
  }, []);

  if (resi === null) return <LoadingState />;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-3xl font-extrabold text-ink-900">I miei resi</h1>
      <p className="mt-1 text-sm text-ink-500">
        A che punto sono le richieste di reso che hai fatto.{' '}
        <Link href="/returns" className="font-semibold text-primary-700 hover:underline">
          Come funzionano i resi
        </Link>
      </p>

      {errore ? (
        <p role="alert" className="mt-6 rounded-xl bg-secondary-50 p-4 text-sm text-secondary-800">
          Non riesco a leggere i tuoi resi in questo momento. Riprova fra poco, oppure apri l&apos;ordine
          da «Ordini»: lo stato del reso è anche lì.
        </p>
      ) : resi.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={RotateCcw}
            title="Nessun reso"
            description="Non hai ancora chiesto resi. Il reso si chiede dalla pagina dell'ordine."
            ctaLabel="I miei ordini"
            ctaHref="/orders"
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {resi.map((r) => (
            <li key={r.id} className="rounded-2xl border border-cream-300 bg-white p-4">
              <p className="font-semibold text-ink-900">{testoDelloStato(r.status)}</p>
              <p className="mt-1 text-sm text-ink-600">
                {r.created_at ? `Chiesto il ${new Date(r.created_at).toLocaleDateString('it-IT')} · ` : ''}
                <Link href={`/orders/${r.order_id}`} className="font-semibold text-primary-700 hover:underline">
                  Vai all&apos;ordine
                </Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
