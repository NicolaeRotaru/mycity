'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, CheckCircle2, Printer, Send } from 'lucide-react';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { LISTINO, sommaRighe, type ServizioAgenzia } from '@/lib/agenzia/preventivo';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import { FRASE_PREZZO_NEGOZI } from '@/app/seller/earnings/commissione';
import { hrefServizio } from '@/components/seller/servizi-nel-menu';
import {
  accettaPreventivo,
  CHIAVE_PREVENTIVO,
  dataLeggibile,
  leggiPreventivoAgenzia,
  scriviPrezzo,
  scriviTotale,
} from '@/components/seller/preventivo-agenzia';

/**
 * IL PREVENTIVO GIÀ PRONTO — 22/11/2026.
 *
 * Nicola: «deve già essere creato prima, in formato preventivo/demo». Il cliente
 * apre questa pagina e trova un preventivo vero, con numero e data, fatto dai
 * suoi dati: cosa manca alla vetrina, perché, quanto. Toglie le voci che non
 * gli interessano, preme «Accetto» e MyCity lo richiama. Si stampa o si
 * salva in PDF dal pulsante (il menu e i pulsanti non escono sulla carta).
 *
 * Niente si paga qui: accettare manda la richiesta a MyCity, che conferma
 * prezzi e tempi e concorda il pagamento. I prezzi sono quelli di Nicola
 * (22/11/2026); dove non c'è un prezzo, la voce dice «su richiesta».
 */
