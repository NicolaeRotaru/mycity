'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { ABBONAMENTI, FASCE, FRASE_PARTNER, LISTINO, servizioDaSlug } from '@/lib/agenzia/preventivo';
import { HREF_PREVENTIVO } from '@/components/seller/servizi-nel-menu';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';
import { CHIAVE_PREVENTIVO, leggiPreventivoAgenzia, scriviCanone } from '@/components/seller/preventivo-agenzia';

/**
 * UN SERVIZIO DEL PREVENTIVO, CON LA SUA VOCE NEL MENU — 23/11/2026.
 *
 * Nicola: «è dentro preventivo, ma ogni servizio ha la sua voce dentro il menu». Questa è la
 * pagina di un servizio solo: cosa comprende, perché te lo proponiamo (dai dati veri della
 * vetrina) e come è compreso in ognuno dei tre abbonamenti (24/11/2026: non si vende più da
 * solo, il pulsante porta al preventivo intero per scegliere la fascia). Il nome di SDG Agenzia compare dentro
 * il servizio di foto e video, che è il suo.
 *
 * I canoni e il «perché» arrivano dallo stesso preventivo calcolato dal server: la pagina
 * non decide niente. Se il servizio non manca (per esempio il sito c'è già), lo dice.
 */
export default function ServizioDelPreventivoPage() {
  const params = useParams<{ servizio: string }>();
  const id = servizioDaSlug(String(params?.servizio ?? ''));
  if (!id) notFound();

  const { data: p, isLoading, isError, refetch } = useQuery({ queryKey: CHIAVE_PREVENTIVO, queryFn: leggiPreventivoAgenzia });
  const voce = LISTINO[id];
  const riga = p?.righe.find((r) => r.id === id) ?? null;
  const giaAPosto = !!p && !riga && p.giaAPosto.includes(id);

  return (
    <div className="max-w-2xl">
      <SellerPageTitle eyebrow="Servizi" title={voce.titolo} sub={voce.descrizione} />

      {/* Il partner che realizza il servizio (Nicola, 24/11): nella pagina, non nel menu. */}
      <p className="mb-4 text-sm font-semibold text-primary-700">{FRASE_PARTNER}</p>

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
        <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm">
          <h2 className="text-sm font-bold text-ink-900">Perché te lo proponiamo</h2>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">
            {riga.perche.map((frase) => <li key={frase}>{frase}</li>)}
          </ul>
        </section>
      )}

      {p && (
        <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm">
          <h2 className="text-sm font-bold text-ink-900">È compreso in tutti e tre gli abbonamenti</h2>
          <ul className="mt-3 space-y-3">
            {ABBONAMENTI.map((f) => (
              <li key={f} className={`rounded-xl border p-3 ${f === p.consigliato ? 'border-primary-700 bg-cream-50' : 'border-cream-200'}`}>
                <p className="text-sm font-semibold text-ink-900">
                  {FASCE[f].nome} · {scriviCanone(p.prezzi[f])}
                  {f === p.consigliato && <span className="ml-2 rounded-full bg-olive-700 px-2 py-0.5 text-[11px] font-bold text-white">Consigliato</span>}
                </p>
                <p className="mt-0.5 text-sm text-ink-700">{FASCE[f].servizi[id]}</p>
              </li>
            ))}
          </ul>
          <div className="mt-5">
            <Button href={HREF_PREVENTIVO} iconRight={ArrowRight}>
              Scegli l&apos;abbonamento
            </Button>
          </div>
        </section>
      )}

      {/* Cosa ricevi, già pronto: si vede anche prima di chiederlo (Nicola, 23/11). */}
      {p && !giaAPosto && <AnteprimaServizio id={id} nome={p.attivita} tipo={p.tipoAttivita} giorno={p.data} />}

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
