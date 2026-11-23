'use client';

import { useState } from 'react';
import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, Send } from 'lucide-react';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { LISTINO, servizioDaSlug } from '@/lib/agenzia/preventivo';
import { HREF_PREVENTIVO } from '@/components/seller/servizi-nel-menu';
import { accettaPreventivo, CHIAVE_PREVENTIVO, leggiPreventivoAgenzia, scriviPrezzo } from '@/components/seller/preventivo-agenzia';

/**
 * UN SERVIZIO DEL PREVENTIVO, CON LA SUA VOCE NEL MENU — 23/11/2026.
 *
 * Nicola: «è dentro preventivo, ma ogni servizio ha la sua voce dentro il menu». Questa è la
 * pagina di un servizio solo: cosa comprende, perché te lo proponiamo (dai dati veri della
 * vetrina), quanto costa, e il pulsante per chiederlo. Il nome di scattiDG compare solo dentro
 * il servizio di foto e video, che è il suo.
 *
 * Il prezzo e il «perché» arrivano dallo stesso preventivo calcolato dal server: la pagina
 * non decide niente. Se il servizio non manca (per esempio il logo c'è già), lo dice.
 */
export default function ServizioDelPreventivoPage() {
  const params = useParams<{ servizio: string }>();
  const id = servizioDaSlug(String(params?.servizio ?? ''));
  if (!id) notFound();

  const { data: p, isLoading, isError, refetch } = useQuery({ queryKey: CHIAVE_PREVENTIVO, queryFn: leggiPreventivoAgenzia });
  const [inviato, setInviato] = useState<string | null>(null);

  const chiedi = useMutation({
    mutationFn: () => accettaPreventivo([id]),
    onSuccess: (numero) => {
      setInviato(numero);
      toast.success('Richiesta inviata: ti ricontattiamo noi.');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Non sono riuscito a inviare la richiesta. Riprova.'),
  });

  const voce = LISTINO[id];
  const riga = p?.righe.find((r) => r.id === id) ?? null;
  const giaAPosto = !!p && !riga && p.giaAPosto.includes(id);

  return (
    <div className="max-w-2xl">
      <SellerPageTitle eyebrow="Preventivo" title={voce.titolo} sub={voce.descrizione} />

      {voce.partner && (
        <p className="mb-4 text-sm font-semibold text-primary-700">
          Lo fa {voce.partner}, l&apos;azienda partner a cui MyCity si affida per foto e video.
        </p>
      )}

      {isLoading && <LoadingState />}

      {isError && (
        <div className="rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
          <p className="font-semibold text-ink-900">Non sono riuscito a leggere la tua vetrina</p>
          <p className="mt-1 text-sm text-ink-600">Non vuol dire che manchi qualcosa: vuol dire che la lettura non è riuscita.</p>
          <button type="button" onClick={() => refetch()} className="mt-3 rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white hover:bg-primary-800">
            Riprova
          </button>
        </div>
      )}

      {riga && (
        <section className="rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm">
          <p className="text-xs text-ink-500">{riga.cadenza === 'mese' ? 'Ogni mese' : 'Una volta sola'}</p>
          <p className="font-serif text-2xl font-bold text-ink-900">{scriviPrezzo(riga.prezzo, riga.cadenza)}</p>
          <h2 className="mt-4 text-sm font-bold text-ink-900">Perché te lo proponiamo</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
            {riga.perche.map((frase) => <li key={frase}>{frase}</li>)}
          </ul>
          <p className="mt-4 text-xs text-ink-500">
            {riga.id === 'foto_video' && 'Il prezzo dipende da quanto serve: lo fissiamo insieme prima di iniziare. '}
            {!riga.prezzo && 'Il prezzo te lo confermiamo prima di iniziare. '}
            Chiederlo non ti fa pagare niente adesso.
          </p>
          <div className="mt-5">
            {inviato ? (
              <div role="status" className="rounded-2xl border-2 border-olive-300 bg-olive-50 p-4">
                <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-olive-700" aria-hidden /> Ricevuto: richiesta {inviato}
                </p>
                <p className="text-sm text-ink-700 mt-1">Ti ricontattiamo noi per fissare il servizio. Non devi fare altro.</p>
              </div>
            ) : (
              <Button onClick={() => chiedi.mutate()} loading={chiedi.isPending} icon={Send}>
                Lo voglio: contattatemi
              </Button>
            )}
          </div>
        </section>
      )}

      {giaAPosto && (
        <section className="rounded-2xl border border-cream-300 bg-cream-50 p-5">
          <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
            <Check size={18} className="text-olive-700" aria-hidden /> Questo ce l&apos;hai già
          </p>
          <p className="mt-1 text-sm text-ink-700">
            Dalla tua vetrina risulta a posto. Se vuoi rifarlo o migliorarlo, scrivici dall&apos;Aiuto.
          </p>
          <Link href="/seller/help" className="mt-3 inline-block text-sm font-semibold text-primary-700 underline underline-offset-2">
            Vai all&apos;Aiuto
          </Link>
        </section>
      )}

      <Link href={HREF_PREVENTIVO} className="mt-6 inline-block text-sm font-semibold text-primary-700 underline underline-offset-2">
        Torna al preventivo intero
      </Link>
    </div>
  );
}
