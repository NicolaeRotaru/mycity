'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, CheckCircle2, CreditCard, Printer, Send, TrendingUp } from 'lucide-react';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import {
  ABBONAMENTI,
  FASCE,
  FRASE_CONDIZIONI,
  LISTINO,
  FRASE_PARTNER,
  REALIZZATI_DA,
  RESOCONTO_MENSILE,
  SCONTRINO_DI_PARTENZA,
  SERVIZI_AGENZIA,
  canonePrimoMese,
  cosaCiGuadagni,
  frasePareggio,
  pareggio,
  type Abbonamento,
} from '@/lib/agenzia/preventivo';
import { formatPriceFromCents } from '@/lib/format';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import { hrefServizio } from '@/components/seller/servizi-nel-menu';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';
import {
  accettaPreventivo,
  CHIAVE_PREVENTIVO,
  CHIAVE_SCHEDA,
  leggiSchedaDelNegozio,
  dataLeggibile,
  leggiPreventivoAgenzia,
  pagaAbbonamento,
  scriviCanone,
} from '@/components/seller/preventivo-agenzia';

/**
 * IL PREVENTIVO GIÀ PRONTO — 22/11/2026, coi tre abbonamenti dal 24/11/2026.
 *
 * Nicola: «deve già essere creato prima, in formato preventivo/demo». Il cliente
 * apre questa pagina e trova un preventivo vero, con numero e data, fatto dai
 * suoi dati: cosa manca alla vetrina e perché. Poi i tre abbonamenti — Base,
 * Business, Premium — che comprendono tutti i servizi in misura diversa (Nicola,
 * 24/11). Ne sceglie uno (parte già scelto quello che consigliamo), preme
 * «Accetto» e MyCity lo richiama. Si stampa o si salva in PDF dal pulsante.
 *
 * Niente si paga qui: accettare manda la richiesta a MyCity, che conferma e
 * concorda il pagamento.
 */
