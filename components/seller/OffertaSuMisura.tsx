import { Check, Sparkles } from 'lucide-react';
import { ABBONAMENTI, FASCE, LISTINO, SERVIZI_AGENZIA, type Abbonamento } from '@/lib/agenzia/preventivo';
import type { OffertaSuMisura as Offerta, Proposta } from '@/lib/agenzia/offerta-su-misura';

/**
 * L'OFFERTA SU MISURA — 24/11/2026. Le cose precise che facciamo per questo negozio, coi suoi dati
 * (lib/agenzia/offerta-su-misura.ts). Nella pagina Abbonamento (tutte, con la fascia scelta che
 * segna cosa comprende), nella pagina di ogni servizio (solo le sue) e nel link col codice.
 * Niente hook: si disegna anche sul server.
 */

const ORDINE: Record<Abbonamento, number> = { base: 0, business: 1, premium: 2 };

type Props = {
  offerta: Offerta | null | undefined;
  /** La fascia che il titolare sta guardando: le proposte che non comprende si dicono «dal Business». */
  fascia?: Abbonamento | null;
  /** Solo le proposte di questi servizi (la pagina di un servizio). Assente: tutte, divise per servizio. */
  servizi?: readonly Proposta['servizio'][];
  titolo?: string;
  /** Mostra il riepilogo per fascia e le domande del primo incontro. */
  completa?: boolean;
};

export default function OffertaSuMisura({ offerta, fascia, servizi, titolo = 'La tua offerta su misura', completa = true }: Props) {
  const scelte = (offerta?.proposte ?? []).filter((x) => !servizi || servizi.includes(x.servizio));
  if (!offerta || scelte.length === 0) return null;
  const gruppi = SERVIZI_AGENZIA.filter((s) => scelte.some((x) => x.servizio === s));

  return (
    <section aria-labelledby="offerta-su-misura" className="mt-4 rounded-xl border-2 border-primary-200 bg-primary-50/40 p-4 sm:p-5">
      <h2 id="offerta-su-misura" className="inline-flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
        <Sparkles size={18} className="text-primary-700" aria-hidden /> {titolo}
      </h2>
      <p className="mt-1 text-sm text-ink-700">
        Le cose che faremo per te, una per una, prese da quello che sappiamo già della tua attività. Tu non devi fare niente: le facciamo noi.
      </p>

      {completa && (
        <p className="mt-2 text-sm text-ink-800" data-testid="offerta-riepilogo">
          {ABBONAMENTI.map((f) => `${FASCE[f].nome}: ${offerta.perFascia[f]} su ${offerta.proposte.length}`).join(' · ')}
          {offerta.tuttoCon && <> — <span className="font-semibold">tutto è compreso dal {FASCE[offerta.tuttoCon].nome}</span></>}
        </p>
      )}

      <div className="mt-3 space-y-3">
        {gruppi.map((s) => (
          <div key={s}>
            {!servizi || servizi.length > 1 ? <h3 className="text-xs font-bold uppercase tracking-wide text-ink-700">{LISTINO[s].titolo}</h3> : null}
            <ul className="mt-1 space-y-2">
              {scelte.filter((x) => x.servizio === s).map((x) => {
                const compresa = !fascia || ORDINE[x.daFascia] <= ORDINE[fascia];
                return (
                  <li key={x.id} data-proposta={x.id} className={`rounded-lg border bg-white p-3 ${compresa ? 'border-cream-200' : 'border-dashed border-cream-300 opacity-80'}`}>
                    <p className="flex items-start gap-1.5 text-sm font-semibold text-ink-900">
                      <Check size={16} className={`mt-0.5 shrink-0 ${compresa ? 'text-olive-700' : 'text-ink-300'}`} aria-hidden />
                      <span>{x.cosa}</span>
                    </p>
                    <p className="mt-0.5 pl-[22px] text-xs text-ink-600">{x.perche}</p>
                    <p className="mt-1 pl-[22px] text-[11px] text-ink-500">
                      <span className={`mr-1 rounded-full px-1.5 py-px font-bold ${x.daFascia === 'base' ? 'bg-olive-100 text-olive-800' : 'bg-amber-100 text-amber-800'}`}>
                        {x.daFascia === 'base' ? 'In tutti gli abbonamenti' : `Dal ${FASCE[x.daFascia].nome}`}
                      </span>
                      {fascia && !compresa && <span className="mr-1 font-semibold text-amber-800">non nel {FASCE[fascia].nome} ·</span>}
                      fonte: {x.fonte}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {completa && offerta.domande.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-700">Al primo incontro ti chiediamo</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{offerta.domande.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
