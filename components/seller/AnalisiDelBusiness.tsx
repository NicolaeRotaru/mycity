'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardCheck, Clock, Gauge, Lightbulb, Store, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import CanaliDelNegozio from '@/components/seller/CanaliDelNegozio';
import type { SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import {
  CANALI_ANALIZZATI,
  NOMI_CANALI_ANALIZZATI,
  STATO_CANALE_IN_PAROLE,
  analisiDellAttivita,
  dataItaliana,
  numeriInParole,
  sitoDaRifare,
  sitoInParole,
  type Voto,
} from '@/lib/agenzia/analisi';
import { haCanali } from '@/lib/agenzia/canali';
import { CHIAVE_ANALISI, CHIAVE_CANALI, CHIAVE_PAGELLA, analizzaIlSito, leggiAnalisiDelNegozio, leggiCanali, leggiPagella } from '@/components/seller/preventivo-agenzia';
import type { Pagella } from '@/lib/agenzia/pagella';

/**
 * L'ANALISI DEL BUSINESS, GIÀ PRONTA DENTRO LA PAGINA DEL SERVIZIO — 24/11/2026.
 *
 * Nicola: «quando dico preventivo intendo un'anteprima/demo già creata di tutte quelle cose». Qui il
 * titolare vede la sua analisi: l'attività (n8n, flusso 16, dalla scheda), i canali (social e scheda
 * Google, da n8n), il sito (Google PageSpeed). Dove un'analisi non c'è ancora la pagina lo dice e non
 * inventa niente. Sotto, «I tuoi canali», dove li scrive.
 */

const COLORE_VOTO: Record<Voto, string> = {
  bene: 'bg-olive-100 text-olive-800',
  migliorabile: 'bg-amber-100 text-amber-800',
  male: 'bg-secondary-100 text-secondary-800',
};
/** Il nome del sito di un link, o `null` se il link non si legge: un dato storto non fa cadere la pagina. */
function dominio(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const PAROLA_VOTO: Record<Voto, string> = { bene: 'Bene', migliorabile: 'Da migliorare', male: 'Da sistemare' };

function Blocco({ icona: Icona, titolo, children }: { icona: typeof Store; titolo: string; children: React.ReactNode }) {
  return (
    <section aria-label={titolo} className="mt-3 rounded-xl border border-cream-200 bg-cream-50 p-3 sm:p-4">
      <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-900">
        <Icona size={16} className="text-primary-700" aria-hidden /> {titolo}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function NonAncora({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-cream-300 bg-white p-3 text-sm text-ink-600">{children}</p>;
}

function Elenco({ titolo, voci }: { titolo: string; voci: string[] }) {
  if (!voci.length) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-700">{titolo}</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{voci.map((v) => <li key={v}>{v}</li>)}</ul>
    </div>
  );
}

export default function AnalisiDelBusiness({ scheda }: { scheda?: SchedaCliente | null }) {
  const qc = useQueryClient();
  const { data: analisi } = useQuery({ queryKey: CHIAVE_ANALISI, queryFn: leggiAnalisiDelNegozio });
  const { data: canali } = useQuery({ queryKey: CHIAVE_CANALI, queryFn: leggiCanali });
  const { data: pagella, isError: pagellaNonLetta } = useQuery({ queryKey: CHIAVE_PAGELLA, queryFn: leggiPagella });
  const attivita = analisiDellAttivita(scheda);
  const sito = analisi?.sito ?? null;
  const haSito = Boolean((canali?.website ?? '').trim());
  const sitoGiaFattoOggi = Boolean(sito && !sitoDaRifare(sito.fatta_il, new Date()));

  const analizza = useMutation({
    mutationFn: analizzaIlSito,
    onSuccess: (r) => {
      qc.setQueryData(CHIAVE_ANALISI, { ...(analisi ?? { canali: null, canaliRichiestiIl: null }), sito: r.sito });
      toast.success(r.giaFattaOggi ? 'Il sito l’abbiamo già analizzato oggi: ecco il risultato.' : 'Fatto: ecco come va il tuo sito.');
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'L’analisi del sito non è riuscita.'),
  });

  const canaliAnalizzati = CANALI_ANALIZZATI.filter((c) => analisi?.canali?.canali[c]);

  return (
    <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm" aria-labelledby="la-tua-analisi">
      <h2 id="la-tua-analisi" className="text-sm font-bold text-ink-900">La tua analisi</h2>
      <p className="mt-0.5 text-xs text-ink-500">
        Già pronta con quello che sappiamo oggi. Usiamo solo fonti pubbliche e gratuite; dove un’analisi non c’è ancora, te lo diciamo.
      </p>

      <Blocco icona={ClipboardCheck} titolo="La tua pagella su MyCity">
        {pagella ? <PagellaDelNegozio p={pagella} /> : (
          <NonAncora>{pagellaNonLetta ? 'Non sono riuscito a preparare la pagella: riprova fra poco.' : 'Sto preparando la pagella…'}</NonAncora>
        )}
      </Blocco>

      <Blocco icona={Store} titolo="La tua attività">
        {attivita ? (
          <>
            {attivita.tipoDiLocale && <p className="text-sm text-ink-700"><span className="font-semibold text-ink-900">Che locale sei:</span> {attivita.tipoDiLocale}</p>}
            {attivita.pubblico && (
              <p className="mt-1 inline-flex gap-1.5 text-sm text-ink-700">
                <Users size={16} className="mt-0.5 shrink-0 text-primary-700" aria-hidden />
                <span><span className="font-semibold text-ink-900">Chi sono i tuoi clienti:</span> {attivita.pubblico}</span>
              </p>
            )}
            <Elenco titolo="I tuoi punti di forza" voci={attivita.puntiDiForza} />
            <Elenco titolo="Idee per farti conoscere" voci={attivita.idee} />
            <Elenco titolo="Da chiarire insieme" voci={attivita.daChiarire} />
            <p className="mt-2 text-xs text-ink-500">Letto da noi nelle fonti pubbliche del tuo locale: è una prima lettura, la rivediamo con te.</p>
          </>
        ) : (
          <NonAncora>L’analisi della tua attività la prepariamo appena abbiamo letto le fonti pubbliche del tuo locale. La trovi qui.</NonAncora>
        )}
      </Blocco>

      <Blocco icona={Lightbulb} titolo="I tuoi social e la scheda Google">
        {analisi?.canaliRichiestiIl && (
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
            <Clock size={14} aria-hidden /> Stiamo analizzando i canali che hai salvato: il risultato arriva qui.
          </p>
        )}
        {canaliAnalizzati.length > 0 ? (
          <ul className="space-y-2">
            {canaliAnalizzati.map((c) => {
              const a = analisi!.canali!.canali[c]!;
              const numeri = numeriInParole(a.numeri);
              return (
                <li key={c} className="rounded-lg border border-cream-200 bg-white p-3">
                  <p className="text-sm font-semibold text-ink-900">{NOMI_CANALI_ANALIZZATI[c]}</p>
                  {a.stato !== 'fatta' ? (
                    <p className="text-sm text-ink-600">{STATO_CANALE_IN_PAROLE[a.stato]}</p>
                  ) : (
                    <>
                      {numeri.length > 0 && <p className="text-sm text-ink-700">{numeri.join(' · ')}</p>}
                      <Elenco titolo="Cosa abbiamo visto" voci={a.osservazioni ?? []} />
                      <Elenco titolo="Cosa ti consigliamo" voci={a.consigli ?? []} />
                    </>
                  )}
                  {(a.fonte || a.letto_il) && (
                    <p className="mt-1 text-[11px] text-ink-500">
                      {a.letto_il ? `Letto il ${dataItaliana(a.letto_il)}` : `Analisi del ${dataItaliana(analisi!.canali!.fatta_il)}`}
                      {a.fonte && dominio(a.fonte) && <> · fonte: <a href={a.fonte} target="_blank" rel="noopener noreferrer nofollow" className="underline">{dominio(a.fonte)}</a></>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          !analisi?.canaliRichiestiIl && (
            <NonAncora>
              {canali && haCanali(canali)
                ? 'Hai scritto i tuoi canali: l’analisi la prepariamo noi e la trovi qui.'
                : 'La prepariamo appena colleghi i tuoi canali: scrivili qui sotto, in «I tuoi canali».'}
            </NonAncora>
          )
        )}
      </Blocco>

      <Blocco icona={Gauge} titolo="Il tuo sito">
        {sito ? (
          <>
            <ul className="grid gap-2 sm:grid-cols-3">
              {sitoInParole(sito).map((v) => (
                <li key={v.titolo} className="rounded-lg border border-cream-200 bg-white p-3">
                  <p className="text-xs font-bold text-ink-900">{v.titolo}</p>
                  <p className="mt-1 flex items-center gap-2">
                    <span className="text-xl font-extrabold text-ink-900">{v.punteggio}</span>
                    <span className="text-xs text-ink-500">su 100</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${COLORE_VOTO[v.voto]}`}>{PAROLA_VOTO[v.voto]}</span>
                  </p>
                  <p className="mt-1 text-xs text-ink-600">{v.frase}</p>
                </li>
              ))}
            </ul>
            <Elenco titolo="Cosa sistemare" voci={sito.daSistemare} />
            <p className="mt-2 text-[11px] text-ink-500">
              {dominio(sito.url) ?? 'Il tuo sito'}, letto da Google PageSpeed Insights il {dataItaliana(sito.fatta_il)}, come lo vede chi usa il telefono.
            </p>
          </>
        ) : (
          <NonAncora>
            {haSito
              ? 'Il tuo sito non l’abbiamo ancora analizzato: premi il pulsante e Google lo legge in meno di un minuto.'
              : 'Se hai un sito, scrivi l’indirizzo in «I tuoi canali» e lo analizziamo. Se non ce l’hai, guarda il servizio «Sito web».'}
          </NonAncora>
        )}
        {haSito && (
          <div className="mt-3">
            <Button onClick={() => analizza.mutate()} disabled={analizza.isPending || sitoGiaFattoOggi} variant={sito ? 'secondary' : 'primary'} size="sm">
              {analizza.isPending ? 'Google sta leggendo il sito…' : sito ? 'Analizza di nuovo' : 'Analizza il mio sito'}
            </Button>
            {sitoGiaFattoOggi && <p className="mt-1 text-xs text-ink-500">Il sito si analizza una volta al giorno: domani puoi rifarlo.</p>}
          </div>
        )}
      </Blocco>

      <div className="mt-4">
        <CanaliDelNegozio />
      </div>
    </section>
  );
}

/**
 * LA PAGELLA (24/11/2026): a che punto è il negozio per arrivare al primo incasso, coi conti del flusso 18
 * (lib/agenzia/pagella.ts). Un numero che non si è potuto leggere si dice «non misurato», mai zero.
 */
const euro = (v: number) => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
const conta = (v: number | null) => (v === null ? 'non misurato' : v.toLocaleString('it-IT'));

function PagellaDelNegozio({ p }: { p: Pagella }) {
  const n = p.numeri;
  const caselle: Array<[string, string]> = [
    ['Prodotti in vendita', conta(n.prodottiInVendita)],
    ['Ordini negli ultimi 30 giorni', conta(n.ordini30g)],
    ['Incassato negli ultimi 30 giorni', n.incasso30g === null ? 'non misurato' : euro(n.incasso30g)],
    ['Scontrino medio', n.scontrinoMedio30g === null ? (n.ordini30g === null ? 'non misurato' : '—') : euro(n.scontrinoMedio30g)],
    ['Clienti', n.clienti === null ? 'non misurato' : `${conta(n.clienti)}${n.clientiTornati ? `, ${conta(n.clientiTornati)} tornati` : ''}`],
    ['Recensioni', n.recensioni === null ? 'non misurato' : n.recensioni === 0 ? 'nessuna' : `${conta(n.recensioni)}, media ${n.votoMedio?.toLocaleString('it-IT')} su 5`],
  ];
  return (
    <div data-testid="pagella">
      <p className="text-sm text-ink-700">
        {p.stato && <><span className="font-semibold text-ink-900">Il tuo negozio:</span> {p.stato}. </>}
        {p.puoIncassareConCarta !== null && (p.puoIncassareConCarta ? 'Puoi incassare con la carta.' : 'Non puoi ancora incassare con la carta.')}
      </p>
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {caselle.map(([titolo, valore]) => (
          <li key={titolo} className="rounded-lg border border-cream-200 bg-white p-2">
            <p className="text-[11px] text-ink-500">{titolo}</p>
            <p className={`text-sm font-bold ${valore === 'non misurato' ? 'text-ink-400' : 'text-ink-900'}`}>{valore}</p>
          </li>
        ))}
      </ul>
      {p.avvisi.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {p.avvisi.map((a) => (
            <li key={a.id} data-avviso={a.id} className={`rounded-lg border p-2 ${a.colore === 'rosso' ? 'border-secondary-200 bg-secondary-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className="inline-flex items-start gap-1.5 text-sm font-semibold text-ink-900">
                <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${a.colore === 'rosso' ? 'text-secondary-700' : 'text-amber-700'}`} aria-hidden /> {a.titolo}
              </p>
              <p className="pl-[21px] text-xs text-ink-700">{a.cosaFare}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-olive-800">Niente da sistemare: il tuo negozio è in ordine.</p>
      )}
      {p.nonMisurato.length > 0 && <p className="mt-2 text-[11px] text-ink-500">Non misurato: {p.nonMisurato.join('; ')}.</p>}
      <p className="mt-1 text-[11px] text-ink-500">Calcolata adesso dai dati del tuo negozio su MyCity.</p>
    </div>
  );
}