export default function PreventivoAgenziaPage() {
  const { data: p, isLoading, isError, error, refetch } = useQuery({
    queryKey: CHIAVE_PREVENTIVO,
    queryFn: leggiPreventivoAgenzia,
  });
  const [scelte, setScelte] = useState<Set<ServizioAgenzia>>(new Set());
  const [inviato, setInviato] = useState<string | null>(null);

  // Appena arriva il preventivo, tutte le voci sono scelte: il cliente toglie, non aggiunge.
  useEffect(() => {
    if (p) setScelte(new Set(p.righe.map((r) => r.id)));
  }, [p]);

  const righeScelte = useMemo(() => (p ? p.righe.filter((r) => scelte.has(r.id)) : []), [p, scelte]);
  const totaleUnaTantum = sommaRighe(righeScelte.filter((r) => r.cadenza === 'una_tantum'));
  const totaleMensile = sommaRighe(righeScelte.filter((r) => r.cadenza === 'mese'));

  const accetta = useMutation({
    mutationFn: () => accettaPreventivo(righeScelte.map((r) => r.id)),
    onSuccess: (numero) => {
      setInviato(numero);
      toast.success('Preventivo inviato: ti ricontattiamo noi.');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Non sono riuscito a inviare il preventivo. Riprova.'),
  });

  if (isLoading) return <LoadingState />;

  if (isError || !p) {
    return (
      <div className="max-w-3xl">
        <SellerPageTitle eyebrow="La tua vetrina" title="Il tuo preventivo" />
        <div className="rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
          <p className="font-semibold text-ink-900">Non sono riuscito a preparare il preventivo</p>
          <p className="mt-1 text-sm text-ink-600">
            {error instanceof Error ? error.message : 'La lettura non è riuscita.'} Non vuol dire che manchi qualcosa.
          </p>
          <button type="button" onClick={() => refetch()} className="mt-3 rounded-lg bg-primary-700 px-4 py-2 text-sm font-bold text-white hover:bg-primary-800">
            Riprova
          </button>
        </div>
      </div>
    );
  }

  const cambia = (id: ServizioAgenzia) =>
    setScelte((prima) => {
      const dopo = new Set(prima);
      if (dopo.has(id)) dopo.delete(id);
      else dopo.add(id);
      return dopo;
    });

  return (
    <div className="max-w-3xl">
      <div className="print:hidden">
        <SellerPageTitle
          eyebrow="La tua vetrina"
          title="Il tuo preventivo è pronto"
          sub="L'abbiamo preparato guardando la tua vetrina: cosa manca, perché, e cosa possiamo fare noi."
        />
      </div>

      <article className="rounded-2xl border border-cream-300 bg-white p-5 sm:p-8 shadow-warm print:shadow-none print:border-0 print:p-0">
        {/* Intestazione del documento */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-cream-200 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary-700">{p.agenzia}</p>
            <h1 className="font-serif text-3xl font-bold text-ink-900 mt-1">Preventivo</h1>
            <p className="text-sm text-ink-600 mt-1">
              per <strong className="text-ink-900">{p.attivita}</strong> · {descriviAttivita(p.tipoAttivita)}
            </p>
          </div>
          <dl className="text-sm text-right">
            <dt className="text-ink-500">Numero</dt>
            <dd className="font-mono font-semibold text-ink-900">{p.numero}</dd>
            <dt className="text-ink-500 mt-2">Data</dt>
            <dd className="font-semibold text-ink-900">{dataLeggibile(p.data)}</dd>
          </dl>
        </header>

        {p.righe.length === 0 ? (
          <div className="py-8 text-center">
            <CheckCircle2 size={40} className="mx-auto text-olive-700" aria-hidden />
            <p className="mt-3 font-semibold text-ink-900">Alla tua vetrina non manca niente.</p>
            <p className="text-sm text-ink-600">Se vuoi qualcosa in più, scrivici.</p>
          </div>
        ) : (
          <>
            <p className="mt-5 text-sm text-ink-600 print:hidden">
              Togli la spunta alle voci che non ti interessano: il totale si aggiorna.
            </p>
            <ul className="mt-3 divide-y divide-cream-200">
              {p.righe.map((r) => {
                const scelta = scelte.has(r.id);
                return (
                  <li key={r.id} className={`py-4 flex items-start gap-3 ${scelta ? '' : 'opacity-50 print:hidden'}`}>
                    <input
                      id={`voce-${r.id}`}
                      type="checkbox"
                      checked={scelta}
                      onChange={() => cambia(r.id)}
                      disabled={!!inviato}
                      className="mt-1.5 h-4 w-4 accent-primary-700 print:hidden"
                    />
                    <div className="flex-1 min-w-0">
                      <label htmlFor={`voce-${r.id}`} className="block cursor-pointer">
                        <span className="block font-semibold text-ink-900">{r.titolo}</span>
                        {r.partner && <span className="block text-xs font-semibold text-primary-700">con {r.partner}, il partner di MyCity per foto e video</span>}
                        <span className="block text-sm text-ink-600">{r.descrizione}</span>
                      </label>
                      {/* L'elenco sta fuori dall'etichetta: dentro un <label> va solo testo. */}
                      <p className="text-xs text-ink-500 mt-1">Perché te lo proponiamo:</p>
                      <ul className="list-disc pl-4 text-xs text-ink-600">
                        {r.perche.map((frase) => <li key={frase}>{frase}</li>)}
                      </ul>
                      {/* Ogni servizio ha anche la sua pagina, con la sua voce nel menu. */}
                      <Link href={hrefServizio(r.id)} className="mt-1 inline-block text-xs font-semibold text-primary-700 underline underline-offset-2 print:hidden">
                        Apri il servizio
                      </Link>
                    </div>
                    <div className="text-right shrink-0 max-w-[40%]">
                      <p className="text-xs text-ink-500">{r.cadenza === 'mese' ? 'ogni mese' : 'una volta'}</p>
                      <p className="font-semibold text-ink-900">{scriviPrezzo(r.prezzo, r.cadenza)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-2 border-t-2 border-ink-900 pt-4 space-y-1 text-right">
              {totaleUnaTantum && (
                <p className="text-ink-900"><span className="text-ink-600">Una volta sola:</span> <strong>{scriviTotale(totaleUnaTantum, 'una_tantum')}</strong></p>
              )}
              {totaleMensile && (
                <p className="text-ink-900"><span className="text-ink-600">Ogni mese:</span> <strong>{scriviTotale(totaleMensile, 'mese')}</strong></p>
              )}
              {!totaleUnaTantum && !totaleMensile && <p className="text-ink-600">Nessuna voce scelta.</p>}
            </div>

            <p className="mt-4 text-xs text-ink-500">
              {righeScelte.some((r) => r.id === 'foto_video') && 'Per foto e video il prezzo dipende da quanto serve: lo fissiamo insieme prima di iniziare. '}
              {righeScelte.some((r) => !r.prezzo) && 'Le voci «su richiesta» te le confermiamo prima di iniziare. '}
              Accettare non ti fa pagare niente adesso.
            </p>
          </>
        )}

        {/* La vetrina sul marketplace: la frase unica dei prezzi dei negozi, che segue
            l'interruttore dell'abbonamento (oggi: nessun canone finché non incassi). */}
        <section className="mt-6 rounded-xl border border-cream-200 p-4">
          <h2 className="text-sm font-bold text-ink-900">La tua vetrina su MyCity</h2>
          <p className="mt-1 text-sm text-ink-700">{FRASE_PREZZO_NEGOZI}</p>
        </section>

        {p.giaAPosto.length > 0 && (
          <section className="mt-6 rounded-xl bg-cream-50 p-4">
            <h2 className="text-sm font-bold text-ink-900">Già a posto</h2>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-700">
              {p.giaAPosto.map((id) => (
                <li key={id} className="inline-flex items-center gap-1.5">
                  <Check size={14} className="text-olive-700" aria-hidden /> {LISTINO[id].titolo}
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      <div className="mt-5 flex flex-wrap gap-3 print:hidden">
        {inviato ? (
          <div role="status" className="w-full rounded-2xl border-2 border-olive-300 bg-olive-50 p-4">
            <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
              <CheckCircle2 size={18} className="text-olive-700" aria-hidden /> Ricevuto: preventivo {inviato}
            </p>
            <p className="text-sm text-ink-700 mt-1">Ti ricontattiamo noi per fissare il servizio. Non devi fare altro.</p>
          </div>
        ) : (
          p.righe.length > 0 && (
            <Button
              onClick={() => accetta.mutate()}
              disabled={righeScelte.length === 0}
              loading={accetta.isPending}
              icon={Send}
            >
              Accetto: contattatemi
            </Button>
          )
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold"
        >
          <Printer size={18} aria-hidden /> Stampa o salva in PDF
        </button>
        <Link href="/seller/dashboard" className="inline-flex items-center px-3 py-2.5 text-sm font-semibold text-primary-700 underline underline-offset-2">
          Torna alla dashboard
        </Link>
      </div>
    </div>
  );
}
