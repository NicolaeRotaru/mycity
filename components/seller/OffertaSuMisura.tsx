import { ArrowUpRight, Check, Sparkles } from 'lucide-react';
import { ABBONAMENTI, FASCE, LISTINO, SERVIZI_AGENZIA, type Abbonamento } from '@/lib/agenzia/preventivo';
import { cosaInFascia, inPiuSalendo, type OffertaSuMisura as Offerta, type Proposta } from '@/lib/agenzia/offerta-su-misura';

/**
 * L'OFFERTA SU MISURA, PER ABBONAMENTO — 24/11/2026.
 *
 * Nicola: «sulla base dei dati che hai recuperato sul cliente devi trovare esattamente tutte le cose che
 * possiamo offrirgli» e, la sera, «il servizio deve essere anche in base all'abbonamento che hanno
 * scelto». Quindi: le cose precise che facciamo per QUESTO negozio con la fascia che guarda (quella
 * scelta, o quella attiva, o quella consigliata), e sotto, in breve, cosa aggiunge la fascia sopra.
 * I dati sono gli stessi; cambia quanto facciamo, solo come dice `FASCE` (lib/agenzia/offerta-su-misura.ts).
 * Niente hook: si disegna anche sul server (il link col codice).
 */

type Props = {
  offerta: Offerta | null | undefined;
  /** La fascia di cui si mostra l'offerta. */
  fascia: Abbonamento;
  /** Solo le proposte di questi servizi (la pagina di un servizio). Assente: tutte, divise per servizio. */
  servizi?: readonly Proposta['servizio'][];
  titolo?: string;
  /** Mostra il riepilogo per fascia e le domande del primo incontro. */
  completa?: boolean;
};

export default function OffertaSuMisura({ offerta, fascia, servizi, titolo, completa = true }: Props) {
  if (!offerta) return null;
  const delServizio = (x: Proposta) => !servizi || servizi.includes(x.servizio);
  const comprese = offerta.proposte.filter((x) => delServizio(x) && cosaInFascia(x, fascia) !== null);
  const salendo = inPiuSalendo(offerta, fascia);
  const inPiu = (salendo?.voci ?? []).filter((v) => {
    const x = offerta.proposte.find((p) => p.id === v.id);
    return x ? delServizio(x) : false;
  });
  if (comprese.length === 0 && inPiu.length === 0) return null;
  const gruppi = SERVIZI_AGENZIA.filter((s) => comprese.some((x) => x.servizio === s));
  const piuServizi = !servizi || servizi.length > 1;

  return (
    <section aria-labelledby="offerta-su-misura" data-fascia={fascia} className="mt-4 rounded-xl border-2 border-primary-200 bg-primary-50/40 p-4 sm:p-5">
      <h2 id="offerta-su-misura" className="inline-flex items-center gap-2 font-serif text-lg font-bold text-ink-900">
        <Sparkles size={18} className="text-primary-700" aria-hidden /> {titolo ?? `La tua offerta su misura, col ${FASCE[fascia].nome}`}
      </h2>
      <p className="mt-1 text-sm text-ink-700">
        Le cose che faremo per te col {FASCE[fascia].nome}, una per una, prese da quello che sappiamo già della tua attività. Tu non devi fare niente: le facciamo noi.
      </p>

      {completa && (
        <p className="mt-2 text-xs text-ink-600" data-testid="offerta-riepilogo">
          Per te: {ABBONAMENTI.map((f) => `${FASCE[f].nome} ${offerta.perFascia[f]} ${offerta.perFascia[f] === 1 ? 'cosa' : 'cose'}`).join(' · ')}
        </p>
      )}

      <div className="mt-3 space-y-3">
        {gruppi.map((s) => (
          <div key={s}>
            {piuServizi && <h3 className="text-xs font-bold uppercase tracking-wide text-ink-700">{LISTINO[s].titolo}</h3>}
            <ul className="mt-1 space-y-2">
              {comprese.filter((x) => x.servizio === s).map((x) => (
                <li key={x.id} data-proposta={x.id} className="rounded-lg border border-cream-200 bg-white p-3">
                  <p className="flex items-start gap-1.5 text-sm font-semibold text-ink-900">
                    <Check size={16} className="mt-0.5 shrink-0 text-olive-700" aria-hidden />
                    <span>{cosaInFascia(x, fascia)}</span>
                  </p>
                  <p className="mt-0.5 pl-[22px] text-xs text-ink-600">{x.perche}</p>
                  <p className="mt-1 pl-[22px] text-[11px] text-ink-500">fonte: {x.fonte}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {comprese.length === 0 && (
          <p className="rounded-lg border border-dashed border-cream-300 bg-white p-3 text-sm text-ink-600">
            Col {FASCE[fascia].nome}, per questo servizio non abbiamo ancora dati abbastanza per una proposta precisa: la facciamo insieme al primo incontro.
          </p>
        )}
      </div>

      {salendo && inPiu.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="offerta-in-piu">
          <p className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-amber-900">
            <ArrowUpRight size={14} aria-hidden /> Col {FASCE[salendo.fascia].nome}, in più per te
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-800">
            {inPiu.map((v) => <li key={v.id} data-in-piu={v.id}>{v.cosa}</li>)}
          </ul>
        </div>
      )}

      {completa && offerta.domande.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-700">Al primo incontro ti chiediamo</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink-700">{offerta.domande.map((d) => <li key={d}>{d}</li>)}</ul>
        </div>
      )}
    </section>
  );
}
