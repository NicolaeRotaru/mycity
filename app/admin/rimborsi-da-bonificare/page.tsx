'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPriceFromCents, formatDate } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import type { VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

/**
 * R71 — I BONIFICI DI RIMBORSO DA FARE.
 *
 * Chi paga in contanti e restituisce un prodotto riceve il rimborso col
 * bonifico, salvo che abbia scelto il credito MyCity. Il bonifico lo fa a mano
 * chi amministra: questa pagina e' la sua lista, con l'IBAN che il cliente ha
 * scritto nel modulo di reso. L'IBAN arriva dal server (la colonna e' chiusa al
 * browser, migrazione 162) e lo vede solo chi amministra: il negozio no.
 *
 * Collaudo del 15/10 — nella lista ci sono anche i bonifici dei reclami chiusi
 * a favore del cliente: prima vivevano solo nell'avviso della campanella.
 */

type Risposta = { voci: VoceDaBonificare[]; migrazione162: boolean };

const CHIAVE = ['admin', 'rimborsi-da-bonificare'] as const;

async function conToken(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {};
}

export default function RimborsiDaBonificarePage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: CHIAVE,
    queryFn: async (): Promise<Risposta> => {
      const res = await fetch('/api/admin/rimborsi-da-bonificare', { headers: await conToken() });
      const corpo = await res.json();
      if (!res.ok) throw new Error(corpo?.error?.message ?? 'Lista dei bonifici non disponibile');
      return corpo as Risposta;
    },
  });

  const fatto = useMutation({
    mutationFn: async (voce: Pick<VoceDaBonificare, 'tipo' | 'id'>) => {
      const res = await fetch('/api/admin/rimborsi-da-bonificare', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await conToken()) },
        body: JSON.stringify(voce.tipo === 'reclamo' ? { reclamoId: voce.id } : { resoId: voce.id }),
      });
      const corpo = await res.json();
      if (!res.ok) throw new Error(corpo?.error?.message ?? 'Bonifico non segnato');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CHIAVE });
      toast.success('Bonifico segnato come fatto');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  const voci = data?.voci ?? [];
  const daFare = voci.filter((v) => v.daFare);

  return (
    <div>
      <AdminPageTitle
        eyebrow="Soldi"
        title="Rimborsi da bonificare"
        sub="Resi e reclami di ordini pagati in contanti, da rimborsare con un bonifico che fai tu. Il credito MyCity arriva da solo: qui c'è solo il bonifico."
      />

      {data && !data.migrazione162 && (
        <p className="mb-4 rounded-xl border border-accent-300 bg-accent-50 p-4 text-sm text-ink-800">
          Sul database manca la migrazione 162: la lista dei resi c&apos;è, ma senza IBAN e senza il pulsante «Fatto»,
          e i bonifici dei reclami non compaiono (li trovi solo negli avvisi). Finché non è applicata, chiedi
          l&apos;IBAN al cliente e tieni il conto dei bonifici a parte.
        </p>
      )}

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <p className="rounded-xl border border-secondary-300 bg-white p-4 text-sm text-secondary-700">
          {friendlyError(error)}
        </p>
      ) : voci.length === 0 ? (
        <p className="rounded-xl border border-cream-300 bg-white p-6 text-sm text-ink-600">
          Nessun bonifico di rimborso da fare.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-600">
            Da fare: <strong>{daFare.length}</strong> su {voci.length}.
          </p>
          <ul className="space-y-3">
            {voci.map((v) => (
              <li
                key={`${v.tipo}-${v.id}`}
                className={`rounded-xl border bg-white p-4 ${v.daFare ? 'border-primary-300' : 'border-cream-300 opacity-70'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    {v.importoCents != null ? (
                      <p className="text-lg font-bold text-ink-900">{formatPriceFromCents(v.importoCents)}</p>
                    ) : (
                      // Senza una cifra certa non se ne mostra una: su un ordine pagato in parte col
                      // credito, l'intero rimborso comprende la parte già tornata come credito.
                      <p className="text-sm font-semibold text-secondary-700">
                        Cifra da controllare: leggila nell&apos;avviso «Bonifico di rimborso da fare» di questo ordine.
                      </p>
                    )}
                    <p className="text-sm text-ink-600">
                      {v.tipo === 'reclamo' ? 'Reclamo' : 'Reso'} · ordine{' '}
                      <Link href={`/orders/${v.ordineId}`} className="font-semibold text-primary-700 hover:underline">
                        #{v.ordineId.slice(0, 8)}
                      </Link>
                      {v.registratoIl ? ` · rimborso registrato il ${formatDate(v.registratoIl)}` : ''}
                    </p>
                    <p className="mt-2 font-mono text-sm text-ink-900 break-all">
                      {v.iban ?? (
                        <span className="font-sans text-secondary-700">
                          IBAN non indicato: chiedilo al cliente prima di pagare.
                        </span>
                      )}
                    </p>
                  </div>
                  {v.daFare ? (
                    <button
                      onClick={() => fatto.mutate({ tipo: v.tipo, id: v.id })}
                      disabled={fatto.isPending || !data?.migrazione162}
                      className="rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
                    >
                      Bonifico fatto
                    </button>
                  ) : (
                    <span className="text-sm font-semibold text-olive-700">
                      Fatto{v.fattoIl ? ` il ${formatDate(v.fattoIl)}` : ''}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