export default function PreventivoAgenziaPage() {
  const { data: p, isLoading, isError, error, refetch } = useQuery({
    queryKey: CHIAVE_PREVENTIVO,
    queryFn: leggiPreventivoAgenzia,
  });
  // 24/11/2026 — La scheda del locale (da n8n): la bozza del sito e il piano dei post la usano.
  const { data: scheda } = useQuery({ queryKey: CHIAVE_SCHEDA, queryFn: leggiSchedaDelNegozio });
  const [scelto, setScelto] = useState<Abbonamento | null>(null);
  const [inviato, setInviato] = useState<string | null>(null);
  // Lo scontrino medio per il pareggio, in euro come lo scrive il titolare: parte dalla stima per tipo.
  const [scontrino, setScontrino] = useState<string | null>(null);

  // Appena arriva il preventivo, è scelto l'abbonamento che consigliamo: il cliente può cambiarlo.
  useEffect(() => {
    if (p) setScelto((prima) => prima ?? p.consigliato);
  }, [p]);

  // Il ritorno dalla cassa Stripe: ?pagato=1 (pagato) o ?pagato=0 (annullato). Letto dall'indirizzo,
  // senza useSearchParams, che chiederebbe un confine Suspense a tutta la pagina.
  const [ritorno, setRitorno] = useState<'pagato' | 'annullato' | null>(null);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('pagato');
    if (v === '1') setRitorno('pagato');
    else if (v === '0') setRitorno('annullato');
  }, []);

  const paga = useMutation({
    mutationFn: (f: Abbonamento) => pagaAbbonamento(f),
    onSuccess: (url) => window.location.assign(url),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Non sono riuscito ad aprire il pagamento. Riprova.'),
  });

  const accetta = useMutation({
    mutationFn: (fascia: Abbonamento) => accettaPreventivo(fascia),
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
        <SellerPageTitle eyebrow="Servizi" title="Il tuo preventivo" />
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

  const fascia = scelto ?? p.consigliato;
  const partenza = SCONTRINO_DI_PARTENZA[p.tipoAttivita];
  const testoScontrino = scontrino ?? (partenza.centesimi / 100).toFixed(2).replace('.', ',');
  const scontrinoCentesimi = Math.round(Number(testoScontrino.replace(',', '.')) * 100);
  const guadagni = cosaCiGuadagni(p.righe, p.tipoAttivita);

  return (
    <div className="max-w-3xl">
      <div className="print:hidden">
        <SellerPageTitle
          eyebrow="Servizi"
          title="Il tuo preventivo è pronto"
          sub="L'abbiamo preparato guardando la tua vetrina: cosa manca, perché, e l'abbonamento che fa per te."
        />
      </div>

      {/* Lo stato dell'abbonamento: già pagato, appena pagato, o pagamento annullato (24/11). */}
      {p.attivo ? (
        <div role="status" className={`mb-4 rounded-2xl border-2 p-4 print:hidden ${p.attivo.stato === 'active' ? 'border-olive-300 bg-olive-50' : 'border-amber-300 bg-amber-50'}`}>
          {p.attivo.stato === 'active' ? (
            <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
              <CheckCircle2 size={18} className="text-olive-700" aria-hidden /> Il tuo abbonamento {FASCE[p.attivo.fascia].nome} è attivo
            </p>
          ) : (
            <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
              <AlertTriangle size={18} className="text-amber-700" aria-hidden /> Il pagamento del tuo abbonamento {FASCE[p.attivo.fascia].nome} non è riuscito
            </p>
          )}
          <p className="text-sm text-ink-700 mt-1">
            {p.attivo.stato === 'active'
              ? `Lo realizza ${REALIZZATI_DA}: ti contattiamo per fissare l’incontro nel locale. Per cambiarlo o disdirlo scrivici.`
              : 'Scrivici dall’Aiuto: sistemiamo insieme il pagamento.'}
          </p>
        </div>
      ) : ritorno === 'pagato' ? (
        <div role="status" className="mb-4 rounded-2xl border-2 border-olive-300 bg-olive-50 p-4 print:hidden">
          <p className="font-semibold text-ink-900">Pagamento ricevuto, grazie!</p>
          <p className="text-sm text-ink-700 mt-1">L’abbonamento si attiva in pochi secondi: ricarica la pagina fra un momento.</p>
        </div>
      ) : ritorno === 'annullato' ? (
        <div role="status" className="mb-4 rounded-2xl border-2 border-cream-300 bg-cream-50 p-4 print:hidden">
          <p className="font-semibold text-ink-900">Pagamento annullato</p>
          <p className="text-sm text-ink-700 mt-1">Non ti abbiamo addebitato niente. Puoi riprovare quando vuoi.</p>
        </div>
      ) : null}

      <article className="rounded-2xl border border-cream-300 bg-white p-5 sm:p-8 shadow-warm print:shadow-none print:border-0 print:p-0">
        {/* Intestazione del documento */}
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-cream-200 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary-700">{p.agenzia}</p>
            <h1 className="font-serif text-3xl font-bold text-ink-900 mt-1">Preventivo</h1>
            <p className="text-sm text-ink-600 mt-1">
              per <strong className="text-ink-900">{p.attivita}</strong> · {descriviAttivita(p.tipoAttivita)}
            </p>
            <p className="text-xs font-semibold text-primary-700 mt-1">{FRASE_PARTNER}</p>
          </div>
          <dl className="text-sm text-right">
            <dt className="text-ink-500">Numero</dt>
            <dd className="font-mono font-semibold text-ink-900">{p.numero}</dd>
            <dt className="text-ink-500 mt-2">Data</dt>
            <dd className="font-semibold text-ink-900">{dataLeggibile(p.data)}</dd>
          </dl>
        </header>

        {/* Cosa ci guadagni: prima di tutto, solo frasi vere lette dalla sua vetrina (24/11). */}
        <section aria-labelledby="cosa-ci-guadagni" className="mt-5 rounded-xl border-2 border-olive-300 bg-olive-50 p-4 sm:p-5">
          <h2 id="cosa-ci-guadagni" className="inline-flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
            <TrendingUp size={18} className="text-olive-700" aria-hidden /> Cosa ci guadagni
          </h2>
          {guadagni.oggi.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-800">
              {guadagni.oggi.map((frase) => <li key={frase}>{frase}</li>)}
            </ul>
          )}
          <p className="mt-2 text-sm font-semibold text-ink-900">{guadagni.conNoi}</p>
        </section>

        {/* Cosa manca alla vetrina: il perché del preventivo, col numero vero. */}
        {p.righe.length === 0 ? (
          <div className="py-6 text-center">
            <CheckCircle2 size={36} className="mx-auto text-olive-700" aria-hidden />
            <p className="mt-2 font-semibold text-ink-900">Alla tua vetrina non manca niente.</p>
            <p className="text-sm text-ink-600">Con un abbonamento la teniamo viva noi, ogni mese.</p>
          </div>
        ) : (
          <section className="mt-5">
            <h2 className="font-serif text-lg font-bold text-ink-900">Cosa manca alla tua vetrina</h2>
            <ul className="mt-2 divide-y divide-cream-200">
              {p.righe.map((r) => (
                <li key={r.id} className="py-4">
                  <p className="font-semibold text-ink-900">{r.titolo}</p>
                  <p className="text-sm text-ink-600">{r.descrizione}</p>
                  <ul className="mt-1 list-disc pl-4 text-xs text-ink-600">
                    {r.perche.map((frase) => <li key={frase}>{frase}</li>)}
                  </ul>
                  {/* Cosa ricevi, già pronto: la bozza del sito, il piano del mese, i formati (Nicola, 23/11). */}
                  <AnteprimaServizio id={r.id} nome={p.attivita} tipo={p.tipoAttivita} giorno={p.data} scheda={scheda} />
                  <Link href={hrefServizio(r.id)} className="mt-1 inline-block text-xs font-semibold text-primary-700 underline underline-offset-2 print:hidden">
                    Apri il servizio
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* I tre abbonamenti: tutti comprendono tutti i servizi, cambia quanto (Nicola, 24/11). */}
        <section className="mt-6">
          <h2 className="font-serif text-lg font-bold text-ink-900">Scegli il tuo abbonamento</h2>
          <p className="mt-1 text-sm text-ink-600">
            Tutti e tre comprendono tutti i servizi e la vetrina su MyCity: cambia quanto ne facciamo per te.
          </p>
          <p className="mt-2 text-sm text-ink-700">
            <strong>Ti consigliamo il {FASCE[p.consigliato].nome}.</strong> {p.perche_consigliato}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-700">
            <label htmlFor="scontrino-medio">Il tuo scontrino medio:</label>
            <span className="inline-flex items-center gap-1">
              <input
                id="scontrino-medio"
                type="text"
                inputMode="decimal"
                value={testoScontrino}
                onChange={(e) => setScontrino(e.target.value.replace(/[^0-9.,]/g, '').slice(0, 7))}
                aria-describedby="scontrino-nota"
                className="w-20 rounded-lg border border-cream-300 px-2 py-1 text-right font-semibold text-ink-900"
              />
              <span aria-hidden>€</span>
            </span>
            <span id="scontrino-nota" className="text-xs text-ink-500">
              {pareggio(p.prezzi[fascia] ?? 30_000, scontrinoCentesimi)
                ? 'È una stima: scrivi il tuo e i conti sotto ogni piano si rifanno.'
                : 'Scrivi uno scontrino in euro, per esempio 3,50, per vedere i conti.'}
            </span>
          </div>
          <fieldset className="mt-4 grid gap-3 sm:grid-cols-3" disabled={!!inviato || !!p.attivo}>
            <legend className="sr-only">Abbonamento</legend>
            {ABBONAMENTI.map((id) => {
              const f = FASCE[id];
              const attivo = fascia === id;
              const primo = p.primoMeseScontato ? canonePrimoMese(p.prezzi[id]) : null;
              const pari = pareggio(p.prezzi[id], scontrinoCentesimi);
              return (
                <label
                  key={id}
                  className={`relative flex cursor-pointer flex-col rounded-xl border-2 p-4 focus-within:ring-2 focus-within:ring-primary-500 ${attivo ? 'border-primary-700 bg-cream-50' : 'border-cream-200 print:hidden'}`}
                >
                  <input
                    type="radio"
                    name="abbonamento"
                    value={id}
                    checked={attivo}
                    onChange={() => setScelto(id)}
                    aria-labelledby={`fascia-${id}-nome fascia-${id}-prezzo`}
                    aria-describedby={`fascia-${id}-servizi`}
                    className="sr-only"
                  />
                  {id === p.consigliato && (
                    <span className="mb-1 self-start rounded-full bg-olive-700 px-2 py-0.5 text-[11px] font-bold text-white">Consigliato</span>
                  )}
                  <span id={`fascia-${id}-nome`} className="font-serif text-xl font-bold text-ink-900">{f.nome}</span>
                  <span id={`fascia-${id}-prezzo`} className="text-lg font-semibold text-ink-900">{scriviCanone(p.prezzi[id])}</span>
                  {primo !== null && <span className="text-xs font-semibold text-olive-800">Il primo mese {formatPriceFromCents(primo)}</span>}
                  {pari && (() => {
                    const frase = frasePareggio(pari, p.tipoAttivita);
                    return (
                      <span className="mt-2 rounded-lg bg-white px-2 py-1.5 text-xs text-ink-800">
                        Circa <strong>{frase.alGiorno} al giorno</strong>: l’incasso di <strong>{frase.quanti} in più</strong> al giorno.
                      </span>
                    );
                  })()}
                  <span className="mt-2 text-xs text-ink-600">{f.perChi}</span>
                  <ul id={`fascia-${id}-servizi`} className="mt-3 space-y-1.5 text-xs text-ink-700">
                    {SERVIZI_AGENZIA.map((s) => (
                      <li key={s}>
                        <span className="font-semibold text-ink-900">{LISTINO[s].titolo}:</span> {f.servizi[s]}
                      </li>
                    ))}
                    <li><span className="font-semibold text-ink-900">Vetrina:</span> {f.vetrina}</li>
                    <li><span className="font-semibold text-ink-900">Assistenza:</span> {f.assistenza}</li>
                  </ul>
                  {attivo && <Check size={18} className="absolute right-3 top-3 text-primary-700" aria-hidden />}
                </label>
              );
            })}
          </fieldset>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-800">
            <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-olive-700" aria-hidden /> {p.primoMeseScontato ? FRASE_CONDIZIONI : FRASE_CONDIZIONI.replace(' Il primo mese costa la metà.', '')}</li>
            <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-olive-700" aria-hidden /> {RESOCONTO_MENSILE}</li>
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            {Object.values(p.prezzi).some((v) => !v) && 'I canoni «su richiesta» te li confermiamo prima di iniziare. '}
            Il pagamento è con carta, sicuro con Stripe: ogni mese si rinnova da solo. Se preferisci parlarne prima, chiedi di essere richiamato: non paghi niente.
          </p>
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
            <p className="text-sm text-ink-700 mt-1">Abbonamento {FASCE[fascia].nome}. Ti ricontattiamo noi per fissare l’inizio. Non devi fare altro.</p>
          </div>
        ) : (
          !p.attivo && (
            <>
              {p.prezzi[fascia] ? (
                <Button onClick={() => paga.mutate(fascia)} loading={paga.isPending} disabled={accetta.isPending} icon={CreditCard}>
                  Paga e attiva il {FASCE[fascia].nome}
                  {p.primoMeseScontato && canonePrimoMese(p.prezzi[fascia]) ? ` · il primo mese ${formatPriceFromCents(canonePrimoMese(p.prezzi[fascia])!)}` : ''}
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => accetta.mutate(fascia)}
                disabled={accetta.isPending || paga.isPending}
                className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold disabled:opacity-60"
              >
                <Send size={18} aria-hidden /> Preferisco essere richiamato
              </button>
            </>
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
