'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check } from 'lucide-react';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import { ABBONAMENTI, FASCE, FRASE_PARTNER, LISTINO, servizioDaSlug } from '@/lib/agenzia/preventivo';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import AnteprimaServizio from '@/components/seller/AnteprimaServizio';
import AnalisiDelBusiness from '@/components/seller/AnalisiDelBusiness';
import OffertaSuMisura from '@/components/seller/OffertaSuMisura';
import SitoConsegnato from '@/components/seller/lavoro-consegnato/SitoConsegnato';
import PianoEditorialeConsegnato from '@/components/seller/lavoro-consegnato/PianoEditorialeConsegnato';
import AnalisiConsegnata from '@/components/seller/lavoro-consegnato/AnalisiConsegnata';
import LavoroDellOrdineDelTitolare from '@/components/seller/lavoro-consegnato/LavoroDellOrdine';
import { parteDaMostrare, parteDellOrdine } from '@/lib/agenzia/lavoro-consegnato/quale-parte';
import {
  CHIAVE_LAVORO_CONSEGNATO,
  leggiLavoroConsegnato,
  CHIAVE_BOZZA_AD,
  CHIAVE_PREVENTIVO,
  CHIAVE_SCHEDA_E_APERTA,
  leggiBozzaDellAd,
  leggiPreventivoAgenzia,
  leggiSchedaEAperta,
  scriviCanone,
} from '@/components/seller/preventivo-agenzia';

/**
 * UN SERVIZIO, CON LA SUA VOCE NEL MENU — 23/11/2026, rifatto il 24/11/2026.
 *
 * Nicola (24/11): «ognuna di quelle sezioni è di per sé un preventivo… togli anche l'opzione di
 * scegliere preventivo dentro ogni voce… fai in modo che ci sia poi un bottone che manda alla
 * pagina dove si sceglie quell'abbonamento». La pagina di un servizio dice:
 *  · perché te lo proponiamo, coi dati veri della vetrina;
 *  · cosa ricevi, già pronto (la bozza del sito, il piano dei post con la scheda Google, i formati);
 *  · com'è compreso in Base, Business e Premium, solo da leggere;
 *  · un solo pulsante, «Scegli l'abbonamento», che porta alla pagina Abbonamento.
 * L'analisi del business (24/11/2026) al posto di «cosa ricevi» mostra la sua analisi già pronta e
 * il modulo «I tuoi canali»; la pagina «Sito web» mostra la bozza scritta dall'AD, quando c'è.
 *
 * Il «perché» e i canoni arrivano dal calcolo del server (/api/seller/preventivo): la pagina non
 * decide niente. Se il servizio non manca (per esempio il sito c'è già), lo dice.
 */
