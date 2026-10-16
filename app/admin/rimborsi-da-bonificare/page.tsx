'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { formatPriceFromCents, formatDate } from '@/lib/format';
import { friendlyError } from '@/lib/errors';
import { LoadingState } from '@/components/ui/LoadingState';
import { AdminPageTitle } from '@/components/admin/AdminUI';
import { confirmDialog } from '@/components/ConfirmDialog';
import { domandaPrimaDelBonificoFatto, type VoceDaBonificare } from '@/lib/rimborsi/bonifici-da-fare';

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
 *
 * Riesame del 16/10 — tre cose:
 *  · «Bonifico fatto» chiede conferma, con la cifra e il conto davanti: un
 *    tocco sbagliato dal telefono toglieva un cliente dalla lista senza che
 *    avesse ricevuto niente, e non si torna indietro (l'IBAN si cancella).
 *  · Chi paga puo' copiare qui l'IBAN che il cliente ha mandato dai Contatti
 *    (reclami, o resi arrivati senza IBAN).
 *  · Se il cliente ha cancellato l'account prima del pagamento, la voce mostra
 *    il nome a cui intestare il bonifico: e' l'unico posto dove resta.
 */

type Risposta = { voci: VoceDaBonificare[]; migrazione162: boolean; tagliata?: boolean };

type Comando =
  | { azione: 'fatto'; voce: Pick<VoceDaBonificare, 'tipo' | 'id'> }
  | { azione: 'iban'; voce: Pick<VoceDaBonificare, 'tipo' | 'id'>; iban: string };

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

  const comando = useMutation({
    mutationFn: async (c: Comando) => {
      const chi = c.voce.tipo === 'reclamo' ? { reclamoId: c.voce.id } : { resoId: c.voce.id };
      const res = await fetch('/api/admin/rimborsi-da-bonificare', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await conToken()) },
        body: JSON.stringify(c.azione === 'iban' ? { ...chi, azione: 'iban', iban: c.iban } : { ...chi, azione: 'fatto' }),
      });
      const corpo = await res.json();
      if (!res.ok) throw new Error(corpo?.error?.message ?? 'Bonifico non aggiornato');
    },
    onSuccess: (_r, c) => {
      qc.invalidateQueries({ queryKey: CHIAVE });
      toast.success(c.azione === 'iban' ? 'IBAN salvato' : 'Bonifico segnato come fatto');
    },
    onError: (err: unknown) => toast.error(friendlyError(err)),
  });

  // Prima si chiede, poi si segna: «fatto» toglie il cliente dalla lista e cancella l'IBAN.
  const segnaFatto = async (v: VoceDaBonificare) => {
    const ok = await confirmDialog(domandaPrimaDelBonificoFatto(v));
    if (ok) comando.mutate({ azione: 'fatto', voce: { tipo: v.tipo, id: v.id } });
  };

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

      {data?.tagliata && (
        <p className="mb-4 rounded-xl border border-secondary-300 bg-secondary-50 p-4 text-sm text-secondary-800">
          Qui sotto non ci stanno tutti i bonifici da fare: la lista si ferma a mille. Fai prima quelli che vedi,
          poi ricarica la pagina.
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
                    {v.intestatario && (
                      <p className="mt-2 text-sm text-ink-800">
                        Intestatario: <strong>{v.intestatario}</strong>{' '}
                        <span className="text-ink-600">(il cliente ha chiuso l&apos;account: il nome resta qui fino al bonifico)</span>
                      </p>
                    )}
                    <p className="mt-2 font-mono text-sm text-ink-900 break-all">
                      {v.iban ?? (
                        <span className="font-sans text-secondary-700">
                          IBAN non indicato: l&apos;email di rimborso chiede al cliente di mandarlo dalla pagina Contatti.
                          Quando arriva, scrivilo qui.
                        </span>
                      )}
                    </p>
                    {v.daFare && !v.iban && data?.migrazione162 && (
                      <IbanRicevuto
                        voce={v}
                        inCorso={comando.isPending}
                        salva={(iban) => comando.mutate({ azione: 'iban', voce: { tipo: v.tipo, id: v.id }, iban })}
                      />
                    )}
                  </div>
                  {v.daFare ? (
                    <button
                      type="button"
                      onClick={() => void segnaFatto(v)}
                      disabled={comando.isPending || !data?.migrazione162}
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

/** Il campo dove chi paga copia l'IBAN che il cliente ha mandato dai Contatti. */
function IbanRicevuto({
  voce, inCorso, salva,
}: { voce: VoceDaBonificare; inCorso: boolean; salva: (iban: string) => void }) {
  const [iban, setIban] = useState('');
  const id = `iban-${voce.tipo}-${voce.id}`;
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (iban.trim()) salva(iban);
      }}
    >
      <label htmlFor={id} className="flex flex-col text-xs font-semibold text-ink-700">
        IBAN che il cliente ti ha mandato
        <input
          id={id}
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          className="mt-1 w-72 max-w-full rounded-lg border border-cream-300 px-3 py-2 font-mono text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={inCorso || !iban.trim()}
        className="rounded-lg border border-primary-300 px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-50"
      >
        Salva IBAN
      </button>
    </form>
  );
}
