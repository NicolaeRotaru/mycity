import { CANALI_ANALIZZATI, NOMI_CANALI_ANALIZZATI, STATO_CANALE_IN_PAROLE, dataItaliana, giudizioCanaleInParole, numeriInParole, type AnalisiCanali } from '@/lib/agenzia/analisi';

/**
 * I SOCIAL E LA SCHEDA GOOGLE NELLA PAGINA «ANALISI» — 25/11/2026 sera.
 *
 * Nicola (`agenzia.social-come-il-sito`): i social nel link pubblico e nella pagina «Analisi» della demo. Ogni canale
 * letto da n8n: com'è oggi (il livello dell'AD), i numeri letti, cosa abbiamo visto e cosa consigliamo, con la fonte.
 * Niente hook: si disegna anche sul server (il link col codice). Senza analisi non disegna niente.
 */

function dominio(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
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

export default function CanaliAnalizzati({ canali }: { canali: AnalisiCanali | null | undefined }) {
  const letti = CANALI_ANALIZZATI.filter((c) => canali?.canali[c]);
  if (!canali || !letti.length) return null;
  return (
    <ul className="space-y-2" data-testid="canali-analizzati">
      {letti.map((c) => {
        const a = canali.canali[c]!;
        const numeri = numeriInParole(a.numeri);
        const giudizio = giudizioCanaleInParole(a, c);
        const fonte = a.fonte ? dominio(a.fonte) : null;
        return (
          <li key={c} className="rounded-lg border border-cream-200 bg-white p-3" data-canale={c}>
            <p className="text-sm font-semibold text-ink-900">{NOMI_CANALI_ANALIZZATI[c]}</p>
            {a.stato !== 'fatta' ? (
              <p className="text-sm text-ink-600">{STATO_CANALE_IN_PAROLE[a.stato]}</p>
            ) : (
              <>
                {giudizio.length > 0 && <p className="text-sm text-ink-900">{giudizio.join(' ')}</p>}
                {numeri.length > 0 && <p className="text-sm text-ink-700">{numeri.join(' · ')}</p>}
                <Elenco titolo="Cosa abbiamo visto" voci={a.osservazioni ?? []} />
                <Elenco titolo="Cosa ti consigliamo" voci={a.consigli ?? []} />
              </>
            )}
            {(fonte || a.letto_il) && (
              <p className="mt-1 text-[11px] text-ink-500">
                {a.letto_il ? `Letto il ${dataItaliana(a.letto_il)}` : `Analisi del ${dataItaliana(canali.fatta_il)}`}
                {fonte && <> · fonte: <a href={a.fonte!} target="_blank" rel="noopener noreferrer nofollow" className="underline">{fonte}</a></>}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
