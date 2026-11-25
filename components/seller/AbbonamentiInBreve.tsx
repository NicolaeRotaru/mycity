import { ABBONAMENTI, FASCE, FRASE_CONDIZIONI, LISTINO, SERVIZI_AGENZIA, canonePrimoMese, scriviCanone, type Abbonamento } from '@/lib/agenzia/preventivo';
import { SERVIZI_IN_BREVE } from '@/lib/agenzia/preventivo-corto';

/**
 * I TRE ABBONAMENTI, IN BREVE — il preventivo dal link, 25/11/2026.
 *
 * Nicola, 18:30: nel preventivo i servizi vanno detti corti, con lo stretto necessario. Le tre fasce
 * mostrano nome, prezzo e per chi; i servizi una riga ciascuno, solo per la fascia guardata (quella
 * consigliata). I testi interi di `FASCE` restano nella pagina dell'abbonamento del negozio.
 * Niente hook: si disegna sul server.
 */
type Props = {
  consigliato: Abbonamento;
  prezzi: Record<Abbonamento, number | null>;
  primoMeseScontato: boolean;
  /** Perché consigliamo quella fascia, in una frase. */
  perche?: string | null;
};

export default function AbbonamentiInBreve({ consigliato, prezzi, primoMeseScontato, perche }: Props) {
  return (
    <section className="mt-6" aria-labelledby="abbonamenti">
      <h2 id="abbonamenti" className="text-lg font-bold text-ink-900">I tre abbonamenti</h2>
      <p className="mt-1 text-sm text-ink-600">Ognuno comprende tutti i servizi: cambia quanto. {FRASE_CONDIZIONI}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {ABBONAMENTI.map((f) => (
          <div key={f} data-fascia={f} className={`rounded-xl border-2 p-4 ${f === consigliato ? 'border-primary-600 bg-primary-50' : 'border-cream-200 bg-surface-0'}`}>
            <p className="font-bold text-ink-900">{FASCE[f].nome}{f === consigliato ? ' · consigliato' : ''}</p>
            <p className="mt-1 text-xl font-extrabold text-ink-900">{scriviCanone(prezzi[f])}</p>
            {primoMeseScontato && prezzi[f] ? (
              <p className="text-xs text-olive-700">Il primo mese {scriviCanone(canonePrimoMese(prezzi[f]))}</p>
            ) : null}
            <p className="mt-2 text-xs text-ink-600">{FASCE[f].perChi}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl border border-cream-200 bg-surface-0 p-4">
        <p className="text-sm font-semibold text-ink-900">Cosa comprende il {FASCE[consigliato].nome}</p>
        <ul className="mt-1 space-y-1 text-sm text-ink-700">
          {SERVIZI_AGENZIA.map((s) => (
            <li key={s} data-servizio={s}><strong>{LISTINO[s].titolo}:</strong> {SERVIZI_IN_BREVE[consigliato][s]}</li>
          ))}
        </ul>
      </div>
      {perche && <p className="mt-2 text-xs text-ink-600">Perché consigliamo {FASCE[consigliato].nome}: {perche}</p>}
    </section>
  );
}
