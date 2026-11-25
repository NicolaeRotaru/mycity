import { Briefcase } from 'lucide-react';
import { ABBONAMENTI, FASCE, type Abbonamento } from '@/lib/agenzia/preventivo';
import { SEZIONI_BUSINESS, TITOLI_BUSINESS, type AnalisiAziendale as Analisi } from '@/lib/agenzia/analisi';

/**
 * L'ANALISI DEL BUSINESS NEL PREVENTIVO — 25/11/2026.
 *
 * Nicola: «vorrei che li fai il preventivo anche sulla parte di analisi sul suo business come fa AD su MyCity
 * (non MyCity marketplace ma azienda)». Due parti, come ogni proposta:
 *  · la parte generale: cosa comprende il servizio di analisi in ogni fascia (`FASCE`);
 *  · la parte specifica: l'analisi di QUESTA attività, scritta dall'AD dalle fonti pubbliche, ogni frase con la sua fonte.
 * Dove l'analisi non c'è ancora lo dice, senza inventare niente. Niente hook: si disegna anche sul server (il link).
 */

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'fonte';
  }
}

/** Il titolo, uguale nelle due forme (scritto una volta sola). */
function Titolo() {
  return (
    <h2 id="analisi-aziendale" className="inline-flex items-center gap-2 text-lg font-bold text-ink-900">
        <Briefcase size={18} className="text-primary-700" aria-hidden /> L’analisi del tuo business
      </h2>
  );
}

/** Nel preventivo, l'ordine di quello che conta di più per decidere: prima le mosse, poi opportunità e rischi. */
const ORDINE_CORTO = ['prime_mosse', 'opportunita', 'rischi', 'situazione', 'mercato', 'clienti'] as const;
const RIGHE_CORTE = 3;

type Props = { analisi: Analisi | null | undefined; fascia?: Abbonamento; nome?: string; corta?: boolean; dettaglioHref?: string };

/**
 * 25/11/2026, verso le 18:30 — Nicola: «dentro il preventivo la descrizione dei servizi deve essere corta e con lo
 * stretto necessario che gli interessa». Con `corta` (il preventivo): al massimo tre frasi, una per sezione nell'ordine
 * che conta, e la sola fascia guardata; il dettaglio sta nella pagina «Analisi» della demo (`dettaglioHref`).
 */
function Corta({ analisi, fascia, dettaglioHref }: Props) {
  const frasi = analisi ? ORDINE_CORTO.flatMap((s) => (analisi[s][0] ? [{ s, v: analisi[s][0] }] : [])).slice(0, RIGHE_CORTE) : [];
  return (
    <section className="mt-6 rounded-2xl border border-cream-300 bg-white p-5 shadow-warm" aria-labelledby="analisi-aziendale" data-testid="analisi-aziendale">
      <Titolo />
      {frasi.length ? (
        <ul className="mt-2 space-y-1">
          {frasi.map(({ s, v }) => (
            <li key={s} className="text-sm text-ink-700">
              <span className="font-semibold text-ink-900">{TITOLI_BUSINESS[s]}:</span> {v.testo}{' '}
              <a href={v.fonte} target="_blank" rel="noopener noreferrer nofollow" className="text-[11px] text-ink-500 underline">{dominio(v.fonte)}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-600">La stiamo preparando dalle fonti pubbliche.</p>
      )}
      {fascia && <p className="mt-2 text-xs text-ink-600">Col {FASCE[fascia].nome}: {FASCE[fascia].servizi.analisi}</p>}
      {dettaglioHref && <a href={dettaglioHref} className="mt-1 inline-block text-xs font-semibold text-primary-700 underline">Il dettaglio, con le fonti, è nella pagina Analisi</a>}
    </section>
  );
}

export default function AnalisiAziendale(props: Props) {
  if (props.corta) return <Corta {...props} />;
  const { analisi, fascia, nome } = props;
  return (
    <section className="mt-6 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm" aria-labelledby="analisi-aziendale" data-testid="analisi-aziendale">
      <Titolo />
      <p className="mt-1 text-sm text-ink-600">
        Guardiamo {nome ? <strong>{nome}</strong> : 'la tua attività'} come un’azienda: com’è messa, il mercato e i concorrenti vicini, i clienti e la reputazione, le opportunità, i rischi e le prime mosse.
      </p>

      {analisi ? (
        <div className="mt-3 space-y-3">
          <dl className="space-y-3">
          {SEZIONI_BUSINESS.filter((s) => analisi[s].length > 0).map((s) => (
            <div key={s}>
              <dt className="text-sm font-bold text-ink-900">{TITOLI_BUSINESS[s]}</dt>
              <dd>
              <ul className="mt-1 space-y-1">
                {analisi[s].map((v, i) => (
                  <li key={`${i}-${v.testo}`} className="text-sm text-ink-700">
                    {v.testo}{' '}
                    <a href={v.fonte} target="_blank" rel="noopener noreferrer nofollow" className="text-[11px] text-ink-500 underline">
                      {dominio(v.fonte)}
                    </a>
                  </li>
                ))}
              </ul>
              </dd>
            </div>
          ))}
          </dl>
          <p className="text-[11px] text-ink-500">Una prima lettura fatta da noi su fonti pubbliche e gratuite: ogni frase ha la sua fonte, e la rivediamo con te.</p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-cream-300 bg-cream-50 p-3 text-sm text-ink-600">
          L’analisi del tuo business la stiamo preparando dalle fonti pubbliche: appena è pronta la trovi qui.
        </p>
      )}

      <div className="mt-4">
        <p className="text-sm font-bold text-ink-900">Cosa comprende l’analisi, in ogni abbonamento</p>
        <ul className="mt-1 space-y-1">
          {ABBONAMENTI.map((f) => (
            <li key={f} className={`text-sm ${f === fascia ? 'font-semibold text-ink-900' : 'text-ink-700'}`}>
              {FASCE[f].nome}: {FASCE[f].servizi.analisi}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
