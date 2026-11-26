import { Check, X } from 'lucide-react';
import { ABBONAMENTI, FASCE, type Abbonamento } from '@/lib/agenzia/preventivo';
import { ANALISI_PER_FASCIA, partiDellaFascia } from '@/lib/agenzia/rapporto';

/**
 * «COSA C'È NELLA TUA ANALISI» — per abbonamento (26/11/2026, Nicola, 14:54).
 *
 * Il preventivo mostra per ogni fascia quali parti del rapporto ci sono, con la spunta, e quali no, dette
 * chiaramente. Tutto viene da una tabella sola, `ANALISI_PER_FASCIA` (lib/agenzia/rapporto.ts). Niente hook: si
 * disegna anche sul server. Con `fascia` mostra solo quella; senza, tutte e tre una accanto all'altra.
 */
export default function CosaCeNellAnalisi({ fascia }: { fascia?: Abbonamento }) {
  const fasce = fascia ? [fascia] : ABBONAMENTI;
  return (
    <div data-testid="cosa-ce-nell-analisi" className={fascia ? '' : 'grid gap-3 sm:grid-cols-3'}>
      {fasce.map((f) => {
        const t = ANALISI_PER_FASCIA[f];
        const { incluse, escluse } = partiDellaFascia(f);
        return (
          <div key={f} data-fascia={f} className="rounded-xl border border-cream-200 bg-white p-3">
            {!fascia && <p className="font-serif text-base font-bold text-ink-900">{FASCE[f].nome}</p>}
            <p className="text-xs font-semibold text-ink-900">{t.ritmo}</p>
            <ul className="mt-1 space-y-1 text-xs text-ink-700" aria-label={`Compreso nel ${FASCE[f].nome}`}>
              {incluse.map((r) => (
                <li key={r.parte} data-inclusa={r.parte} className="flex gap-1.5">
                  <Check size={14} className="mt-0.5 shrink-0 text-olive-700" aria-hidden />
                  <span>{r.titolo}{r.come ? `: ${r.come}` : ''}</span>
                </li>
              ))}
              {t.inPiu.map((v) => (
                <li key={v} className="flex gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-olive-700" aria-hidden /> <span>{v}</span></li>
              ))}
            </ul>
            {(escluse.length > 0 || t.nonComprende.length > 0) && (
              <ul className="mt-2 space-y-1 text-xs text-ink-500" aria-label={`Non compreso nel ${FASCE[f].nome}`}>
                {escluse.map((r) => (
                  <li key={r.parte} data-esclusa={r.parte} className="flex gap-1.5">
                    <X size={14} className="mt-0.5 shrink-0" aria-hidden /> <span>Non compreso nel rapporto: {r.titolo.charAt(0).toLowerCase() + r.titolo.slice(1)}</span>
                  </li>
                ))}
                {t.nonComprende.map((v) => (
                  <li key={v} className="flex gap-1.5"><X size={14} className="mt-0.5 shrink-0" aria-hidden /> <span>Non compreso nel rapporto: {v.charAt(0).toLowerCase() + v.slice(1)}</span></li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
