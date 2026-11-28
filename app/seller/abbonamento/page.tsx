'use client';

import { useEffect, useState } from 'react';
import AnalisiAziendale from '@/components/seller/AnalisiAziendale';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Check, CheckCircle2, CreditCard, Send } from 'lucide-react';
import OffertaSuMisura from '@/components/seller/OffertaSuMisura';
import CosaCeNellAnalisi from '@/components/seller/CosaCeNellAnalisi';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import VisitaSdg from '@/components/seller/VisitaSdg';
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
  frasePareggio,
  pareggio,
  type Abbonamento,
} from '@/lib/agenzia/preventivo';
import { formatPriceFromCents } from '@/lib/format';
import { FRASE_CONTANTI, PAGAMENTO_ONLINE_SERVIZI } from '@/lib/agenzia/pagamento-servizi';
import { descriviAttivita } from '@/lib/agenzia/tipi-attivita';
import { fasciaDaIndirizzo, hrefServizio, PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import { ETICHETTE_SERVIZI } from '@/components/seller/servizi-nel-menu';
import {
  accettaPreventivo,
  CHIAVE_PREVENTIVO,
  leggiPreventivoAgenzia,
  pagaAbbonamento,
  scriviCanone,
} from '@/components/seller/preventivo-agenzia';

/**
 * LA PAGINA ABBONAMENTO — 24/11/2026.
 *
 * Nicola, dal telefono: «qua nel preventivo non posso selezionare l'abbonamento… togli la sezione
 * preventivo, perché ognuna di quelle sezioni è di per sé un preventivo… fai in modo che ci sia poi
 * un bottone che manda alla pagina dove si sceglie quell'abbonamento». Questa è quella pagina, e
 * serve SOLO a scegliere e pagare:
 *  · l'offerta su misura e l'analisi del business (il riquadro «Cosa ci guadagni» è stato tolto
 *    il 27/11/2026, Nicola dal telefono: «togli questo pezzo»);
 *  · le tre fasce selezionabili, con la consigliata, il primo mese a metà e il pareggio;
 *  · condizioni e resoconto mensile;
 *  · «Paga e attiva» e «Preferisco essere richiamato»;
 *  · lo stato dell'abbonamento, se c'è già.
 * Cosa manca e cosa ricevi stanno nelle pagine dei servizi (/seller/servizi/<slug>).
 *
 * I canoni e la fascia consigliata li calcola il server (/api/seller/preventivo); al pagamento il
 * server rilegge il canone dal listino e non si fida del browser.
 */
export default function PaginaAbbonamento() {
  const { data: p, isLoading, isError, error, refetch } = useQuery({
    queryKey: CHIAVE_PREVENTIVO,
    queryFn: leggiPreventivoAgenzia,
  });
  const [scelto, setScelto] = useState<Abbonamento | null>(null);
  const [inviato, setInviato] = useState(false);
  // Lo scontrino medio per il pareggio, in euro come lo scrive il titolare: parte dalla stima per tipo.
  const [scontrino, setScontrino] = useState<string | null>(null);

  // 25/11/2026 — La fascia arriva dall'indirizzo (?fascia=business): ogni fascia del riquadro in
  // dashboard apre il suo preventivo. Senza fascia, o con una sconosciuta, vale quella che consigliamo.
  // Letta dall'indirizzo come ?pagato, senza useSearchParams (vedi sotto).
  const [dallIndirizzo, setDallIndirizzo] = useState<Abbonamento | null | undefined>(undefined);
  useEffect(() => {
    setDallIndirizzo(fasciaDaIndirizzo(new URLSearchParams(window.location.search).get('fascia')));
  }, []);

  // Appena arrivano i dati, è scelto l'abbonamento dell'indirizzo o quello che consigliamo: il cliente può cambiarlo.
  useEffect(() => {
    if (p && dallIndirizzo !== undefined) setScelto((prima) => prima ?? dallIndirizzo ?? p.consigliato);
  }, [p, dallIndirizzo]);

  // Cambiando fascia cambia anche l'indirizzo: il preventivo che si guarda si può rimandare o ricaricare.
  const scegli = (f: Abbonamento) => {
    setScelto(f);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('fascia', f);
      url.searchParams.delete('pagato');
      window.history.replaceState(window.history.state, '', `${PERCORSO_ABBONAMENTO}${url.search}`);
    } catch { /* l'indirizzo resta com'era: la scelta vale lo stesso */ }
  };

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

  const richiama = useMutation({
    mutationFn: (fascia: Abbonamento) => accettaPreventivo(fascia),
    onSuccess: () => {
      setInviato(true);
      toast.success('Richiesta inviata: ti richiamiamo noi.');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Non sono riuscito a inviare la richiesta. Riprova.'),
  });

  if (isLoading) return <LoadingState />;

  if (isError || !p) {
    return (
      <div className="max-w-3xl">
        <SellerPageTitle eyebrow="Servizi" title="Abbonamento" />
        <div className="rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
          <p className="font-semibold text-ink-900">Non sono riuscito a preparare la pagina</p>
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

  return (
    <div className="max-w-3xl">
      {/* 25/11/2026 — È il preventivo di questa attività con questa fascia (Nicola: «il link
          all'abbonamento sia il preventivo personalizzato in base all'azienda e all'abbonamento»). */}
      <SellerPageTitle
        eyebrow={p.attivo ? 'Servizi' : `Preventivo · ${FASCE[fascia].nome}`}
        title={p.attivo ? `Il tuo abbonamento ${FASCE[p.attivo.fascia].nome}` : `Il preventivo di ${p.attivita} col ${FASCE[fascia].nome}`}
        sub={`${descriviAttivita(p.tipoAttivita)}. Cosa facciamo per te, quanto costa e come si attiva. Foto e video, sito web, gestione dei social con Google Maps e analisi del business: tutti e quattro in ogni abbonamento.`}
      />
      <p className="-mt-2 mb-4 text-sm font-semibold text-primary-700">{FRASE_PARTNER}</p>
      {/* 27/11/2026 — Il giorno della visita di SDG scelto nel link: la prima cosa che il titolare rilegge entrando. */}
      <VisitaSdg />
      {/* Le pagine dei servizi, per chi vuole rileggere cosa riceve prima di scegliere (collaudo del 24/11). */}
      <nav aria-label="I servizi compresi" className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-ink-600">Cosa ricevi:</span>
        {SERVIZI_AGENZIA.map((id) => (
          <Link key={id} href={hrefServizio(id)} className="font-semibold text-primary-700 underline underline-offset-2">{ETICHETTE_SERVIZI[id]}</Link>
        ))}
      </nav>

      {/* Lo stato dell'abbonamento: già pagato, appena pagato, o pagamento annullato (24/11). */}
      {p.attivo ? (
        <div role="status" className={`mb-4 rounded-2xl border-2 p-4 ${p.attivo.stato === 'active' ? 'border-olive-300 bg-olive-50' : 'border-amber-300 bg-amber-50'}`}>
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
      ) : PAGAMENTO_ONLINE_SERVIZI && ritorno === 'pagato' ? (
        <div role="status" className="mb-4 rounded-2xl border-2 border-olive-300 bg-olive-50 p-4">
          <p className="font-semibold text-ink-900">Pagamento ricevuto, grazie!</p>
          <p className="text-sm text-ink-700 mt-1">L’abbonamento si attiva in pochi secondi: ricarica la pagina fra un momento.</p>
        </div>
      ) : PAGAMENTO_ONLINE_SERVIZI && ritorno === 'annullato' ? (
        <div role="status" className="mb-4 rounded-2xl border-2 border-cream-300 bg-cream-50 p-4">
          <p className="font-semibold text-ink-900">Pagamento annullato</p>
          <p className="text-sm text-ink-700 mt-1">Non ti abbiamo addebitato niente. Puoi riprovare quando vuoi.</p>
        </div>
      ) : null}

      {/* 27/11/2026 — Tolto «Cosa ci guadagni» (Nicola: «togli questo pezzo»): l'offerta su misura ora
          apre il riquadro, e il suo margine sopra non serve più. */}
      <article className="rounded-2xl border border-cream-300 bg-white p-5 sm:p-8 shadow-warm [&>section:first-child]:mt-0">
        {/* L'offerta su misura (24/11): le cose precise che facciamo per lui, coi suoi dati; la fascia
            scelta segna quelle che comprende. */}
        <OffertaSuMisura offerta={p.offerta} fascia={p.attivo?.fascia ?? fascia} />
        {/* 25/11/2026 — L'analisi del business dell'attività (Nicola): parte generale e parte specifica. */}
        <AnalisiAziendale corta analisi={p.analisiAziendale} stato={p.analisiAziendaleStato} fascia={p.attivo?.fascia ?? fascia} dettaglioHref={hrefServizio('analisi')} />

        {/* I tre abbonamenti: tutti comprendono tutti i servizi, cambia quanto (Nicola, 24/11).
            28/11/2026 — Chi è già abbonato non sceglie più: la scelta sparisce, resta il suo abbonamento qui sopra. */}
        {!p.attivo && (
        <section className="mt-6" aria-labelledby="le-tre-fasce">
          <h2 id="le-tre-fasce" className="font-serif text-lg font-bold text-ink-900">Base, Business o Premium</h2>
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
          <fieldset className="mt-4 grid gap-3 sm:grid-cols-3" disabled={inviato || !!p.attivo}>
            <legend className="sr-only">Abbonamento</legend>
            {ABBONAMENTI.map((id) => {
              const f = FASCE[id];
              const attivo = fascia === id;
              const primo = p.primoMeseScontato ? canonePrimoMese(p.prezzi[id]) : null;
              const pari = pareggio(p.prezzi[id], scontrinoCentesimi);
              return (
                <label
                  key={id}
                  className={`relative flex cursor-pointer flex-col rounded-xl border-2 p-4 focus-within:ring-2 focus-within:ring-primary-500 ${attivo ? 'border-primary-700 bg-cream-50' : 'border-cream-200'}`}
                >
                  <input
                    type="radio"
                    name="abbonamento"
                    value={id}
                    checked={attivo}
                    onChange={() => scegli(id)}
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
          {/* 26/11/2026 — Cosa c'è nella tua analisi nella fascia guardata: parti incluse ed escluse (Nicola, 14:54). */}
          <section className="mt-4" aria-labelledby="analisi-della-fascia">
            <h3 id="analisi-della-fascia" className="text-lg font-bold text-ink-900">Cosa c’è nella tua analisi col {FASCE[fascia].nome}</h3>
            <div className="mt-2"><CosaCeNellAnalisi fascia={fascia} /></div>
          </section>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-800">
            <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-olive-700" aria-hidden /> {p.primoMeseScontato ? FRASE_CONDIZIONI : FRASE_CONDIZIONI.replace(' Il primo mese costa la metà.', '')}</li>
            <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-olive-700" aria-hidden /> {RESOCONTO_MENSILE}</li>
          </ul>
          <p className="mt-3 text-xs text-ink-500">
            {Object.values(p.prezzi).some((v) => !v) && 'I canoni «su richiesta» te li confermiamo prima di iniziare. '}
            {PAGAMENTO_ONLINE_SERVIZI
              ? 'Il pagamento è con carta, sicuro con Stripe: ogni mese si rinnova da solo. Se preferisci parlarne prima, chiedi di essere richiamato: non paghi niente.'
              : `${FRASE_CONTANTI} Chiedi di essere contattato e ci mettiamo d’accordo.`}
          </p>
        </section>
        )}
      </article>

      <div className="mt-5 flex flex-wrap gap-3">
        {inviato ? (
          <div role="status" className="w-full rounded-2xl border-2 border-olive-300 bg-olive-50 p-4">
            <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
              <CheckCircle2 size={18} className="text-olive-700" aria-hidden /> Ricevuto: ti richiamiamo noi
            </p>
            <p className="text-sm text-ink-700 mt-1">Abbonamento {FASCE[fascia].nome}. Ti ricontattiamo per fissare l’inizio. Non devi fare altro.</p>
          </div>
        ) : (
          !p.attivo && (
            <>
              {/* 26/11/2026 — Nicola: «tasto abbona toglilo», per ora si paga in contanti (lib/agenzia/pagamento-servizi.ts). */}
              {PAGAMENTO_ONLINE_SERVIZI && p.prezzi[fascia] ? (
                <Button onClick={() => paga.mutate(fascia)} loading={paga.isPending} disabled={richiama.isPending} icon={CreditCard}>
                  Paga e attiva il {FASCE[fascia].nome}
                  {p.primoMeseScontato && canonePrimoMese(p.prezzi[fascia]) ? ` · il primo mese ${formatPriceFromCents(canonePrimoMese(p.prezzi[fascia])!)}` : ''}
                </Button>
              ) : null}
              <button
                type="button"
                onClick={() => richiama.mutate(fascia)}
                disabled={richiama.isPending || paga.isPending}
                className="inline-flex items-center gap-2 bg-cream-100 hover:bg-cream-200 text-ink-900 px-5 py-2.5 rounded-lg font-semibold disabled:opacity-60"
              >
                <Send size={18} aria-hidden /> {PAGAMENTO_ONLINE_SERVIZI ? 'Preferisco essere richiamato' : `Voglio il ${FASCE[fascia].nome}: contattatemi`}
              </button>
            </>
          )
        )}
        <Link href="/seller/dashboard" className="inline-flex items-center px-3 py-2.5 text-sm font-semibold text-primary-700 underline underline-offset-2">
          Torna alla dashboard
        </Link>
      </div>
    </div>
  );
}
