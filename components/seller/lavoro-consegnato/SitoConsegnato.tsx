import type { Sito } from '@/lib/agenzia/lavoro-consegnato/tipi';
import { Button } from '@/components/ui/Button';
import { Elenco, IntestazioneConsegnato, LinkEsterno, Sezione } from './comuni';

export default function SitoConsegnato({ sito }: { sito: Sito }) {
  const online = sito.stato === 'online';
  return (
    <div>
      <IntestazioneConsegnato aggiornato={sito.aggiornato_il} />
      <section className="mb-4 rounded-2xl border border-cream-300 bg-white p-5 sm:p-6 shadow-warm" aria-labelledby="sito-stato">
        <h2 id="sito-stato" className="text-xl font-bold text-ink-900">{sito.titolo}</h2>
        <p className="mt-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${online ? 'bg-olive-700 text-white' : 'bg-cream-200 text-ink-800'}`}>
            {online ? 'Online' : 'Da pubblicare'}
          </span>
        </p>
        {sito.indirizzo && (
          <div className="mt-3"><Button href={sito.indirizzo} target="_blank" rel="noopener noreferrer">Apri il sito</Button></div>
        )}
        {sito.codice && <p className="mt-3 text-sm text-ink-700">Il codice del sito: <LinkEsterno href={sito.codice}>{sito.codice}</LinkEsterno></p>}
      </section>

      {sito.pagine.length > 0 && (
        <Sezione id="sito-pagine" titolo="Le pagine del sito">
          <ul className="space-y-2">
            {sito.pagine.map((p) => (
              <li key={p.percorso} className="rounded-xl border border-cream-200 p-3">
                <p className="font-semibold text-ink-900">{p.titolo} <span className="font-normal text-ink-500">{p.percorso}</span></p>
                <p className="mt-0.5">{p.cosa_contiene}</p>
              </li>
            ))}
          </ul>
        </Sezione>
      )}
      <Sezione id="sito-premium" titolo="Cosa ha di Premium"><Elenco voci={sito.cosa_ha_di_premium} /></Sezione>
      {sito.da_confermare.length > 0 && (
        <Sezione id="sito-da-confermare" titolo="Da confermare">
          <ul className="list-disc space-y-1 pl-5">{sito.da_confermare.map((d) => <li key={d.voce}><b>{d.voce}</b>: {d.perche}</li>)}</ul>
        </Sezione>
      )}
      {sito.prossimi_passi.length > 0 && (
        <Sezione id="sito-passi" titolo="Prossimi passi">
          <ol className="list-decimal space-y-1 pl-5">{sito.prossimi_passi.map((p) => <li key={p.cosa}>{p.cosa} <span className="text-ink-500">({p.chi})</span></li>)}</ol>
        </Sezione>
      )}
    </div>
  );
}