export default function PaginaDelServizio() {
  const params = useParams<{ servizio: string }>();
  const id = servizioDaSlug(String(params?.servizio ?? ''));
  if (!id) notFound();

  const { data: p, isLoading, isError, refetch } = useQuery({ queryKey: CHIAVE_PREVENTIVO, queryFn: leggiPreventivoAgenzia });
  // 26/11/2026 — La scheda e «ha pagato?» dalla stessa risposta: il rapporto dell'imprenditore non mostra mai
  // l'assaggio a chi ha pagato perché una seconda chiamata è lenta o fallisce (revisione di mycity#336).
  const { data: schedaEAbbonamento, isLoading: schedaInLettura, isError: schedaNonLetta } = useQuery({ queryKey: CHIAVE_SCHEDA_E_APERTA, queryFn: leggiSchedaEAperta });
  const scheda = schedaEAbbonamento?.scheda ?? null;
  const haPagato: boolean | null = schedaEAbbonamento ? schedaEAbbonamento.aperta : null;
  // 24/11/2026 — La bozza del sito scritta dall'AD, se c'è: la pagina «Sito web» mostra quella.
  const { data: bozzaAd } = useQuery({ queryKey: CHIAVE_BOZZA_AD, queryFn: leggiBozzaDellAd, enabled: id === 'sito_web' });
  // 27/11/2026 — Chi ha già il lavoro consegnato (SDG col Premium, il Caffè di Piacenza col sito Business) vede quello, non il preventivo.
  // Se la lettura fallisce (`lavoroInErrore`) resta la pagina di sempre: mai una pagina vuota.
  const { data: letto, isLoading: lavoroInLettura } = useQuery({ queryKey: CHIAVE_LAVORO_CONSEGNATO, queryFn: leggiLavoroConsegnato, retry: false });
  const lavoro = letto?.lavoro ?? null;
  const parte = parteDaMostrare(id, lavoro);
  // 28/11/2026 — Chi ha accettato il preventivo vede il lavoro nato col suo ordine (bozza del sito, piano, analisi).
  const ordine = letto?.ordine ?? null;
  const parteOrdine = parte ? null : parteDellOrdine(id, ordine);
  const voce = LISTINO[id];
  const riga = p?.righe.find((r) => r.id === id) ?? null;
  const giaAPosto = !!p && !riga && p.giaAPosto.includes(id);

  return (
    <div className="max-w-2xl">
      <SellerPageTitle eyebrow="Servizi" title={voce.titolo} sub={voce.descrizione} />

      {/* Il partner che realizza il servizio (Nicola, 24/11): nella pagina, non nel menu. */}
      <p className="mb-4 text-sm font-semibold text-primary-700">{FRASE_PARTNER}</p>

      {lavoroInLettura ? (
        <LoadingState />
      ) : parte && lavoro ? (
        <>
          {parte === 'sito' && lavoro.sito && <SitoConsegnato sito={lavoro.sito} fascia={lavoro.fascia} />}
          {parte === 'social' && lavoro.social && <PianoEditorialeConsegnato social={lavoro.social} />}
          {parte === 'analisi' && lavoro.analisi && <AnalisiConsegnata analisi={lavoro.analisi} />}
        </>
      ) : parteOrdine && ordine ? (
        <LavoroDellOrdineDelTitolare parte={parteOrdine} ordine={ordine} />
      ) : (
        <>
      {isLoading && <LoadingState />}

      {isError && (
        <div className="rounded-2xl border-2 border-cream-300 bg-surface-0 p-5">
          <p className="font-semibold text-ink-900">Non sono riuscito a leggere la tua vetrina</p>
          <p className="mt-1 text-sm text-ink-600">Non vuol dire che manchi qualcosa: vuol dire che la lettura non è riuscita.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button href={PERCORSO_ABBONAMENTO} iconRight={ArrowRight}>Scegli l&apos;abbonamento</Button>
            <button type="button" onClick={() => refetch()} className="text-sm font-semibold text-primary-700 underline underline-offset-2">
              Riprova
            </button>
          </div>
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

      {/* Le cose precise che facciamo per lui in questo servizio, coi suoi dati (24/11). */}
      {p && <div className="mb-4"><OffertaSuMisura offerta={p.offerta} fascia={p.attivo?.fascia ?? p.consigliato} servizi={[id]} titolo={`Cosa facciamo per te, col ${FASCE[p.attivo?.fascia ?? p.consigliato].nome}`} completa={false} /></div>}

      {giaAPosto && (
        <section className="mb-4 rounded-2xl border border-cream-300 bg-cream-50 p-5">
          <p className="font-semibold text-ink-900 inline-flex items-center gap-2">
            <Check size={18} className="text-olive-700" aria-hidden /> Questo ce l&apos;hai già
          </p>
          <p className="mt-1 text-sm text-ink-700">
            Dalla tua vetrina risulta a posto. Se vuoi rifarlo o migliorarlo,{' '}
            <Link href="/seller/help" className="font-semibold text-primary-700 underline underline-offset-2">scrivici dall&apos;Aiuto</Link>.
          </p>
        </section>
      )}

      {/* Cosa ricevi, già pronto: si vede anche prima di sceglierlo (Nicola, 23/11). L'analisi del
          business (24/11) è la sua analisi vera, coi canali da scrivere. */}
      {p && id === 'analisi' && <AnalisiDelBusiness scheda={scheda} fascia={p.attivo?.fascia ?? null} haPagato={haPagato} letturaFallita={!schedaInLettura && schedaNonLetta} />}
      {p && !giaAPosto && id !== 'analisi' && (
        <AnteprimaServizio id={id} nome={p.attivita} tipo={p.tipoAttivita} giorno={p.data} scheda={scheda} bozzaAd={bozzaAd} />
      )}

      {/* 28/11/2026 — Nicola, su «PROVA - Raquel Cafè»: «perché c'è la scelta dell'abbonamento se il cliente è già
          iscritto?». Chi ha già un abbonamento (attivo o col pagamento in ritardo) non vede più le tre fasce né il pulsante. */}
      {p && !p.attivo && (
        <section className="mt-4 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm" aria-labelledby="compreso-nei-piani">
          <h2 id="compreso-nei-piani" className="text-sm font-bold text-ink-900">È compreso in tutti e tre gli abbonamenti</h2>
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
            <Button href={PERCORSO_ABBONAMENTO} iconRight={ArrowRight}>
              Scegli l&apos;abbonamento
            </Button>
          </div>
        </section>
      )}
        </>
      )}
    </div>
  );
}
