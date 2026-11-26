import { ArrowRight, FileText, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import CosaCeNellAnalisi from '@/components/seller/CosaCeNellAnalisi';
import { PERCORSO_ABBONAMENTO } from '@/lib/agenzia/indirizzi-servizi';
import type { AnalisiCanali, RisultatoSito } from '@/lib/agenzia/analisi';
import type { SchedaCliente } from '@/lib/agenzia/scheda-cliente';
import SchedaGoogleUfficiale from '@/components/seller/SchedaGoogleUfficiale';
import { FASCE, type Abbonamento } from '@/lib/agenzia/preventivo';
import {
  ANALISI_PER_FASCIA,
  NON_ANCORA_LETTO,
  PARTI_RAPPORTO,
  TITOLI_PARTI,
  assaggio,
  leggiRapporto,
  placeIdDi,
  type Parte,
} from '@/lib/agenzia/rapporto';

/**
 * IL RAPPORTO DELL'IMPRENDITORE NELLA PAGINA «ANALISI DEL BUSINESS» — 26/11/2026.
 *
 * Nicola: prima di pagare il titolare vede un assaggio (3-4 numeri veri e cosa c'è nel rapporto per
 * abbonamento); dopo il pagamento, il rapporto intero, con le parti del suo abbonamento. Ogni dato con fonte e data. Nessun dato di
 * Google (parere legale del 26/11): la scheda Google si vede solo nel riquadro ufficiale di Google, accanto
 * (lib/agenzia/rapporto.ts). Dove una parte non è ancora letta lo dice, e non inventa niente. Se il negozio ha
 * pagato lo decide chi la usa (`haPagato`, lo dice il server).
 */

type Props = {
  scheda: SchedaCliente | null | undefined;
  canali: AnalisiCanali | null | undefined;
  sito: RisultatoSito | null | undefined;
  haPagato: boolean;
  /** La fascia pagata: il rapporto mostra le parti che comprende, e dice quali no (`ANALISI_PER_FASCIA`). */
  fascia?: Abbonamento | null;
  /** Per le prove: l'istante con cui si controllano le date di lettura. */
  adesso?: Date;
};

const TONO: Record<'positivo' | 'negativo' | 'misto', { parola: string; colore: string }> = {
  positivo: { parola: 'piace', colore: 'bg-olive-100 text-olive-800' },
  negativo: { parola: 'da migliorare', colore: 'bg-secondary-100 text-secondary-800' },
  misto: { parola: 'pareri diversi', colore: 'bg-amber-100 text-amber-800' },
};

export default function RapportoImprenditore({ scheda, canali, sito, haPagato, fascia, adesso = new Date() }: Props) {
  return haPagato ? <RapportoIntero scheda={scheda} fascia={fascia ?? null} adesso={adesso} /> : <Assaggio scheda={scheda} canali={canali} sito={sito} adesso={adesso} />;
}

function Cornice({ titolo, sotto, children }: { titolo: string; sotto: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="rapporto-imprenditore" className="mt-3 rounded-xl border border-primary-200 bg-cream-50 p-3 sm:p-4" data-testid="rapporto-imprenditore">
      <h3 id="rapporto-imprenditore" className="inline-flex items-center gap-1.5 text-lg font-bold text-ink-900">
        <FileText size={16} className="text-primary-700" aria-hidden /> {titolo}
      </h3>
      <p className="mt-0.5 text-xs text-ink-500">{sotto}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Assaggio({ scheda, canali, sito, adesso }: { scheda: Props['scheda']; canali: Props['canali']; sito: Props['sito']; adesso: Date }) {
  const numeri = assaggio({ scheda, canali, sito }, adesso);
  return (
    <Cornice titolo="Un assaggio del tuo rapporto" sotto="Quattro numeri veri sulla tua attività, ognuno con la sua fonte, e la tua scheda Google come la mostra Google. Il rapporto intero arriva dopo il pagamento, con le parti del tuo abbonamento.">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="assaggio">
        {numeri.map((n) => (
          <li key={n.id} data-numero={n.id} className="rounded-lg border border-cream-200 bg-white p-2">
            <p className="text-[11px] text-ink-500">{n.titolo}</p>
            <p className={`text-sm font-bold ${n.valore ? 'text-ink-900' : 'text-ink-400'}`}>{n.valore ?? NON_ANCORA_LETTO}</p>
            {n.fonte && <p className="mt-0.5 text-[10px] text-ink-500">{n.fonte}</p>}
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <SchedaGoogleUfficiale placeId={placeIdDi(scheda)} />
      </div>
      <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-700">
        <Lock size={13} aria-hidden /> Cosa c’è nella tua analisi, in ogni abbonamento
      </p>
      <div className="mt-2">
        <CosaCeNellAnalisi />
      </div>
      <div className="mt-3">
        <Button href={PERCORSO_ABBONAMENTO} iconRight={ArrowRight} size="sm">Scegli l&apos;abbonamento</Button>
      </div>
    </Cornice>
  );
}

function RapportoIntero({ scheda, fascia, adesso }: { scheda: Props['scheda']; fascia: Abbonamento | null; adesso: Date }) {
  const rapporto = leggiRapporto(scheda, adesso);
  // Senza la fascia (un negozio online da prima della demo) si mostra tutto quello che è arrivato.
  const compresa = (nome: (typeof PARTI_RAPPORTO)[number]) => !fascia || ANALISI_PER_FASCIA[fascia].parti[nome] !== null;
  return (
    <Cornice titolo="Il tuo rapporto" sotto={`Le parti della tua analisi${fascia ? ` col ${FASCE[fascia].nome}` : ''}. Ogni dato ha la sua fonte e la data in cui l’abbiamo letto.`}>
      {!rapporto ? (
        <p className="rounded-lg border border-dashed border-cream-300 bg-white p-3 text-sm text-ink-600">
          Il tuo rapporto lo stiamo preparando: le parti arrivano qui man mano che le leggiamo.
        </p>
      ) : (
        <ol className="space-y-2">
          <li className="rounded-lg border border-cream-200 bg-white p-3">
            <p className="text-sm font-bold text-ink-900">La tua scheda Google</p>
            <div className="mt-1"><SchedaGoogleUfficiale placeId={placeIdDi(scheda)} /></div>
          </li>
          {PARTI_RAPPORTO.map((nome, i) => {
            const parte = rapporto[nome];
            if (!compresa(nome)) {
              return (
                <li key={nome} data-parte={nome} data-esclusa className="rounded-lg border border-dashed border-cream-200 p-3">
                  <p className="text-sm font-bold text-ink-400">{i + 1}. {TITOLI_PARTI[nome]}</p>
                  <p className="mt-1 text-xs text-ink-500">Non compresa nel {FASCE[fascia!].nome}.</p>
                </li>
              );
            }
            return (
              <li key={nome} data-parte={nome} className="rounded-lg border border-cream-200 bg-white p-3">
                <p className="text-sm font-bold text-ink-900">{i + 1}. {TITOLI_PARTI[nome]}</p>
                {parte === null && <p className="mt-1 text-sm text-ink-400">Non ancora letta.</p>}
                {parte && <ContenutoParte parte={parte} />}
              </li>
            );
          })}
        </ol>
      )}
    </Cornice>
  );
}

function ContenutoParte({ parte }: { parte: Parte }) {
  return (
    <div className="mt-1">
      {parte.frasi.length > 0 && <ul className="list-disc pl-5 text-sm text-ink-700">{parte.frasi.map((f) => <li key={f}>{f}</li>)}</ul>}
      {parte.temi.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {parte.temi.map((t) => (
            <li key={t.tema} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONO[t.tono].colore}`}>
              {t.tema}: {TONO[t.tono].parola} ({t.quante.toLocaleString('it-IT')} recensioni)
            </li>
          ))}
        </ul>
      )}
      {parte.voci.length > 0 && (
        <ul className="mt-1 space-y-1">
          {parte.voci.map((v) => (
            <li key={`${v.titolo}-${v.dettaglio ?? ''}`} className="text-sm text-ink-700">
              <span className="font-semibold text-ink-900">{v.titolo}</span>
              {v.numero !== null && <> · {v.numero.toLocaleString('it-IT', { maximumFractionDigits: 1 })}</>}
              {v.dettaglio && <> — {v.dettaglio}</>}
              {v.fonte !== parte.fonte && <span className="block text-[10px] text-ink-500">{v.fonte}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-ink-500">{parte.fonte}</p>
    </div>
  );
}
